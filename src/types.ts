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

export interface ReviewComment {
  file: string;
  body: string;
  start: number;
  end: number;
  label?: string;
  side?: "new" | "old";
  code?: string;
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
