import { readFile } from "node:fs/promises";
import path from "node:path";
import { listReviews } from "./output.ts";
import { parseReview } from "./thread.ts";
import type { NoteStatus } from "./types.ts";

/** Every note in a review file carries a status line the agent rewrites once it has processed it. */
export function parseStatuses(markdown: string, source = ""): NoteStatus[] {
  return parseReview(markdown).notes
    .filter((note) => note.status !== "pending" && (note.id || note.key))
    .map((note) => ({
      id: note.id,
      key: note.key,
      status: note.status,
      detail: note.detail,
      source,
    }));
}

/**
 * Statuses from every review file in the output directory, oldest file first, so a later
 * review of the same note overrides an earlier one. Missing or unreadable directories yield none.
 */
export async function collectStatuses(repoRoot: string, outDir: string, limit = 20): Promise<NoteStatus[]> {
  const directory = path.resolve(repoRoot, outDir);
  const files = (await listReviews(repoRoot, outDir)).slice(-limit);
  const out: NoteStatus[] = [];
  for (const name of files) {
    const text = await readFile(path.join(directory, name), "utf8").catch(() => "");
    if (text) out.push(...parseStatuses(text, name));
  }
  return out;
}
