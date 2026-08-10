import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deleteReviews, listReviews } from "./output.ts";
import { renderMarkdown } from "./review.ts";
import { applyComment, noteFromComment, parseReview } from "./thread.ts";
import type { ReviewDoc, ReviewMessage, ReviewNote } from "./thread.ts";
import type { ReviewSubmission } from "./types.ts";

export interface SaveResult {
  /** Path of the session file, relative to the repository unless the output directory is absolute. */
  file: string;
  /** Names of the earlier review files pruned by `replace`. */
  removed: string[];
}

/**
 * One review file per conversation. A run adopts the newest one it finds, so restarting lcr picks the
 * conversation back up where it stopped; **New review** is the only thing that starts another one.
 *
 * Both sides write this file: lcr renders it whole, the agent appends replies and rewrites status
 * lines. Every mutation here therefore re-reads the file first and keeps what it does not own — the
 * agent's messages and verdicts survive a save that happens while it is still working.
 */
export function createSession(repoRoot: string, outDir: string, range: string) {
  let name = "";
  /** Serialises this side's read-modify-write cycles; the agent's edits are outside our control. */
  let queue: Promise<unknown> = Promise.resolve();

  const dir = () => path.resolve(repoRoot, outDir);
  const shown = (file: string) =>
    path.isAbsolute(outDir) ? path.join(dir(), file) : path.relative(repoRoot, path.join(dir(), file));

  async function read(): Promise<ReviewDoc> {
    if (!name) return { range, general: "", notes: [] };
    const text = await readFile(path.join(dir(), name), "utf8").catch(() => "");
    return text ? parseReview(text) : { range, general: "", notes: [] };
  }

  /**
   * A free name for a new conversation. The stamp only resolves to the second, so starting fresh
   * twice inside one second would otherwise write over the file just left behind. A taken second is
   * stepped over rather than suffixed: the name stays the one shape that sorts, and that `reviewTime`
   * and `listReviews` both read as the order the files were written in.
   */
  async function mint(): Promise<string> {
    const taken = new Set(await listReviews(repoRoot, outDir));
    const from = Date.now();
    for (let step = 0; ; step++) {
      const stamp = new Date(from + step * 1000).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const candidate = `review-${stamp}.md`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  async function write(doc: ReviewDoc): Promise<string> {
    if (!name) name = await mint();
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), name), renderMarkdown({ ...doc, range }), "utf8");
    return name;
  }

  /** Runs one read-modify-write against the session file with nothing else of ours in flight. */
  function serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  return {
    /** Name of the file this conversation runs in; empty until the first save creates it. */
    get file() {
      return name;
    },
    get shownFile() {
      return name ? shown(name) : "";
    },
    /** Adopts the newest review file, so a restart continues rather than starts over. */
    async adoptNewest(): Promise<string> {
      name = (await listReviews(repoRoot, outDir)).at(-1) ?? "";
      return name;
    },
    /** Drops the current file so the next save opens a fresh conversation. */
    startFresh(): void {
      name = "";
    },
    read: () => serialise(read),

    /**
     * Folds the page's notes into the conversation. Notes already in the file keep the agent's thread
     * and verdict and take the reviewer's current wording; notes the page no longer holds are left
     * alone, because handing a note over is not the same as withdrawing it.
     */
    save(submission: ReviewSubmission, replace = false): Promise<SaveResult> {
      return serialise(async () => {
        const doc = await read();
        const known = new Map(doc.notes.map((note) => [note.id, note]));
        for (const comment of submission.comments) {
          if (!comment.id) {
            doc.notes.push(noteFromComment(comment));
            continue;
          }
          const kept = known.get(comment.id);
          if (kept) Object.assign(kept, applyComment(kept, comment));
          else doc.notes.push(noteFromComment(comment));
        }
        if (submission.general.trim()) doc.general = submission.general;
        const file = await write(doc);
        return {
          file: shown(file),
          removed: replace ? await deleteReviews(repoRoot, outDir, file) : [],
        };
      });
    },

    /** Appends the reviewer's follow-up to one note's thread, so the agent finds it where it is working. */
    reply(id: string, body: string): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await read();
        const note = doc.notes.find((entry) => entry.id === id);
        if (!note) return null;
        const message: ReviewMessage = { role: "reviewer", at: new Date().toISOString(), body };
        note.messages.push(message);
        await write(doc);
        return note;
      });
    },

    /** Withdraws a note. Deleting it on the page is the one thing that takes it out of the file. */
    remove(id: string): Promise<boolean> {
      return serialise(async () => {
        const doc = await read();
        const next = doc.notes.filter((note) => note.id !== id);
        if (next.length === doc.notes.length) return false;
        doc.notes = next;
        await write(doc);
        return true;
      });
    },
  };
}

export type ReviewSession = ReturnType<typeof createSession>;
