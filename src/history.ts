import { readFile } from "node:fs/promises";
import path from "node:path";
import { listReviews } from "./output.ts";
import { parseReview } from "./thread.ts";
import type { ReviewNote } from "./thread.ts";

/** One saved review as the picker shows it: where it came from and how much of it is still open. */
export interface ReviewInfo {
  file: string;
  range: string;
  /** Name the review was opened under; empty for one identified by its diff. */
  id: string;
  branch: string;
  base: string;
  notes: number;
  /** Notes no agent has settled yet: pending, needs-input, or a status nothing recognises. */
  open: number;
}

/** Notes of one earlier review, offered to the page as markers beside the current diff. */
export interface GhostGroup {
  file: string;
  range: string;
  branch: string;
  notes: ReviewNote[];
}

/** Review files an endpoint reads whole; the cap bounds the work a large directory can ask for. */
const READ_LIMIT = 20;

const OPEN = new Set(["pending", "needs-input", "unknown"]);

async function readEach(
  repoRoot: string,
  outDir: string,
  take: (name: string, doc: ReturnType<typeof parseReview>) => void,
): Promise<void> {
  const directory = path.resolve(repoRoot, outDir);
  for (const name of (await listReviews(repoRoot, outDir)).slice(-READ_LIMIT)) {
    const text = await readFile(path.join(directory, name), "utf8").catch(() => "");
    if (text) take(name, parseReview(text));
  }
}

/** Every saved review described for the picker, oldest first — the order the directory lists them. */
export async function describeReviews(repoRoot: string, outDir: string): Promise<ReviewInfo[]> {
  const out: ReviewInfo[] = [];
  await readEach(repoRoot, outDir, (name, doc) => {
    out.push({
      file: name,
      range: doc.range,
      id: doc.id ?? "",
      branch: doc.branch ?? "",
      base: doc.base ?? "",
      notes: doc.notes.length,
      open: doc.notes.filter((note) => OPEN.has(note.status)).length,
    });
  });
  return out;
}

/**
 * Notes from the other reviews of this branch, for the page to mark beside the current diff. Only
 * line notes travel — a note on a whole file or on the review itself has no line to be marked on —
 * and a note some current note already continues stays home: its conversation moved here.
 *
 * A file that names no branch is offered too. It predates the field, and hiding it would make the
 * feature go dark on exactly the reviews written before it existed.
 */
export async function collectGhosts(
  repoRoot: string,
  outDir: string,
  options: { except: string; branch: string; taken: Set<string> },
): Promise<GhostGroup[]> {
  const out: GhostGroup[] = [];
  await readEach(repoRoot, outDir, (name, doc) => {
    if (name === options.except) return;
    if (doc.branch && options.branch && doc.branch !== options.branch) return;
    const notes = doc.notes.filter(
      (note) => note.file && !note.scope && !options.taken.has(`${name}#${note.id}`),
    );
    if (notes.length) out.push({ file: name, range: doc.range, branch: doc.branch ?? "", notes });
  });
  return out;
}
