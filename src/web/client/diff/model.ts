import type {
  DiffFile,
  DiffRow,
  ReviewComment,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { mintNoteId } from "../../../shared/note-id.ts";

export const rowKey = (row: DiffRow) =>
  row.n != null ? `n${row.n}` : `o${row.o}`;
export function makeComment(
  file?: DiffFile,
  from?: number,
  to = from,
  characters?: { ca: number; cb: number },
): ReviewComment {
  if (!file)
    return {
      id: mintNoteId("", "@", "@"),
      file: "",
      scope: "global",
      body: "",
      start: 0,
      end: 0,
    };
  if (from == null || to == null)
    return {
      id: mintNoteId(file.path, "*", "*"),
      file: file.path,
      scope: "file",
      body: "",
      start: 0,
      end: 0,
    };
  const rows = file.rows
    .slice(Math.min(from, to), Math.max(from, to) + 1)
    .filter((row) => row.t !== "hunk");
  if (!rows.length) throw new Error("Select a code line to comment.");
  const newNumbers = rows.flatMap((row) => (row.n == null ? [] : [row.n]));
  const numbers = newNumbers.length
    ? newNumbers
    : rows.flatMap((row) => (row.o == null ? [] : [row.o]));
  const start = Math.min(...numbers),
    end = Math.max(...numbers);
  return {
    id: mintNoteId(
      file.path,
      rowKey(rows[0]!),
      rowKey(rows.at(-1)!),
      characters?.ca,
      characters?.cb,
    ),
    file: file.path,
    body: "",
    start,
    end,
    side: newNumbers.length ? "new" : "old",
    label:
      (start === end ? String(start) : `${start}-${end}`) +
      (characters ? `:${characters.ca + 1}-${characters.cb}` : ""),
    ...(characters
      ? {
          ...characters,
          snippet: rows[0]!.text.slice(characters.ca, characters.cb),
        }
      : {}),
    code: rows
      .map(
        (row) =>
          `${row.t === "add" ? "+" : row.t === "del" ? "-" : " "}${row.text}`,
      )
      .join("\n"),
  };
}
export function suggestionBlock(code: string) {
  const rows = code.split("\n");
  const next = rows.filter((line) => !line.startsWith("-"));
  const body = (next.length ? next : rows)
    .map((line) => line.slice(1))
    .join("\n");
  const fence = "`".repeat(
    Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return `${fence}suggestion\n${body}\n${fence}`;
}

export interface Placement {
  from: number;
  to: number;
  kind: "exact" | "moved";
}
export function placeNote(file: DiffFile, note: ReviewNote): Placement | null {
  if (note.file !== file.path || note.scope) return null;
  const [a, b] = note.id.slice(file.path.length + 1).split("|");
  const from = file.rows.findIndex((r) => r.t !== "hunk" && rowKey(r) === a);
  const to = file.rows.findIndex((r) => r.t !== "hunk" && rowKey(r) === b);
  const text = (rows: DiffRow[]) =>
    rows.filter((r) => r.t !== "hunk").map((r) => r.text.trim());
  const captured = (note.code || "")
    .split("\n")
    .map((line) => line.slice(1).trim());
  if (
    from >= 0 &&
    to >= from &&
    (!note.code ||
      JSON.stringify(text(file.rows.slice(from, to + 1))) ===
        JSON.stringify(captured))
  )
    return { from, to, kind: "exact" };
  if (!note.code) return null;
  const side = note.side === "old" ? "o" : "n";
  const rows = file.rows.flatMap((r, index) =>
    r.t !== "hunk" && r[side] != null ? [{ ...r, index }] : [],
  );
  for (const contextOnly of [false, true]) {
    const want = note.code
      .split("\n")
      .filter((line) =>
        contextOnly
          ? line[0] === " "
          : side === "o"
            ? line[0] !== "+"
            : line[0] !== "-",
      )
      .map((line) => line.slice(1).trim());
    if (!want.some(Boolean)) continue;
    const hits: Placement[] = [];
    for (let i = 0; i <= rows.length - want.length; i++) {
      if (
        want.every(
          (line, j) =>
            rows[i + j]!.text.trim() === line &&
            rows[i + j]![side] === rows[i]![side]! + j,
        )
      )
        hits.push({
          from: rows[i]!.index,
          to: rows[i + want.length - 1]!.index,
          kind: "moved",
        });
    }
    if (hits.length > 1) return null;
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

/** Folders before sibling files, with one order shared by navigation and note lists. */
export function orderFiles(files: DiffFile[]) {
  return [...files].sort((a, b) => {
    const aa = a.path.split("/"),
      bb = b.path.split("/");
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      if (aa[i] === bb[i]) continue;
      const ad = i < aa.length - 1,
        bd = i < bb.length - 1;
      return ad !== bd ? (ad ? -1 : 1) : aa[i]!.localeCompare(bb[i]!);
    }
    return a.path.localeCompare(b.path);
  });
}
