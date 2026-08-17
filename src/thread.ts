import type { NoteStatusKind, ReviewComment } from "./types.ts";

/**
 * The review file is the conversation. It is written by lcr and appended to by the agent, and both
 * sides read it back, so it has to survive a round trip: every field a note carries on the page is
 * recoverable from the Markdown alone. That is what lets a restarted server pick up the newest file
 * and hand the page its threads again.
 *
 * One note's section reads:
 *
 *     ### <path>:<label> <!-- lcr:<id> -->
 *
 *     ```diff
 *     <captured code>
 *     ```
 *
 *     Applies to this part of the line only: `<snippet>`
 *
 *     <opening note, written by the reviewer>
 *
 *     Status: pending
 *
 *     **Agent** <!-- lcr:m <iso> -->
 *
 *     <reply>
 *
 *     **Reviewer** <!-- lcr:m <iso> -->
 *
 *     <follow-up>
 *
 * Everything up to `Status:` is the note as it was first written, which is exactly the shape earlier
 * lcr versions produced; a file from one of those parses as a note whose thread has not started yet.
 * Replies are appended, never inserted, so an agent editing the file and lcr writing it are only ever
 * adding to the end of a section.
 *
 * A note about the review as a whole is the same section under `## Overall`, headed `### Overall
 * note`: it carries no path and no captured code, and is otherwise answered exactly like the rest.
 * Earlier versions kept a single overall note as plain prose under that heading, so prose found there
 * is read back as the first of these.
 *
 * Only one side of this file is escaped. Everything lcr writes goes through `escapeText`, so a line
 * of the reviewer's that speaks the file's own structure cannot be read as structure; an agent
 * appends straight into the file and nothing escapes what it writes. Its reply is therefore read as
 * the prose it is rather than as markup the parser owns: the lines that bound a note are the ones
 * carrying lcr's own `<!-- lcr:... -->` marker, and those close a fence the reply left open instead
 * of being swallowed by it. A heading or a speaker line the agent wrote itself carries no marker, so
 * it stays inside the reply — and the next save escapes it, which settles the file for good.
 */

export type MessageRole = "reviewer" | "agent";

export interface ReviewMessage {
  role: MessageRole;
  /** ISO stamp from the marker; empty when the writer left it out. */
  at: string;
  body: string;
}

/** One note as the review file holds it: the page's fields, plus what the agent wrote back. */
export interface ReviewNote {
  id: string;
  /** `<file>:<label>` heading text, used to match a status when the id marker was lost. */
  key: string;
  /** Empty for a note about the review as a whole, which belongs to no file. */
  file: string;
  /** Line label such as `42` or `12:7-14`; empty for a note on the whole file. */
  label: string;
  scope?: "file" | "global";
  side?: "new" | "old";
  start: number;
  end: number;
  ca?: number;
  cb?: number;
  snippet?: string;
  code?: string;
  body: string;
  status: NoteStatusKind;
  detail: string;
  messages: ReviewMessage[];
  /** `<review file>#<note id>` of the note this one continues, for a note carried in from an earlier review. */
  from?: string;
}

export interface ReviewDoc {
  range: string;
  /**
   * Name the review was opened under, from `lcr --id`; absent for a review identified by its diff.
   * When it is there it is the whole identity: the file belongs to that name whatever diff, branch, or
   * base it was written against.
   */
  id?: string;
  /** Branch the review was opened on; absent in files older than this field. */
  branch?: string;
  /** Commit the reviewed range was measured against when the review was opened. */
  base?: string;
  notes: ReviewNote[];
}

/**
 * Row anchor of a note that belongs to no file. Line anchors are `n<line>`/`o<line>` and a whole-file
 * note takes `*`, so this cannot collide with either; the page mints the same shape of id.
 */
export const GLOBAL_ANCHOR = "@";
/** Heading a note about the whole review is written under, and the key a lost marker matches on. */
export const OVERALL_KEY = "Overall note";
/** Id given to an overall note read back out of the prose an earlier lcr version wrote. */
export const LEGACY_GLOBAL_ID = `|${GLOBAL_ANCHOR}|${GLOBAL_ANCHOR}|#legacy`;

const H1 = /^#\s/;
const H2 = /^##\s+(.+?)\s*$/;
const H3 = /^###\s+(.+?)\s*$/;
const RANGE = /^Diff under review:\s*`(.*)`\s*$/;
const REVIEW_ID = /^Review id:\s*`(.*)`\s*$/;
const BRANCH = /^Branch:\s*`(.*)`\s*$/;
const BASE = /^Base:\s*`(.*)`\s*$/;
const MARKER = /<!--\s*lcr:(.+?)\s*-->/;
/** Provenance line of a note continued from an earlier review: `<file>#<id>` of the original. */
const FROM = /^<!--\s*lcr:from\s+(.+?)\s*-->\s*$/;
const MESSAGE = /^\*\*(Reviewer|Agent)\*\*\s*(?:<!--\s*lcr:m\s*([^>]*?)\s*-->\s*)?$/i;
const STATUS = /^\s*status\s*:\s*(.+?)\s*$/i;
const SNIPPET = /^Applies to this part of the line only:\s*(.+?)\s*$/;
const OLD_SIDE = /\s*\(line numbers before the change\)\s*$/;
const WHOLE_FILE = /\s*\(whole file\)\s*$/;
const OVERALL = /^Overall note$/i;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** Heading without its marker: the shortest leading path that leaves a whole line label behind. */
const LEGACY = /^(.*?):(\d+(?:-\d+)?(?::\d+-\d+)?)$/;
/** Closes the notes in a file this version wrote, whatever a reply above it left open. */
const END = /^<!--\s*lcr:end\s*-->\s*$/;
/** A note heading lcr wrote. Every id it mints carries `|` separators, which is what says so. */
const SEALED_HEAD = /^###\s+.*<!--\s*lcr:[^>]*\|[^>]*-->\s*$/;
/** A speaker line lcr wrote. */
const SEALED_SAID = /^\*\*(?:Reviewer|Agent)\*\*\s*<!--\s*lcr:m[^>]*-->\s*$/i;
/**
 * Structure lcr marked as its own, and the only thing a fence may not cross. An agent appends without
 * going through `escapeText`, so a fence it leaves open would otherwise run to the end of the
 * document and take every note after it into the reply. Nothing lcr leaves unescaped can look like
 * one of these: captured code carries a diff marker in column zero, and reviewer prose is escaped
 * line by line. Reviewer prose inside a fence of its own is the exception the format accepts — it is
 * kept verbatim on disk, so a marker line written inside one still reads as structure.
 */
const sealed = (line: string): boolean =>
  END.test(line) || SEALED_HEAD.test(line) || SEALED_SAID.test(line);
/**
 * Whether an unmarked heading still names a note: the whole review, a whole file, or a line range.
 * A file that lost a marker is read by its headings, so those keep starting a note even below a
 * thread; a heading the agent wrote in its reply names none of these and stays in the reply.
 */
const namesNote = (key: string): boolean =>
  OVERALL.test(key) || WHOLE_FILE.test(key) || LEGACY.test(key.replace(OLD_SIDE, ""));

/** Tracks fenced regions so captured code containing anything at all cannot be read as structure. */
class Fences {
  private open = "";

  /** True while the line is inside, or is a delimiter of, a fenced block. */
  step(line: string): boolean {
    const match = FENCE.exec(line);
    if (!match) return !!this.open;
    const mark = match[2] as string;
    if (!this.open) {
      this.open = mark;
      return true;
    }
    // A shorter run, or one of the other character, is content rather than the closing delimiter.
    if (mark[0] === this.open[0] && mark.length >= this.open.length && !(match[3] as string).trim()) {
      this.open = "";
    }
    return true;
  }

  /** Forgets an open fence, for the sealed lines a fence is not allowed to reach across. */
  reset(): void {
    this.open = "";
  }
}

/** Line shapes the parser reads as structure when they stand outside a fence. */
function dangerous(line: string): boolean {
  return H1.test(line) || H2.test(line) || H3.test(line) || /^-{3,}\s*$/.test(line) ||
    STATUS.test(line) || MESSAGE.test(line) || SNIPPET.test(line) || FROM.test(line) || END.test(line);
}
const escapable = (line: string): boolean => dangerous(line) || FENCE.test(line);

/**
 * Reviewer-written text is emitted verbatim, so a line of it that happens to speak the file's own
 * structure — a heading, a rule, a `Status:` line, a speaker line — would be read back as structure
 * and take the rest of the section with it. Rendering therefore escapes those lines with a leading
 * backslash, which `unescapeLines` strips on the way back in; a line already carrying backslashes
 * gains one more so the strip stays an exact inverse. Fences the text leaves unclosed would swallow
 * the rest of the document, so an opener with no closer loses its meaning the same way; balanced
 * fences keep their content untouched in both directions.
 */
export function escapeText(text: string): string {
  const lines = text.split("\n");
  // Escaping the last unmatched opener can expose later fence-like lines as openers of their own.
  const unmatched = new Set<number>();
  for (;;) {
    let open = "";
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      if (unmatched.has(i)) continue;
      const match = FENCE.exec(lines[i] as string);
      if (!match) continue;
      const mark = match[2] as string;
      if (!open) {
        open = mark;
        at = i;
      } else if (mark[0] === open[0] && mark.length >= open.length && !(match[3] as string).trim()) {
        open = "";
      }
    }
    if (!open) break;
    unmatched.add(at);
  }

  let open = "";
  return lines.map((line, i) => {
    const match = unmatched.has(i) ? null : FENCE.exec(line);
    if (match) {
      const mark = match[2] as string;
      if (!open) open = mark;
      else if (mark[0] === open[0] && mark.length >= open.length && !(match[3] as string).trim()) open = "";
      return line;
    }
    if (open) return line;
    if (unmatched.has(i)) return `\\${line}`;
    const bare = line.replace(/^\\+/, "");
    return (bare === line ? dangerous(line) : escapable(bare)) ? `\\${line}` : line;
  }).join("\n");
}

/** Undoes `escapeText` line by line, leaving fenced content and honest backslashes alone. */
function unescapeLines(lines: string[]): string[] {
  const fences = new Fences();
  return lines.map((line) => {
    if (fences.step(line)) return line;
    if (line.startsWith("\\") && escapable(line.replace(/^\\+/, ""))) return line.slice(1);
    return line;
  });
}

interface RawSection {
  heading: string;
  lines: string[];
}

interface Preamble {
  range: string;
  id: string;
  branch: string;
  base: string;
}

/** Splits the document into its preamble, the overall note, and one block of lines per note. */
function split(markdown: string): Preamble & { general: string[]; sections: RawSection[] } {
  const fences = new Fences();
  const sections: RawSection[] = [];
  const general: string[] = [];
  const head: Preamble = { range: "", id: "", branch: "", base: "" };
  let current: RawSection | null = null;
  let inGeneral = false;
  // Whether the section being read has reached its thread. A thread only exists in a file this
  // version wrote, and this version marks every heading it writes, so an unmarked heading below one
  // is the agent writing Markdown in its reply rather than a note starting.
  let threaded = false;

  for (const line of markdown.split("\n")) {
    // A sealed line is lcr's own structure, so it closes a fence rather than being read inside one.
    const seal = sealed(line);
    if (seal) fences.reset();
    else if (fences.step(line)) {
      if (current) current.lines.push(line);
      else if (inGeneral) general.push(line);
      continue;
    }
    if (END.test(line)) {
      current = null;
      inGeneral = false;
      threaded = false;
      continue;
    }
    // The speaker line stays in the section — it is what `readSection` cuts the thread on.
    if (seal && MESSAGE.test(line)) threaded = true;
    const third = H3.exec(line);
    if (third && (seal || !threaded || namesNote(third[1] as string))) {
      current = { heading: third[1] as string, lines: [] };
      sections.push(current);
      inGeneral = false;
      threaded = false;
      continue;
    }
    // A file heading, a rule, and a title stay boundaries inside a thread as well: they are what a
    // file older than `lcr:end` ends on, and a `##` in a reply is rarer than the `###` above.
    const second = H2.exec(line);
    if (second) {
      current = null;
      inGeneral = (second[1] as string).trim().toLowerCase() === "overall";
      threaded = false;
      continue;
    }
    if (H1.test(line) || /^-{3,}\s*$/.test(line)) {
      current = null;
      inGeneral = false;
      threaded = false;
      continue;
    }
    if (!current && !inGeneral) {
      const range = RANGE.exec(line);
      if (range) head.range = range[1] as string;
      const id = REVIEW_ID.exec(line);
      if (id) head.id = id[1] as string;
      const branch = BRANCH.exec(line);
      if (branch) head.branch = branch[1] as string;
      const base = BASE.exec(line);
      if (base) head.base = base[1] as string;
    }
    if (current) current.lines.push(line);
    else if (inGeneral) general.push(line);
  }

  return { ...head, general, sections };
}

/** Reads a whole review file back into the notes and threads it holds. */
export function parseReview(markdown: string): ReviewDoc {
  const { range, id, branch, base, general, sections } = split(markdown);
  const notes = sections.map(readSection).filter((note): note is ReviewNote => !!note);
  // Prose under `## Overall` is how a single overall note was written before overall notes were
  // notes. It says the same thing, so it is read back as the first of them rather than dropped; the
  // id is fixed, so reading the same file twice does not multiply it.
  const legacy = trimBlock(unescapeLines(general));
  if (legacy) notes.unshift(globalNote(LEGACY_GLOBAL_ID, legacy));
  const doc: ReviewDoc = { range, notes };
  if (id) doc.id = id;
  if (branch) doc.branch = branch;
  if (base) doc.base = base;
  return doc;
}

/** A note about the review as a whole, carrying nothing an agent has touched yet. */
function globalNote(id: string, body: string): ReviewNote {
  return {
    id,
    key: OVERALL_KEY,
    file: "",
    label: "",
    scope: "global",
    start: 0,
    end: 0,
    body,
    status: "pending",
    detail: "",
    messages: [],
  };
}

function readSection(section: RawSection): ReviewNote | null {
  const heading = section.heading;
  const id = (MARKER.exec(heading)?.[1] ?? "").trim();
  const key = heading.replace(MARKER, "").replace(OLD_SIDE, "").trim();
  if (!id && !key) return null;

  const note: ReviewNote = {
    id,
    key,
    file: "",
    label: "",
    side: OLD_SIDE.test(heading.replace(MARKER, "")) ? "old" : "new",
    start: 0,
    end: 0,
    body: "",
    status: "pending",
    detail: "",
    messages: [],
  };
  locate(note, key);

  const fences = new Fences();
  const before: string[] = [];
  type Block = { role: MessageRole; at: string; lines: string[] };
  const messages: Block[] = [];
  let current: Block | null = null;
  let loose: Block | null = null;
  let seenStatus = false;

  for (const line of section.lines) {
    const seal = sealed(line);
    if (seal) fences.reset();
    const fenced = !seal && fences.step(line);
    if (!fenced) {
      const start = MESSAGE.exec(line);
      if (start) {
        current = {
          role: (start[1] as string).toLowerCase() === "agent" ? "agent" : "reviewer",
          at: (start[2] ?? "").trim(),
          lines: [],
        };
        messages.push(current);
        continue;
      }
      // Last status line wins until the thread proper starts: an agent that appends its verdict
      // rather than replacing the `pending` above it must not lose to that `pending`.
      const status = !current && STATUS.exec(line);
      if (status) {
        Object.assign(note, readStatus(status[1] as string));
        seenStatus = true;
        continue;
      }
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    if (!seenStatus) {
      before.push(line);
      continue;
    }
    // Prose after the verdict with no speaker line above it is still the agent talking; keeping it
    // as a message is what stops the next save from quietly dropping what it wrote.
    if (!loose) {
      if (!line.trim()) continue;
      loose = { role: "agent", at: "", lines: [] };
      messages.push(loose);
    }
    loose.lines.push(line);
  }

  readOpening(note, before);
  note.messages = messages
    .map((entry) => ({ role: entry.role, at: entry.at, body: trimBlock(unescapeLines(entry.lines)) }))
    .filter((entry) => !!entry.body);
  return note;
}

/**
 * The captured diff, the snippet line, and the note the reviewer opened with. The captured block is
 * the first fenced `diff` block, and only while nothing has been written above it: a `diff` fence
 * inside the note's own prose is prose.
 */
function readOpening(note: ReviewNote, lines: string[]): void {
  const body: string[] = [];
  let open = "";
  let code: string[] | null = null;
  let taken = false;

  for (const line of lines) {
    const match = FENCE.exec(line);
    if (open) {
      const mark = match?.[2] as string | undefined;
      const closes = !!mark && mark[0] === open[0] && mark.length >= open.length &&
        !(match?.[3] as string).trim();
      if (!closes) {
        (code ?? body).push(line);
        continue;
      }
      open = "";
      if (code) {
        note.code = code.join("\n");
        code = null;
      } else {
        body.push(line);
      }
      continue;
    }
    if (match) {
      open = match[2] as string;
      // A note on no lines never captured code, so a leading `diff` block is its own prose.
      if (!taken && !note.scope && !body.some((entry) => entry.trim()) &&
        (match[3] as string).trim() === "diff") {
        code = [];
        taken = true;
        continue;
      }
      body.push(line);
      continue;
    }
    const snippet = SNIPPET.exec(line);
    if (snippet && note.snippet == null) {
      note.snippet = readInlineCode(snippet[1] as string);
      continue;
    }
    const from = FROM.exec(line);
    if (from && note.from == null) {
      note.from = from[1] as string;
      continue;
    }
    body.push(line);
  }
  if (code) note.code = code.join("\n");
  note.body = trimBlock(unescapeLines(body));
}

/** Path, label, and line range, taken from the id when it is there and from the heading when not. */
function locate(note: ReviewNote, key: string): void {
  const parts = note.id ? note.id.split("|") : [];
  if (parts.length >= 3) {
    note.file = parts[0] as string;
    const range = parts.slice(3).find((part) => /^\d+-\d+$/.test(part));
    if (range) {
      const [ca, cb] = range.split("-");
      note.ca = Number(ca);
      note.cb = Number(cb);
    }
    if (parts[1] === "*") note.scope = "file";
    if (parts[1] === GLOBAL_ANCHOR) note.scope = "global";
    note.start = lineOf(parts[1] as string);
    note.end = lineOf(parts[2] as string);
    if ((parts[1] as string).startsWith("o")) note.side = "old";
  }

  // A heading alone only says "overall" when no id contradicts it: a file may be called anything.
  if (note.scope === "global" || (!note.id && OVERALL.test(key))) {
    note.scope = "global";
    note.file = "";
    note.label = "";
    note.start = 0;
    note.end = 0;
    return;
  }
  if (WHOLE_FILE.test(key)) {
    note.scope = "file";
    note.file = note.file || key.replace(WHOLE_FILE, "").trim();
    note.label = "";
    note.start = 0;
    note.end = 0;
    return;
  }
  const legacy = LEGACY.exec(key);
  if (legacy) {
    note.file = note.file || (legacy[1] as string);
    note.label = legacy[2] as string;
  } else {
    note.file = note.file || key;
  }
  if (!note.start && note.label) {
    const bounds = /^(\d+)(?:-(\d+))?/.exec(note.label);
    if (bounds) {
      note.start = Number(bounds[1]);
      note.end = Number(bounds[2] ?? bounds[1]);
    }
  }
  if (note.ca == null && note.label) {
    const columns = /:(\d+)-(\d+)$/.exec(note.label);
    if (columns) {
      note.ca = Number(columns[1]) - 1;
      note.cb = Number(columns[2]);
    }
  }
  if (!note.label) note.label = labelOf(note);
}

const lineOf = (anchor: string): number => Number(/\d+/.exec(anchor ?? "")?.[0] ?? 0);

/** The line label a note heading carries, rebuilt from its range and any character offsets. */
export function labelOf(note: Pick<ReviewNote, "start" | "end" | "ca" | "cb">): string {
  const lines = note.start === note.end ? String(note.start) : `${note.start}-${note.end}`;
  return note.ca != null ? `${lines}:${note.ca + 1}-${note.cb}` : lines;
}

export function readStatus(raw: string): { status: NoteStatusKind; detail: string } {
  const text = raw.trim();
  const split = /^([^—:]+?)\s*(?:—|–|--|\s-\s|:)\s*(.*)$/.exec(text);
  const word = (split?.[1] ?? text).trim().toLowerCase().replace(/[.\s]+$/, "").replace(/\s+/g, "-");
  const detail = (split?.[2] ?? "").trim();
  if (/^(applied|done|fixed|resolved|implemented)$/.test(word)) return { status: "applied", detail };
  // A note that only asked a question is handled by answering it, with no edit to show for it.
  if (/^(answered|answer|explained|as-designed|by-design|intentional)$/.test(word)) {
    return { status: "answered", detail };
  }
  if (/^(skipped|skip|rejected|declined|wontfix|won't-fix)$/.test(word)) return { status: "skipped", detail };
  if (/^(needs-input|needs-info|needs-clarification|question|blocked|unclear)$/.test(word)) {
    return { status: "needs-input", detail };
  }
  if (word === "pending" || word === "todo" || word === "open") return { status: "pending", detail };
  return { status: "unknown", detail: text };
}

function trimBlock(lines: string[]): string {
  return lines.join("\n").replace(/^\s*\n+/, "").replace(/\s+$/, "");
}

/** Undoes `inlineCode`, so a snippet survives the round trip whatever backticks it holds. */
function readInlineCode(text: string): string {
  const fence = /^(`+)([\s\S]*)\1$/.exec(text.trim());
  if (!fence) return text.trim();
  const inner = fence[2] as string;
  return inner.startsWith(" ") && inner.endsWith(" ") ? inner.slice(1, -1) : inner;
}

/* ---------- writing ---------- */

/** A note carrying nothing an agent has touched yet: what a freshly submitted comment becomes. */
export function noteFromComment(comment: ReviewComment): ReviewNote {
  const note: ReviewNote = {
    id: comment.id ?? "",
    key: "",
    file: comment.scope === "global" ? "" : comment.file,
    label: comment.scope ? "" : (comment.label ?? labelOf({
      start: comment.start,
      end: comment.end,
      ca: comment.ca,
      cb: comment.cb,
    })),
    side: comment.side ?? "new",
    start: comment.start,
    end: comment.end,
    body: comment.body ?? "",
    status: "pending",
    detail: "",
    messages: [],
  };
  if (comment.scope) note.scope = comment.scope;
  if (comment.scope === "global") {
    note.start = 0;
    note.end = 0;
  }
  if (comment.ca != null) {
    note.ca = comment.ca;
    note.cb = comment.cb;
  }
  if (comment.snippet) note.snippet = comment.snippet;
  if (comment.code) note.code = comment.code;
  note.key = headingKey(note);
  return note;
}

/** The heading text a note is written under, and the fallback key a lost marker is matched by. */
export function headingKey(note: ReviewNote): string {
  if (note.scope === "global") return OVERALL_KEY;
  return note.scope === "file" ? `${note.file} (whole file)` : `${note.file}:${note.label}`;
}

/**
 * Copies the fields the page owns onto a note the file already holds. The agent owns the rest: its
 * replies and its verdict stay exactly as it wrote them, which is what makes a save mid-conversation
 * safe.
 */
export function applyComment(note: ReviewNote, comment: ReviewComment): ReviewNote {
  const fresh = noteFromComment(comment);
  if (note.from) fresh.from = note.from;
  return {
    ...fresh,
    id: note.id || fresh.id,
    status: note.status,
    detail: note.detail,
    messages: note.messages,
  };
}

export function renderNote(note: ReviewNote): string[] {
  const marker = note.id ? ` <!-- lcr:${note.id.replace(/[<>]/g, "")} -->` : "";
  const side = !note.scope && note.side === "old" ? " (line numbers before the change)" : "";
  const out = [`### ${headingKey(note)}${side}${marker}`, ""];
  if (note.from) out.push(`<!-- lcr:from ${note.from.replace(/[<>]/g, "")} -->`, "");
  if (note.code && note.code.trim()) {
    const fence = fenceFor(note.code);
    out.push(`${fence}diff`, note.code, fence, "");
  }
  if (note.snippet) {
    out.push(`Applies to this part of the line only: ${inlineCode(note.snippet)}`, "");
  }
  if (note.body.trim()) out.push(escapeText(note.body.trim()), "");
  out.push(`Status: ${statusLine(note)}`, "");
  for (const message of note.messages) {
    out.push(...renderMessage(message));
  }
  return out;
}

export function renderMessage(message: ReviewMessage): string[] {
  const label = message.role === "agent" ? "Agent" : "Reviewer";
  const stamp = message.at ? ` ${message.at}` : "";
  return [`**${label}** <!-- lcr:m${stamp} -->`, "", escapeText(message.body.trim()), ""];
}

function statusLine(note: ReviewNote): string {
  if (note.status === "unknown") return note.detail || "unknown";
  return note.detail ? `${note.status} — ${note.detail}` : note.status;
}

/**
 * Fences a block in enough backticks to survive any run inside it. Captured code carries a diff
 * marker in front of every line, so a fence in it does not start at column zero and cannot be found
 * by looking at line starts.
 */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** Fences a selected fragment in enough backticks to survive the backticks inside it. */
export function inlineCode(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(0, ...runs) + 1);
  // A boundary space needs the pad too: the reader strips one space from each padded end.
  const pad = /^[` ]|[` ]$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
