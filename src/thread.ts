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
  file: string;
  /** Line label such as `42` or `12:7-14`; empty for a note on the whole file. */
  label: string;
  scope?: "file";
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
}

export interface ReviewDoc {
  range: string;
  general: string;
  notes: ReviewNote[];
}

const H1 = /^#\s/;
const H2 = /^##\s+(.+?)\s*$/;
const H3 = /^###\s+(.+?)\s*$/;
const RANGE = /^Diff under review:\s*`(.*)`\s*$/;
const MARKER = /<!--\s*lcr:(.+?)\s*-->/;
const MESSAGE = /^\*\*(Reviewer|Agent)\*\*\s*(?:<!--\s*lcr:m\s*([^>]*?)\s*-->\s*)?$/i;
const STATUS = /^\s*status\s*:\s*(.+?)\s*$/i;
const SNIPPET = /^Applies to this part of the line only:\s*(.+?)\s*$/;
const OLD_SIDE = /\s*\(line numbers before the change\)\s*$/;
const WHOLE_FILE = /\s*\(whole file\)\s*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** Heading without its marker: the shortest leading path that leaves a whole line label behind. */
const LEGACY = /^(.*?):(\d+(?:-\d+)?(?::\d+-\d+)?)$/;

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
}

interface RawSection {
  heading: string;
  lines: string[];
}

/** Splits the document into its preamble, the overall note, and one block of lines per note. */
function split(markdown: string): { range: string; general: string[]; sections: RawSection[] } {
  const fences = new Fences();
  const sections: RawSection[] = [];
  const general: string[] = [];
  let range = "";
  let current: RawSection | null = null;
  let inGeneral = false;

  for (const line of markdown.split("\n")) {
    if (fences.step(line)) {
      if (current) current.lines.push(line);
      else if (inGeneral) general.push(line);
      continue;
    }
    const third = H3.exec(line);
    if (third) {
      current = { heading: third[1] as string, lines: [] };
      sections.push(current);
      inGeneral = false;
      continue;
    }
    const second = H2.exec(line);
    if (second) {
      current = null;
      inGeneral = (second[1] as string).trim().toLowerCase() === "overall";
      continue;
    }
    // A rule on its own line closes the notes: everything past it is the working agreement.
    if (H1.test(line) || /^-{3,}\s*$/.test(line)) {
      current = null;
      inGeneral = false;
      continue;
    }
    if (!current && !inGeneral) {
      const found = RANGE.exec(line);
      if (found) range = found[1] as string;
    }
    if (current) current.lines.push(line);
    else if (inGeneral) general.push(line);
  }

  return { range, general, sections };
}

/** Reads a whole review file back into the notes and threads it holds. */
export function parseReview(markdown: string): ReviewDoc {
  const { range, general, sections } = split(markdown);
  return {
    range,
    general: trimBlock(general),
    notes: sections.map(readSection).filter((note): note is ReviewNote => !!note),
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
    const fenced = fences.step(line);
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
    .map((entry) => ({ role: entry.role, at: entry.at, body: trimBlock(entry.lines) }))
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
      if (!taken && !body.some((entry) => entry.trim()) && (match[3] as string).trim() === "diff") {
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
    body.push(line);
  }
  if (code) note.code = code.join("\n");
  note.body = trimBlock(body);
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
    note.start = lineOf(parts[1] as string);
    note.end = lineOf(parts[2] as string);
    if ((parts[1] as string).startsWith("o")) note.side = "old";
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
    file: comment.file,
    label: comment.scope === "file" ? "" : (comment.label ?? labelOf({
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
  if (comment.scope === "file") note.scope = "file";
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
  return note.scope === "file" ? `${note.file} (whole file)` : `${note.file}:${note.label}`;
}

/**
 * Copies the fields the page owns onto a note the file already holds. The agent owns the rest: its
 * replies and its verdict stay exactly as it wrote them, which is what makes a save mid-conversation
 * safe.
 */
export function applyComment(note: ReviewNote, comment: ReviewComment): ReviewNote {
  const fresh = noteFromComment(comment);
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
  const side = note.scope !== "file" && note.side === "old" ? " (line numbers before the change)" : "";
  const out = [`### ${headingKey(note)}${side}${marker}`, ""];
  if (note.code && note.code.trim()) {
    const fence = fenceFor(note.code);
    out.push(`${fence}diff`, note.code, fence, "");
  }
  if (note.snippet) {
    out.push(`Applies to this part of the line only: ${inlineCode(note.snippet)}`, "");
  }
  if (note.body.trim()) out.push(note.body.trim(), "");
  out.push(`Status: ${statusLine(note)}`, "");
  for (const message of note.messages) {
    out.push(...renderMessage(message));
  }
  return out;
}

export function renderMessage(message: ReviewMessage): string[] {
  const label = message.role === "agent" ? "Agent" : "Reviewer";
  const stamp = message.at ? ` ${message.at}` : "";
  return [`**${label}** <!-- lcr:m${stamp} -->`, "", message.body.trim(), ""];
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
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
