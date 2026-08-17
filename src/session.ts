import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deleteReviews, listReviews } from "./output.ts";
import { renderMarkdown } from "./review.ts";
import { applyComment, noteFromComment, parseReview } from "./thread.ts";
import type { ReviewDoc, ReviewMessage, ReviewNote } from "./thread.ts";
import type { ReviewComment, ReviewSubmission } from "./types.ts";

export interface SaveResult {
  /** Path of the session file, relative to the repository unless the output directory is absolute. */
  file: string;
  /** Names of the earlier review files pruned by `replace`. */
  removed: string[];
}

/** The context a review is opened in: what it is called, what is diffed, from where, and against which commit. */
export interface ReviewContext {
  range: string;
  /** Name the run was started under, from `lcr --id`; absent when the diff is the identity. */
  id?: string;
  branch?: string;
  base?: string;
}

/**
 * Whether a review file belongs to this invocation's context.
 *
 * A name given with `--id` is the whole identity, and both sides have to agree on it: the same name
 * continues its review wherever the diff has moved to since, another name is another review, and a run
 * that names none stays out of every named one. Without a name it is the diff that identifies a
 * review: the range must match, and branch and base only rule a file out when both sides know them,
 * so files from before those fields — and a detached HEAD or an unresolvable base — read as belonging
 * rather than foreign.
 */
export function matchesContext(doc: ReviewContext, context: ReviewContext): boolean {
  if (doc.id || context.id) return (doc.id ?? "") === (context.id ?? "");
  if (doc.range !== context.range) return false;
  if (doc.branch && context.branch && doc.branch !== context.branch) return false;
  if (doc.base && context.base && doc.base !== context.base) return false;
  return true;
}

/**
 * A stamp no message in this thread already carries. The stamp in a message's marker is the only
 * name it has — it is how the page says which message to rewrite or take back — so two messages
 * sharing one would leave the older of them unaddressable.
 */
function freeStamp(note: ReviewNote): string {
  const taken = new Set(note.messages.map((entry) => entry.at));
  let at = Date.now();
  while (taken.has(new Date(at).toISOString())) at++;
  return new Date(at).toISOString();
}

/**
 * One of the reviewer's own messages, found by the stamp it carries. The agent's messages are not
 * ours to touch, and a reviewer line written without a stamp has no name to be asked for by, so
 * neither is ever answered here.
 */
function ownMessage(doc: ReviewDoc, id: string, at: string) {
  if (!at) return null;
  const note = doc.notes.find((entry) => entry.id === id);
  const message = note?.messages.find((entry) => entry.role === "reviewer" && entry.at === at);
  return note && message ? { note, message } : null;
}

/**
 * One review file per conversation, and one conversation per context: a run adopts the newest file
 * written for the same range, branch, and base, so restarting lcr picks that conversation back up
 * while any other diff starts its own. A run started with `--id` is asked for by that name instead —
 * it continues the review of that name however the diff has moved, and a name nothing has been
 * written under yet is a review with nothing in it. **New review** starts another one by hand, and
 * the picker reopens an earlier one.
 *
 * Both sides write this file: lcr renders it whole, the agent appends replies and rewrites status
 * lines. Every mutation here therefore re-reads the file first and keeps what it does not own — the
 * agent's messages and verdicts survive a save that happens while it is still working.
 */
export function createSession(repoRoot: string, outDir: string, range: string, context: ReviewContext = { range }) {
  let name = "";
  /** Serialises this side's read-modify-write cycles; the agent's edits are outside our control. */
  let queue: Promise<unknown> = Promise.resolve();

  const dir = () => path.resolve(repoRoot, outDir);
  const shown = (file: string) =>
    path.isAbsolute(outDir) ? path.join(dir(), file) : path.relative(repoRoot, path.join(dir(), file));

  /** The doc a conversation opens with: this invocation's context, stamped into the file it mints. */
  function fresh(): ReviewDoc {
    const doc: ReviewDoc = { range, notes: [] };
    if (context.id) doc.id = context.id;
    if (context.branch) doc.branch = context.branch;
    if (context.base) doc.base = context.base;
    return doc;
  }

  async function read(): Promise<ReviewDoc> {
    if (!name) return fresh();
    const text = await readFile(path.join(dir(), name), "utf8").catch(() => "");
    return text ? parseReview(text) : fresh();
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
    // The doc's own context wins: a conversation adopted from another range or branch keeps saying
    // where it came from, rather than being restamped with wherever it was reopened.
    await writeFile(path.join(dir(), name), renderMarkdown({ ...doc, range: doc.range || range }), "utf8");
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
    /**
     * Adopts the newest review file that belongs to this invocation's context, so a restart on the
     * same diff continues its conversation while a different range, branch, or base starts fresh —
     * the files that do not match stay on disk as the history they are.
     */
    async adoptMatching(): Promise<string> {
      for (const candidate of (await listReviews(repoRoot, outDir)).reverse()) {
        const text = await readFile(path.join(dir(), candidate), "utf8").catch(() => "");
        if (text && matchesContext(parseReview(text), context)) {
          name = candidate;
          return name;
        }
      }
      name = "";
      return name;
    },
    /** Moves the conversation into one named review file, for reopening an earlier review. */
    async adoptFile(file: string): Promise<boolean> {
      if (!(await listReviews(repoRoot, outDir)).includes(file)) return false;
      name = file;
      return true;
    },
    /** Drops the current file so the next save opens a fresh conversation. */
    startFresh(): void {
      name = "";
    },
    /**
     * Runs work with none of this side's read-modify-writes in flight, for a caller that changes
     * which file the conversation is in: forgetting or deleting it mid-save would let the tail of
     * that save resurrect it.
     */
    run<T>(work: () => Promise<T>): Promise<T> {
      return serialise(work);
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
        const file = await write(doc);
        return {
          file: shown(file),
          removed: replace ? await deleteReviews(repoRoot, outDir, file) : [],
        };
      });
    },

    /**
     * Carries a note in from an earlier review: a fresh note anchored where the reviewer is looking
     * now, holding the old conversation so neither side has to reconstruct it. The provenance marker
     * is what keeps the original from being offered as a ghost beside its own continuation.
     */
    import(comment: ReviewComment, thread: ReviewMessage[], from: string): Promise<ReviewNote> {
      return serialise(async () => {
        const doc = await read();
        const note = noteFromComment(comment);
        note.messages = thread;
        if (from) note.from = from;
        doc.notes.push(note);
        await write(doc);
        return note;
      });
    },

    /** Appends the reviewer's follow-up to one note's thread, so the agent finds it where it is working. */
    reply(id: string, body: string): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await read();
        const note = doc.notes.find((entry) => entry.id === id);
        if (!note) return null;
        const message: ReviewMessage = { role: "reviewer", at: freeStamp(note), body };
        note.messages.push(message);
        await write(doc);
        return note;
      });
    },

    /**
     * Rewrites one of the reviewer's own messages where it stands, so a reply can be corrected
     * without a second one contradicting it. Its stamp and its place in the thread are kept: the
     * message is the one the agent was already reading, saying something else.
     */
    editReply(id: string, at: string, body: string): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await read();
        const found = ownMessage(doc, id, at);
        if (!found) return null;
        found.message.body = body;
        await write(doc);
        return found.note;
      });
    },

    /** Withdraws one of the reviewer's own messages, the way deleting a note withdraws the note. */
    dropReply(id: string, at: string): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await read();
        const found = ownMessage(doc, id, at);
        if (!found) return null;
        found.note.messages = found.note.messages.filter((entry) => entry !== found.message);
        await write(doc);
        return found.note;
      });
    },

    /**
     * Withdraws notes, overall notes included — they are notes like the rest. Deleting on the page is
     * the one thing that takes a note out of the file. A set is withdrawn in one read-modify-write, so
     * the page is never told about a half-cleared file and never adopts the notes still in it back
     * onto the page that has just let them go.
     */
    remove(ids: string | string[]): Promise<boolean> {
      return serialise(async () => {
        const gone = new Set(typeof ids === "string" ? [ids] : ids);
        const doc = await read();
        const next = doc.notes.filter((note) => !gone.has(note.id));
        // Nothing to take out: leave the file untouched, so a session with none never mints one.
        if (next.length === doc.notes.length) return false;
        doc.notes = next;
        await write(doc);
        return true;
      });
    },
  };
}

export type ReviewSession = ReturnType<typeof createSession>;
