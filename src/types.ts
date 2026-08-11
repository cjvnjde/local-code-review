export type FileStatus = "modified" | "added" | "deleted" | "renamed";
export type DiffRowType = "hunk" | "add" | "del" | "ctx";

export interface DiffRow {
  t: DiffRowType;
  text: string;
  n?: number;
  o?: number;
  /** Section heading git appended to a hunk header, kept so the header can be rebuilt after expansion. */
  head?: string;
}

export interface DiffFile {
  path: string;
  status: FileStatus;
  rows: DiffRow[];
  added: number;
  removed: number;
  binary?: boolean;
  hash: string;
}

export type NoteStatusKind = "applied" | "answered" | "skipped" | "needs-input" | "pending" | "unknown";

/** One note's outcome, read back from the `Status:` lines an agent wrote into a review file. */
export interface NoteStatus {
  /** lcr note id from the heading marker; empty when the marker was lost. */
  id: string;
  /** `<file>:<label>` heading text, used when the id is missing. */
  key: string;
  status: NoteStatusKind;
  detail: string;
  source: string;
}

export interface ReviewComment {
  /** Stable anchor id, also written into the review file so statuses can be matched back. */
  id?: string;
  /** Empty for a note about the review as a whole, which belongs to no file. */
  file: string;
  body: string;
  start: number;
  end: number;
  label?: string;
  side?: "new" | "old";
  code?: string;
  /** Set when the note covers the file as a whole, or the review as a whole; it then has no lines. */
  scope?: "file" | "global";
  /** Half-open character range inside the single anchored line, when the note targets part of it. */
  ca?: number;
  cb?: number;
  /** Exact selected text of that range. */
  snippet?: string;
}

export interface ReviewSubmission {
  comments: ReviewComment[];
}

export interface CliOptions {
  port: number;
  outDir: string;
  context: number;
  /** Open the page in the default browser on start; `--no-open` turns it off. */
  open: boolean;
  diffArgs: string[];
}
