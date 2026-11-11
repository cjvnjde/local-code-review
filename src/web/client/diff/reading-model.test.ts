import { describe, expect, test } from "bun:test";
import type { DiffFile } from "../../../shared/review-types.ts";
import { noteFromComment } from "../../../review/thread.ts";
import { makeComment } from "./model.ts";
import {
  diffItems,
  readingAnchor,
  readingIndex,
  removedKey,
} from "./reading-model.ts";

const file = (path: string): DiffFile => ({
  path,
  status: "modified",
  hash: "h",
  added: 1,
  removed: 2,
  rows: [
    { t: "hunk", text: "@@ -1,3 +1,2 @@" },
    { t: "del", o: 1, text: "old first" },
    { t: "del", o: 2, text: "old second" },
    { t: "add", n: 1, text: "new first" },
    { t: "ctx", n: 2, o: 3, text: "kept" },
  ],
});
const options = {
  folded: () => false,
  removed: {},
  openRuns: new Set<string>(),
};
describe("continuous review reading", () => {
  test("keeps all files and anchored conversations in a single ordered stream", () => {
    const a = file("a.ts"),
      b = file("b.ts");
    const overall = noteFromComment({ ...makeComment(), body: "Overall" });
    const line = noteFromComment({ ...makeComment(a, 3), body: "Line" });
    const own = noteFromComment({ ...makeComment(b), body: "File" });
    const missing = noteFromComment({
      ...makeComment(file("gone.ts"), 3),
      body: "Missing",
    });
    const items = diffItems([a, b], [overall, own, line, missing], options);
    expect(
      items.filter((item) => item.kind === "header").map((item) => item.path),
    ).toEqual(["a.ts", "b.ts"]);
    expect(items.filter((item) => item.kind === "row")).toHaveLength(10);
    expect(items[0]).toMatchObject({ kind: "note", note: { id: overall.id } });
    const index = items.findIndex(
      (item) => item.kind === "note" && item.note.id === line.id,
    );
    expect(items[index - 1]).toMatchObject({ kind: "row", row: 3 });
    const header = items.findIndex(
      (item) => item.kind === "header" && item.path === "b.ts",
    );
    expect(items[header + 1]).toMatchObject({
      kind: "note",
      note: { id: own.id },
    });
    expect(items.at(-1)).toMatchObject({
      kind: "note",
      note: { id: missing.id },
    });
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
  test("folding a file keeps its header and file notes without deleting code or conversations", () => {
    const a = file("a.ts");
    const own = noteFromComment({ ...makeComment(a), body: "File" });
    const items = diffItems([a], [own], { ...options, folded: () => true });
    expect(items.map((item) => item.kind)).toEqual(["header", "note"]);
    expect(a.rows).toHaveLength(5);
  });
  test("removed runs are expandable and a spanning note keeps its removed subject visible", () => {
    const a = file("a.ts");
    const config = { ...options, removed: { "a.ts": true } };
    expect(
      diffItems([a], [], config).filter((item) => item.kind === "row"),
    ).toHaveLength(3);
    const opened = diffItems([a], [], {
      ...config,
      openRuns: new Set([removedKey(a, 1)]),
    });
    expect(opened.filter((item) => item.kind === "row")).toHaveLength(5);
    const note = noteFromComment({
      ...makeComment(a, 1, 3),
      body: "Keep both sides",
    });
    const withNote = diffItems([a], [note], config);
    expect(withNote.find((item) => item.kind === "removed")).toMatchObject({
      open: true,
      hasNotes: true,
    });
    expect(withNote.filter((item) => item.kind === "row")).toHaveLength(5);
  });
  test("a new file or note above the viewport preserves the same code and pixel offset", () => {
    const a = file("a.ts"),
      b = file("b.ts");
    const before = diffItems([b], [], options);
    const current = before.find(
      (item) => item.kind === "row" && item.row === 3,
    )!;
    const anchor = readingAnchor(current, 62);
    const after = diffItems(
      [a, b],
      [noteFromComment({ ...makeComment(), body: "Arrived" })],
      options,
    );
    const place = readingIndex(after, anchor)!;
    expect(after[place.index]!.key).toBe(current.key);
    expect(place.offset).toBe(62);
  });
  test("a moved row follows unique code and ambiguous or missing code falls back to its file header", () => {
    const a = file("a.ts");
    const current = diffItems([a], [], options).find(
      (item) => item.kind === "row" && item.row === 3,
    )!;
    const anchor = readingAnchor(current, 64);
    const moved = {
      ...a,
      rows: [{ t: "add" as const, n: 12, text: "new first" }],
    };
    const items = diffItems([moved], [], options);
    expect(items[readingIndex(items, anchor)!.index]).toMatchObject({
      kind: "row",
      row: 0,
    });
    const ambiguous = diffItems(
      [
        {
          ...moved,
          rows: [...moved.rows, { t: "add", n: 20, text: "new first" }],
        },
      ],
      [],
      options,
    );
    expect(ambiguous[readingIndex(ambiguous, anchor)!.index]).toMatchObject({
      kind: "header",
    });
    expect(readingIndex(diffItems([], [], options), anchor)).toBeNull();
  });
});
