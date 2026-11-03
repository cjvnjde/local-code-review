import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewerRevision } from "../agent/agent-queue.ts";
import { deleteReviews, listReviews } from "./output.ts";
import { renderMarkdown } from "./render.ts";
import { applyComment, noteFromComment, parseReview } from "./thread.ts";
import type { ReviewDoc, ReviewMessage, ReviewNote } from "./thread.ts";
import type {
  NoteStatusKind,
  ReviewComment,
  ReviewSubmission,
} from "../shared/review-types.ts";
import {
  dropWebSelection,
  setWebAnnotation,
  webAnnotationTarget,
  WebAnnotationInvalid,
  WebSelectionConflict,
  webCapture,
  type WebAnnotationTarget,
  type WebCapture,
} from "../shared/web-review.ts";
import {
  webAnnotation,
  webAnnotationImagesMatch,
  type WebAnnotation,
} from "../shared/web-annotation.ts";
import { readAttachment } from "./attach.ts";
import { hydrateContextDoc, preserveWebContexts } from "./web-context.ts";
import { compactWebReview } from "../shared/web-review.ts";

export interface SaveResult {
  /** Path of the session file, relative to the repository unless the output directory is absolute. */
  file: string;
  /** Names of the earlier review files pruned by `replace`. */
  removed: string[];
  /** New or reworded notes, for an optional ACP connection to queue after the write. */
  changed: ReviewNote[];
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
export function matchesContext(
  doc: ReviewContext,
  context: ReviewContext,
): boolean {
  if (doc.id || context.id) return (doc.id ?? "") === (context.id ?? "");
  if (doc.range !== context.range) return false;
  if (doc.branch && context.branch && doc.branch !== context.branch)
    return false;
  if (doc.base && context.base && doc.base !== context.base) return false;
  return true;
}

function assertEditableNote(note: ReviewNote) {
  if (
    note.messages.some((message) => message.role === "agent") ||
    ["applied", "answered", "skipped"].includes(note.status)
  )
    throw new WebSelectionConflict(
      "This note has been answered. Add a follow-up instead of changing the original.",
    );
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
  const index =
    note?.messages.findIndex(
      (entry) => entry.role === "reviewer" && entry.at === at,
    ) ?? -1;
  if (!note || index < 0) return null;
  if (note.messages.slice(index + 1).some((entry) => entry.role === "agent"))
    throw new WebSelectionConflict(
      "This reply has been answered. Add a follow-up instead of changing it.",
    );
  return { note, message: note.messages[index]! };
}

/** Only reviewer-owned fields: an agent reply or verdict must never wake the agent again. */
function reviewerFields(note: ReviewNote): string {
  return JSON.stringify([
    note.body,
    note.file,
    note.label,
    note.start,
    note.end,
    note.code ?? "",
    note.scope ?? "",
    note.side ?? "new",
    note.ca,
    note.cb,
    note.snippet ?? "",
    note.image ?? null,
    note.web ? compactWebReview(note.web) : null,
  ]);
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
export function createSession(
  repoRoot: string,
  outDir: string,
  range: string,
  context: ReviewContext = { range },
) {
  let name = "";
  /** Serialises this side's read-modify-write cycles; the agent's edits are outside our control. */
  let queue: Promise<unknown> = Promise.resolve();

  const dir = () => path.resolve(repoRoot, outDir);
  const shown = (file: string) =>
    path.isAbsolute(outDir)
      ? path.join(dir(), file)
      : path.relative(repoRoot, path.join(dir(), file));

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
    return text
      ? hydrateContextDoc(repoRoot, outDir, parseReview(text))
      : fresh();
  }

  /** Agent tasks name their original file, even after the page has opened another conversation. */
  async function readNamed(file: string): Promise<ReviewDoc | null> {
    if (!(await listReviews(repoRoot, outDir)).includes(file)) return null;
    const text = await readFile(path.join(dir(), file), "utf8").catch(() => "");
    return text ? hydrateContextDoc(repoRoot, outDir, parseReview(text)) : null;
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
      const stamp = new Date(from + step * 1000)
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const candidate = `review-${stamp}.md`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  async function write(doc: ReviewDoc): Promise<string> {
    for (const note of doc.notes)
      if (note.web)
        note.web = await preserveWebContexts(repoRoot, outDir, note.web);
    if (!name) name = await mint();
    await mkdir(dir(), { recursive: true });
    // The doc's own context wins: a conversation adopted from another range or branch keeps saying
    // where it came from, rather than being restamped with wherever it was reopened.
    await writeFile(
      path.join(dir(), name),
      renderMarkdown({ ...doc, range: doc.range || range }),
      "utf8",
    );
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
        const text = await readFile(path.join(dir(), candidate), "utf8").catch(
          () => "",
        );
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

    readNote(file: string, id: string): Promise<ReviewNote | null> {
      return serialise(
        async () =>
          (await readNamed(file))?.notes.find((note) => note.id === id) ?? null,
      );
    },

    /** The managed agent's reply path; never changes which conversation the page is reading. */
    answer(
      file: string,
      id: string,
      body: string,
      status?: NoteStatusKind,
    ): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await readNamed(file);
        const note = doc?.notes.find((entry) => entry.id === id);
        if (!doc || !note) return null;
        note.messages.push({ role: "agent", at: freeStamp(note), body });
        if (status) {
          note.status = status;
          note.detail = "";
        }
        await writeFile(path.join(dir(), file), renderMarkdown(doc), "utf8");
        return note;
      });
    },

    /** Managed results cannot resurrect a note or award a verdict to a later reviewer edit. */
    answerRevision(
      file: string,
      id: string,
      body: string,
      revision: string,
      status?: NoteStatusKind,
    ): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await readNamed(file);
        const note = doc?.notes.find((entry) => entry.id === id);
        if (!doc || !note) return null;
        const same = reviewerRevision(note) === revision;
        note.messages.push({
          role: "agent",
          at: freeStamp(note),
          body: same
            ? body
            : `Response to submitted revision ${revision.slice(0, 12)}. Later reviewer edits or follow-ups were not part of this turn.\n\n${body}`,
        });
        if (same && status) {
          note.status = status;
          note.detail = "";
        }
        await writeFile(path.join(dir(), file), renderMarkdown(doc), "utf8");
        return note;
      });
    },

    /**
     * Folds the page's notes into the conversation. Unanswered notes take the reviewer's current
     * wording; answered originals retain their wording, evidence, thread and verdict. Notes the page
     * no longer holds are left alone: handing a note over is not the same as withdrawing it.
     */
    save(submission: ReviewSubmission, replace = false): Promise<SaveResult> {
      return serialise(async () => {
        const doc = await read();
        const known = new Map(doc.notes.map((note, index) => [note.id, index]));
        const changed: ReviewNote[] = [];
        for (const comment of submission.comments) {
          if (!comment.id) {
            const note = noteFromComment(comment);
            doc.notes.push(note);
            changed.push(note);
            continue;
          }
          const index = known.get(comment.id);
          if (index !== undefined) {
            const kept = doc.notes[index]!;
            const next = applyComment(kept, comment);
            if (reviewerFields(kept) !== reviewerFields(next)) {
              assertEditableNote(kept);
              changed.push(next);
            }
            doc.notes[index] = next;
          } else {
            const note = noteFromComment(comment);
            doc.notes.push(note);
            changed.push(note);
          }
        }
        const file = await write(doc);
        return {
          file: shown(file),
          removed: replace ? await deleteReviews(repoRoot, outDir, file) : [],
          changed,
        };
      });
    },

    /**
     * Carries a note in from an earlier review: a fresh note anchored where the reviewer is looking
     * now, holding the old conversation so neither side has to reconstruct it. The provenance marker
     * is what keeps the original from being offered as a ghost beside its own continuation.
     */
    import(
      comment: ReviewComment,
      thread: ReviewMessage[],
      from: string,
    ): Promise<ReviewNote> {
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
    reply(id: string, body: string, file = name): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await readNamed(file);
        if (!doc) return null;
        const note = doc.notes.find((entry) => entry.id === id);
        if (!note) return null;
        const message: ReviewMessage = {
          role: "reviewer",
          at: freeStamp(note),
          body,
        };
        note.messages.push(message);
        await writeFile(path.join(dir(), file), renderMarkdown(doc), "utf8");
        return note;
      });
    },

    /**
     * Rewrites one of the reviewer's own messages where it stands, so a reply can be corrected
     * without a second one contradicting it. Its stamp and its place in the thread are kept: the
     * message is the one the agent was already reading, saying something else.
     */
    editReply(
      id: string,
      at: string,
      body: string,
      file = name,
    ): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await readNamed(file);
        if (!doc) return null;
        const found = ownMessage(doc, id, at);
        if (!found) return null;
        found.message.body = body;
        await writeFile(path.join(dir(), file), renderMarkdown(doc), "utf8");
        return found.note;
      });
    },

    /** Withdraws one of the reviewer's own messages, the way deleting a note withdraws the note. */
    dropReply(id: string, at: string, file = name): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await readNamed(file);
        if (!doc) return null;
        const found = ownMessage(doc, id, at);
        if (!found) return null;
        found.note.messages = found.note.messages.filter(
          (entry) => entry !== found.message,
        );
        await writeFile(path.join(dir(), file), renderMarkdown(doc), "utf8");
        return found.note;
      });
    },

    /** Add visual evidence without rewriting the original subject or the agent's conversation. */
    addWebCapture(id: string, capture: WebCapture): Promise<ReviewNote | null> {
      const clean = webCapture(capture);
      return serialise(async () => {
        if (!clean) throw new Error("Invalid comparison capture.");
        const doc = await read();
        const note = doc.notes.find((entry) => entry.id === id);
        if (!note?.web) return null;
        assertEditableNote(note);
        if (note.web.after.length >= 100)
          throw new Error("This note already has 100 comparison captures.");
        note.web.after.push(clean);
        await write(doc);
        return note;
      });
    },

    /** Append another selected subject, keeping comparison captures tied to the original subject. */
    addWebSelection(
      id: string,
      capture: WebCapture,
    ): Promise<ReviewNote | null> {
      const clean = webCapture(capture);
      return serialise(async () => {
        if (!clean) throw new Error("Invalid page selection.");
        const doc = await read();
        const note = doc.notes.find((entry) => entry.id === id);
        if (!note || note.scope !== "global") return null;
        assertEditableNote(note);
        if (!note.web) note.web = { before: clean, after: [] };
        else {
          if ((note.web.additional?.length ?? 0) >= 100)
            throw new Error("This note already has 100 additional selections.");
          (note.web.additional ??= []).push(clean);
        }
        await write(doc);
        return note;
      });
    },

    /** Update only one capture's proposal against a fresh file and the editor's expected image. */
    annotateWebCapture(
      id: string,
      target: WebAnnotationTarget,
      annotation: WebAnnotation | null,
    ): Promise<ReviewNote | null> {
      const clean = annotation === null ? null : webAnnotation(annotation),
        where = webAnnotationTarget(target);
      return serialise(async () => {
        if (!where || (annotation !== null && !clean))
          throw new WebAnnotationInvalid("Invalid screenshot annotation.");
        const doc = await read(),
          note = doc.notes.find((entry) => entry.id === id);
        if (!note?.web || note.scope !== "global") return null;
        assertEditableNote(note);
        const web = setWebAnnotation(note.web, where, clean);
        if (clean) {
          const capture =
            where.kind === "after"
              ? web.after[where.index]!
              : where.index === 0
                ? web.before
                : web.additional![where.index - 1]!;
          if (
            !(await webAnnotationImagesMatch(clean, capture.area, (name) =>
              readAttachment(repoRoot, outDir, name),
            ))
          )
            throw new WebAnnotationInvalid(
              "The PNG attachments are missing, invalid, or their dimensions do not match the annotation. Upload the drawing again.",
            );
        }
        note.web = web;
        await write(doc);
        return note;
      });
    },

    /** Remove a selected subject against freshly read evidence without changing the conversation. */
    removeWebSelection(
      id: string,
      index: number,
      key: string,
    ): Promise<ReviewNote | null> {
      return serialise(async () => {
        const doc = await read();
        const note = doc.notes.find((entry) => entry.id === id);
        if (!note?.web || note.scope !== "global") return null;
        assertEditableNote(note);
        const web = dropWebSelection(note.web, index, key);
        if (web) note.web = web;
        else delete note.web;
        await write(doc);
        return note;
      });
    },

    /**
     * Withdraws notes, overall notes included — they are notes like the rest. Deleting on the page is
     * the one thing that takes a note out of the file. A set is withdrawn in one read-modify-write, so
     * the page is never told about a half-cleared file and never adopts the notes still in it back
     * onto the page that has just let them go.
     */
    remove(ids: string | string[], file = name): Promise<boolean> {
      return serialise(async () => {
        const gone = new Set(typeof ids === "string" ? [ids] : ids);
        const doc = await readNamed(file);
        if (!doc) return false;
        const next = doc.notes.filter((note) => !gone.has(note.id));
        // Nothing to take out: leave the file untouched, so a session with none never mints one.
        if (next.length === doc.notes.length) return false;
        doc.notes = next;
        await writeFile(path.join(dir(), file), renderMarkdown(doc), "utf8");
        return true;
      });
    },
  };
}

export type ReviewSession = ReturnType<typeof createSession>;
