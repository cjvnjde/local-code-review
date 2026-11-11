import type { ReviewComment } from "./review-types.ts";

export function mintNoteId(
  path: string,
  a: string,
  b: string,
  ca?: number,
  cb?: number,
) {
  return `${path}|${a}|${b}${ca == null ? "" : `|${ca}-${cb}`}|#${crypto.randomUUID().replaceAll("-", "")}`;
}

export function noteKey(note: ReviewComment): string {
  if (note.scope === "global") return "Overall note";
  if (note.scope === "file") return `${note.file} (whole file)`;
  return `${note.file}:${note.label || (note.start === note.end ? note.start : `${note.start}-${note.end}`)}`;
}
