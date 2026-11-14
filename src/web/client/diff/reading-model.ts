import type {
  DiffFile,
  ReviewNote,
  ReviewComment,
} from "../../../shared/review-types.ts";
import { placeNote, rowKey } from "./model.ts";

export type DiffItem = { key: string; path: string } & (
  | { kind: "header" | "media" | "empty" | "scrollbar"; file: DiffFile }
  | { kind: "row"; file: DiffFile; row: number }
  | {
      kind: "removed";
      file: DiffFile;
      from: number;
      to: number;
      open: boolean;
      hasNotes: boolean;
    }
  | { kind: "note"; note: ReviewNote; file?: DiffFile }
  | { kind: "editor"; comment: ReviewComment; file?: DiffFile }
);
export const itemKey = (path: string, part: string) =>
  JSON.stringify([path, part]);
export const removedKey = (file: DiffFile, from: number) =>
  itemKey(file.path, `removed:${rowKey(file.rows[from]!)}`);
export const isImage = (path: string) =>
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|apng)$/i.test(path);

/** One ordered reading surface; only its visible items are mounted by the virtualizer. */
export function diffItems(
  files: DiffFile[],
  notes: ReviewNote[],
  options: {
    folded: (file: DiffFile) => boolean;
    removed: Readonly<Record<string, boolean>>;
    openRuns: ReadonlySet<string>;
    editor?: ReviewComment;
    horizontalScroll?: boolean;
  },
): DiffItem[] {
  const items: DiffItem[] = [];
  const editor = options.editor;
  const heldNotes = notes.filter((note) => note.id !== editor?.id);
  const addEditor = (file?: DiffFile) => {
    if (editor)
      items.push({
        key: itemKey("", "editor"),
        path: file?.path || "",
        kind: "editor",
        comment: editor,
        file,
      });
  };
  if (editor?.scope === "global") addEditor();
  const addNote = (note: ReviewNote, file?: DiffFile) =>
    items.push({
      key: itemKey(note.file, `note:${note.id}`),
      path: file?.path || "",
      kind: "note",
      file,
      note,
    });
  heldNotes
    .filter((note) => note.scope === "global")
    .forEach((note) => addNote(note));
  for (const file of files) {
    items.push({
      key: itemKey(file.path, "header"),
      path: file.path,
      kind: "header",
      file,
    });
    const at = new Map<number, ReviewNote[]>();
    const protectedRows = new Set<number>();
    const draftPlace =
      editor?.file === file.path && !editor.scope
        ? placeNote(file, {
            ...editor,
            id: editor.id!,
            label: editor.label || "",
            key: "",
            status: "pending",
            detail: "",
            messages: [],
          })
        : null;
    if (editor?.file === file.path && editor.scope !== "global" && !draftPlace)
      addEditor(file);
    if (draftPlace)
      for (let index = draftPlace.from; index <= draftPlace.to; index++)
        protectedRows.add(index);
    for (const note of heldNotes.filter(
      (note) => note.file === file.path && note.scope !== "global",
    )) {
      const place = placeNote(file, note);
      if (!place) addNote(note, file);
      else {
        at.set(place.to, [...(at.get(place.to) || []), note]);
        for (let index = place.from; index <= place.to; index++)
          protectedRows.add(index);
      }
    }
    if (options.folded(file)) continue;
    if (
      isImage(file.path) ||
      file.binary ||
      /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|aiff?|weba)$/i.test(file.path)
    )
      items.push({
        key: itemKey(file.path, "media"),
        path: file.path,
        kind: "media",
        file,
      });
    if (!file.binary && !file.rows.length)
      items.push({
        key: itemKey(file.path, "empty"),
        path: file.path,
        kind: "empty",
        file,
      });
    for (let row = 0; row < file.rows.length; row++) {
      if (options.removed[file.path] && file.rows[row]!.t === "del") {
        const from = row;
        while (row + 1 < file.rows.length && file.rows[row + 1]!.t === "del")
          row++;
        const to = row,
          key = removedKey(file, from);
        // A comment must never disappear inside a hidden deletion.
        const hasNotes = [...protectedRows].some(
          (index) => index >= from && index <= to,
        );
        const open = hasNotes || options.openRuns.has(key);
        items.push({
          key,
          path: file.path,
          kind: "removed",
          file,
          from,
          to,
          open,
          hasNotes,
        });
        if (!open) continue;
        row = from;
        // Emit the open run here, so its following lines aren't interpreted as a new run.
        for (; row <= to; row++) {
          items.push({
            key: itemKey(file.path, rowKey(file.rows[row]!)),
            path: file.path,
            kind: "row",
            file,
            row,
          });
          at.get(row)?.forEach((note) => addNote(note, file));
          if (draftPlace?.to === row) addEditor(file);
        }
        row = to;
        continue;
      }
      const current = file.rows[row]!;
      const key =
        current.t === "hunk"
          ? `hunk:${current.text || "tail"}`
          : rowKey(current);
      items.push({
        key: itemKey(file.path, key),
        path: file.path,
        kind: "row",
        file,
        row,
      });
      at.get(row)?.forEach((note) => addNote(note, file));
      if (draftPlace?.to === row) addEditor(file);
    }
    if (options.horizontalScroll && file.rows.length)
      items.push({
        key: itemKey(file.path, "scrollbar"),
        path: file.path,
        kind: "scrollbar",
        file,
      });
  }
  const paths = new Set(files.map((file) => file.path));
  heldNotes
    .filter((note) => note.scope !== "global" && !paths.has(note.file))
    .forEach((note) => addNote(note));
  if (editor && editor.scope !== "global" && !paths.has(editor.file))
    addEditor();
  return items;
}

export interface ReadingAnchor {
  key: string;
  path: string;
  offset: number;
  editorId?: string;
  code?: string;
  side?: "n" | "o";
}
export function readingAnchor(item: DiffItem, offset: number): ReadingAnchor {
  const row = item.kind === "row" ? item.file.rows[item.row] : undefined;
  return {
    key: item.key,
    path: item.path,
    offset,
    ...(item.kind === "editor" ? { editorId: item.comment.id } : {}),
    ...(row && row.t !== "hunk"
      ? {
          code: row.text,
          side: row.n != null ? ("n" as const) : ("o" as const),
        }
      : {}),
  };
}

/** Follow an unchanged row, or uniquely surviving captured code; otherwise keep the file header. */
export function readingIndex(items: DiffItem[], anchor: ReadingAnchor) {
  const exact = items.findIndex((item) => item.key === anchor.key);
  if (exact >= 0) {
    const item = items[exact]!;
    if (
      anchor.code === undefined ||
      (item.kind === "row" && item.file.rows[item.row]!.text === anchor.code)
    )
      return { index: exact, offset: anchor.offset };
  }
  if (anchor.editorId) {
    const index = items.findIndex(
      (item) => item.kind === "note" && item.note.id === anchor.editorId,
    );
    if (index >= 0) return { index, offset: anchor.offset };
  }
  if (anchor.code?.trim()) {
    const matches = items.flatMap((item, index) =>
      item.kind === "row" &&
      item.path === anchor.path &&
      item.file.rows[item.row]![anchor.side || "n"] != null &&
      item.file.rows[item.row]!.text === anchor.code
        ? [index]
        : [],
    );
    if (matches.length === 1)
      return { index: matches[0]!, offset: anchor.offset };
  }
  const index = items.findIndex(
    (item) => item.kind === "header" && item.path === anchor.path,
  );
  return index < 0 ? null : { index, offset: 0 };
}
