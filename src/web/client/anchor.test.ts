import { beforeEach, describe, expect, test } from "bun:test";
import { outdatedNotes, placeNote, placeNotes, strayNotes } from "./anchor.ts";
import { state } from "./state.ts";

const ctx = (n: number, o: number, text: string) => ({ t: "ctx", n, o, text });
const add = (n: number, text: string) => ({ t: "add", n, text });
const del = (o: number, text: string) => ({ t: "del", o, text });
const hunk = (text = "@@ -1,4 +1,5 @@") => ({ t: "hunk", text });

function diff(...files: { path: string; rows: any[] }[]) {
  state.files = files.map((f) => ({ ...f, hash: "h", added: 0, removed: 0, status: "modified" }));
  state.byPath = new Map(state.files.map((f: any, i: number) => [f.path, i]));
  state.notes = new Map();
  state.place = new Map();
}
function note(over: any = {}) {
  return {
    id: "app.ts|n3|n3|#1",
    file: "app.ts",
    a: "n3",
    b: "n3",
    side: "new",
    start: 3,
    end: 3,
    label: "3",
    code: '+  console.log("debug");',
    body: "Remove this.",
    ...over,
  };
}

beforeEach(() => {
  state.files = [];
  state.byPath = new Map();
  state.notes = new Map();
  state.place = new Map();
});

describe("placeNote", () => {
  test("keeps a note on its own rows while they still hold the code it captured", () => {
    diff({
      path: "app.ts",
      rows: [hunk(), ctx(1, 1, "function load() {"), ctx(2, 2, "  let v = 1;"), add(3, '  console.log("debug");')],
    });
    expect(placeNote(note())).toEqual({ fi: 0, i: 3, j: 3, how: "exact" });
  });

  test("follows the code when it is still in the file but somewhere else", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(1, 1, "function load() {"),
        ctx(2, 2, "  let v = 1;"),
        ctx(3, 3, "  const other = 2;"),
        add(4, '  console.log("debug");'),
      ],
    });
    expect(placeNote(note())).toEqual({ fi: 0, i: 4, j: 4, how: "moved" });
  });

  test("follows the unchanged lines of a capture once the changed ones are applied", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(1, 1, "function load() {"),
        ctx(2, 2, "  const kept = 1;"),
        add(3, "  const fixed = 2;"),
      ],
    });
    const moved = placeNote(note({
      a: "n8",
      b: "n9",
      start: 8,
      end: 9,
      code: "   const kept = 1;\n+  const broken = 2;",
    }));
    expect(moved).toEqual({ fi: 0, i: 2, j: 2, how: "moved" });
  });

  test("follows a moved block even when it carries a blank line", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(1, 1, "before"),
        add(2, "foo() {"),
        add(3, ""),
        add(4, "}"),
      ],
    });
    const moved = placeNote(note({
      a: "n8",
      b: "n10",
      start: 8,
      end: 10,
      code: "+foo() {\n+\n+}",
    }));
    expect(moved).toEqual({ fi: 0, i: 2, j: 4, how: "moved" });
  });

  test("a run cannot jump the hidden lines between two hunks", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk("@@ -40,1 +40,1 @@"),
        ctx(40, 40, "return null;"),
        hunk("@@ -200,1 +200,1 @@"),
        ctx(200, 200, "}"),
      ],
    });
    const placed = placeNote(note({
      a: "n80",
      b: "n81",
      start: 80,
      end: 81,
      code: " return null;\n }",
    }));
    expect(placed?.how).not.toBe("moved");
  });

  test("marks a note outdated instead of attaching it to a nearby unrelated line", () => {
    diff({
      path: "app.ts",
      rows: [hunk(), ctx(1, 1, "function load() {"), ctx(2, 2, "  let v = 1;"), add(3, "  return v;")],
    });
    expect(placeNote(note())).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });

  test("marks a note outdated when its captured code has multiple possible locations", () => {
    diff({
      path: "app.ts",
      rows: [hunk(), ctx(1, 1, 'console.log("debug");'), ctx(2, 2, 'console.log("debug");')],
    });
    expect(placeNote(note())).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });

  test("a note on a file the diff no longer shows has no place at all", () => {
    diff({ path: "other.ts", rows: [hunk(), ctx(1, 1, "x")] });
    expect(placeNote(note())).toBeNull();
  });

  test("an old-side note looks at the old side", () => {
    diff({
      path: "app.ts",
      rows: [hunk(), ctx(1, 1, "function load() {"), del(2, "  const gone = 1;"), add(2, "  const kept = 1;")],
    });
    const placed = placeNote(note({
      a: "o2",
      b: "o2",
      side: "old",
      start: 2,
      end: 2,
      code: "-  const gone = 1;",
    }));
    expect(placed).toEqual({ fi: 0, i: 2, j: 2, how: "exact" });
  });

  test("a whole-file note belongs to the file header for as long as the file is there", () => {
    diff({ path: "app.ts", rows: [hunk(), ctx(1, 1, "x")] });
    expect(placeNote(note({ id: "app.ts|*|*|#2", a: "*", b: "*", scope: "file", code: "" })))
      .toEqual({ fi: 0, i: -1, j: -1, how: "file" });
  });

  test("a binary file makes an old line comment outdated", () => {
    state.files = [{ path: "app.ts", rows: [], binary: true, hash: "h" }];
    state.byPath = new Map([["app.ts", 0]]);
    expect(placeNote(note())).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });
});

describe("placeNotes", () => {
  test("sorts the homeless notes into the file they came from and the ones with no file left", () => {
    diff(
      { path: "app.ts", rows: [hunk("@@ -400,1 +400,1 @@"), ctx(400, 400, "far away")] },
      { path: "conf.ts", rows: [hunk(), ctx(1, 1, "kept")] },
    );
    const stuck = note();
    const gone = note({ id: "gone.ts|n1|n1|#3", file: "gone.ts", a: "n1", b: "n1", start: 1 });
    const fine = note({ id: "conf.ts|n1|n1|#4", file: "conf.ts", a: "n1", b: "n1", start: 1, code: " kept" });
    [stuck, gone, fine].forEach((n) => state.notes.set(n.id, n));
    placeNotes();

    expect(outdatedNotes(0).map((n) => n.id)).toEqual([stuck.id]);
    expect(outdatedNotes(1)).toEqual([]);
    expect(strayNotes().map((n: any) => n.id)).toEqual([gone.id]);
    expect(state.place.get(fine.id)).toEqual({ fi: 1, i: 1, j: 1, how: "exact" });
  });
});
