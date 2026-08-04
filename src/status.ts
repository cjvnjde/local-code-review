import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { NoteStatus, NoteStatusKind } from "./types.ts";

const HEADING = /^###\s+(.+?)\s*$/;
const MARKER = /<!--\s*lcr:(.+?)\s*-->/;
const STATUS = /^\s*status\s*:\s*(.+?)\s*$/i;
const OLD_SIDE = /\(line numbers before the change\)\s*$/;

/** Every note in a review file carries a status line the agent rewrites once it has processed it. */
export function parseStatuses(markdown: string, source = ""): NoteStatus[] {
  const out: NoteStatus[] = [];
  let current: NoteStatus | null = null;
  let fenced = false;
  for (const line of markdown.split("\n")) {
    // Captured code is quoted verbatim, so it can contain anything that looks like markup.
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[1] as string;
      current = {
        id: (MARKER.exec(text)?.[1] ?? "").trim(),
        key: text.replace(MARKER, "").replace(OLD_SIDE, "").trim(),
        status: "pending",
        detail: "",
        source,
      };
      out.push(current);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) current = null;
    const status = current && STATUS.exec(line);
    // Last status line wins: an agent that appends its verdict must not lose to the `pending` above it.
    if (status) Object.assign(current!, readStatus(status[1] as string));
  }
  return out.filter((entry) => entry.status !== "pending" && (entry.id || entry.key));
}

function readStatus(raw: string): { status: NoteStatusKind; detail: string } {
  const text = raw.trim();
  const split = /^([^—:]+?)\s*(?:—|–|--|\s-\s|:)\s*(.*)$/.exec(text);
  const word = (split?.[1] ?? text).trim().toLowerCase().replace(/[.\s]+$/, "").replace(/\s+/g, "-");
  const detail = (split?.[2] ?? "").trim();
  if (/^(applied|done|fixed|resolved|implemented)$/.test(word)) return { status: "applied", detail };
  if (/^(skipped|skip|rejected|declined|wontfix|won't-fix)$/.test(word)) return { status: "skipped", detail };
  if (/^(needs-input|needs-info|needs-clarification|question|blocked|unclear)$/.test(word)) {
    return { status: "needs-input", detail };
  }
  if (word === "pending" || word === "todo" || word === "open") return { status: "pending", detail };
  return { status: "unknown", detail: text };
}

/**
 * Statuses from every review file in the output directory, oldest file first, so a later
 * review of the same note overrides an earlier one. Missing or unreadable directories yield none.
 */
export async function collectStatuses(repoRoot: string, outDir: string, limit = 20): Promise<NoteStatus[]> {
  const directory = path.resolve(repoRoot, outDir);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const files = names.filter((name) => /^review-.*\.md$/.test(name)).sort().slice(-limit);
  const out: NoteStatus[] = [];
  for (const name of files) {
    const text = await readFile(path.join(directory, name), "utf8").catch(() => "");
    if (text) out.push(...parseStatuses(text, name));
  }
  return out;
}
