export type FileStatus = "modified" | "added" | "deleted" | "renamed";
export type DiffRowType = "hunk" | "add" | "del" | "ctx";

export interface DiffRow {
  t: DiffRowType;
  text: string;
  n?: number;
  o?: number;
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

export type NoteStatusKind = "applied" | "skipped" | "needs-input" | "pending" | "unknown";

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
  file: string;
  body: string;
  start: number;
  end: number;
  label?: string;
  side?: "new" | "old";
  code?: string;
  /** Set when the note is about the file as a whole; it then carries no line range. */
  scope?: "file";
  /** Half-open character range inside the single anchored line, when the note targets part of it. */
  ca?: number;
  cb?: number;
  /** Exact selected text of that range. */
  snippet?: string;
}

export interface ReviewSubmission {
  general: string;
  comments: ReviewComment[];
}

export interface CliOptions {
  port: number;
  outDir: string;
  context: number;
  diffArgs: string[];
}
