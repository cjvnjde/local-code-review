import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  anchorKeys,
  globalNotes,
  orderedNotes,
  placeOf,
  rowOfNote,
  outdatedNotes,
  placeNote,
  placeNotes,
  replaceIn,
  strayNotes,
} from "./anchor.ts";
import { state } from "../app/state.ts";

const ctx = (n: number, o: number, text: string) => ({ t: "ctx", n, o, text });
const add = (n: number, text: string) => ({ t: "add", n, text });
const del = (o: number, text: string) => ({ t: "del", o, text });
const hunk = (text = "@@ -1,4 +1,5 @@") => ({ t: "hunk", text });

function diff(...files: { path: string; rows: any[] }[]) {
  state.files = files.map((f) => ({
    ...f,
    hash: "h",
    added: 0,
    removed: 0,
    status: "modified",
  }));
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

let saved: Pick<
  typeof state,
  "files" | "byPath" | "notes" | "place" | "resolved" | "showResolved"
>;
beforeEach(() => {
  saved = {
    files: state.files,
    byPath: state.byPath,
    notes: state.notes,
    place: state.place,
    resolved: state.resolved,
    showResolved: state.showResolved,
  };
});
afterEach(() => Object.assign(state, saved));

beforeEach(() => {
  state.files = [];
  state.byPath = new Map();
  state.notes = new Map();
  state.place = new Map();
  state.resolved = new Map();
  state.showResolved = false;
});

describe("placeNote", () => {
  test("keeps a note on its own rows while they still hold the code it captured", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(1, 1, "function load() {"),
        ctx(2, 2, "  let v = 1;"),
        add(3, '  console.log("debug");'),
      ],
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
    const moved = placeNote(
      note({
        a: "n8",
        b: "n9",
        start: 8,
        end: 9,
        code: "   const kept = 1;\n+  const broken = 2;",
      }),
    );
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
    const moved = placeNote(
      note({
        a: "n8",
        b: "n10",
        start: 8,
        end: 10,
        code: "+foo() {\n+\n+}",
      }),
    );
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
    const placed = placeNote(
      note({
        a: "n80",
        b: "n81",
        start: 80,
        end: 81,
        code: " return null;\n }",
      }),
    );
    expect(placed?.how).not.toBe("moved");
  });

  test("marks a note outdated instead of attaching it to a nearby unrelated line", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(1, 1, "function load() {"),
        ctx(2, 2, "  let v = 1;"),
        add(3, "  return v;"),
      ],
    });
    expect(placeNote(note())).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });

  test("marks a note outdated when its captured code has multiple possible locations", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(1, 1, 'console.log("debug");'),
        ctx(2, 2, 'console.log("debug");'),
      ],
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
      rows: [
        hunk(),
        ctx(1, 1, "function load() {"),
        del(2, "  const gone = 1;"),
        add(2, "  const kept = 1;"),
      ],
    });
    const placed = placeNote(
      note({
        a: "o2",
        b: "o2",
        side: "old",
        start: 2,
        end: 2,
        code: "-  const gone = 1;",
      }),
    );
    expect(placed).toEqual({ fi: 0, i: 2, j: 2, how: "exact" });
  });

  test("a whole-file note belongs to the file header for as long as the file is there", () => {
    diff({ path: "app.ts", rows: [hunk(), ctx(1, 1, "x")] });
    expect(
      placeNote(
        note({ id: "app.ts|*|*|#2", a: "*", b: "*", scope: "file", code: "" }),
      ),
    ).toEqual({ fi: 0, i: -1, j: -1, how: "file" });
  });

  test("a binary file makes an old line comment outdated", () => {
    state.files = [{ path: "app.ts", rows: [], binary: true, hash: "h" }];
    state.byPath = new Map([["app.ts", 0]]);
    expect(placeNote(note())).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });

  test("relocation never borrows identical text from the opposite side", () => {
    for (const side of ["old", "new"]) {
      diff({
        path: "app.ts",
        rows: [hunk(), del(20, "removed"), add(20, "added")],
      });
      const text = side === "old" ? "added" : "removed";
      expect(
        placeNote(
          note({
            a: "n90",
            b: "n90",
            side,
            code: (side === "old" ? "-" : "+") + text,
          }),
        ),
      ).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
    }
  });

  test("a mixed replacement relocates across opposite-side rows without claiming hidden lines", () => {
    diff({
      path: "app.ts",
      rows: [
        hunk(),
        ctx(10, 10, "before"),
        del(11, "old"),
        add(11, "new"),
        ctx(12, 12, "after"),
      ],
    });
    expect(
      placeNote(
        note({ a: "n90", b: "n92", code: " before\n-old\n+new\n after" }),
      ),
    ).toEqual({ fi: 0, i: 1, j: 4, how: "moved" });
    expect(
      placeNote(
        note({
          a: "o90",
          b: "o92",
          side: "old",
          code: " before\n-old\n+new\n after",
        }),
      ),
    ).toEqual({ fi: 0, i: 1, j: 4, how: "moved" });
  });

  test("ambiguous full captures do not fall back to a fragment of context", () => {
    diff({
      path: "app.ts",
      rows: [
        ctx(10, 10, "keep"),
        add(11, "changed"),
        ctx(20, 20, "keep"),
        add(21, "changed"),
      ],
    });
    expect(
      placeNote(note({ a: "n90", b: "n91", code: " keep\n+changed" })),
    ).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });

  test("blank-only captures cannot manufacture a moved location", () => {
    diff({ path: "app.ts", rows: [ctx(10, 10, ""), add(11, "   ")] });
    for (const code of ["+", " \n+   ", "-\n "])
      expect(placeNote(note({ a: "n90", b: "n91", code }))).toEqual({
        fi: 0,
        i: -1,
        j: -1,
        how: "outdated",
      });
  });

  test("existing endpoint keys are insufficient when intervening captured lines changed", () => {
    diff({
      path: "app.ts",
      rows: [ctx(1, 1, "first"), ctx(2, 2, "unrelated"), ctx(3, 3, "last")],
    });
    expect(
      placeNote(note({ a: "n1", b: "n3", code: " first\n expected\n last" })),
    ).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
    expect(
      placeNote(note({ a: "n3", b: "n1", code: " first\n expected\n last" })),
    ).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });
});

describe("placeNotes", () => {
  test("sorts the homeless notes into the file they came from and the ones with no file left", () => {
    diff(
      {
        path: "app.ts",
        rows: [hunk("@@ -400,1 +400,1 @@"), ctx(400, 400, "far away")],
      },
      { path: "conf.ts", rows: [hunk(), ctx(1, 1, "kept")] },
    );
    const stuck = note();
    const gone = note({
      id: "gone.ts|n1|n1|#3",
      file: "gone.ts",
      a: "n1",
      b: "n1",
      start: 1,
    });
    const fine = note({
      id: "conf.ts|n1|n1|#4",
      file: "conf.ts",
      a: "n1",
      b: "n1",
      start: 1,
      code: " kept",
    });
    [stuck, gone, fine].forEach((n) => state.notes.set(n.id, n));
    placeNotes();

    expect(outdatedNotes(0).map((n) => n.id)).toEqual([stuck.id]);
    expect(outdatedNotes(1)).toEqual([]);
    expect(strayNotes().map((n: any) => n.id)).toEqual([gone.id]);
    expect(state.place.get(fine.id)).toEqual({
      fi: 1,
      i: 1,
      j: 1,
      how: "exact",
    });
  });

  test("revealed context recomputes only the affected file and leaves other cached placements intact", () => {
    diff(
      { path: "app.ts", rows: [add(3, '  console.log("debug");')] },
      { path: "other.ts", rows: [ctx(1, 1, "keep")] },
    );
    const n = note(),
      other = note({
        id: "other",
        file: "other.ts",
        a: "n1",
        b: "n1",
        code: " keep",
      });
    state.notes.set(n.id, n);
    state.notes.set(other.id, other);
    placeNotes();
    const otherPlace = state.place.get(other.id);
    state.files[0].rows.unshift(ctx(2, 2, "revealed"));
    delete state.files[0].ki;
    replaceIn("app.ts");
    expect(state.place.get(n.id)).toEqual({ fi: 0, i: 1, j: 1, how: "exact" });
    expect(state.place.get(other.id)).toBe(otherPlace);
  });
});

describe("anchor boundary transitions", () => {
  test("review notes remain global even when their file and all rows are absent", () => {
    const overall = note({
      id: "|@|@|#overall",
      scope: "global",
      file: "",
      a: "@",
      b: "@",
      code: "",
    });
    expect(placeNote(overall)).toEqual({ fi: -1, i: -1, j: -1, how: "global" });
    expect(rowOfNote(overall)).toBe(-1);
    diff({ path: "app.ts", rows: [ctx(3, 3, "unrelated")] });
    expect(placeNote(overall)).toEqual({ fi: -1, i: -1, j: -1, how: "global" });
  });

  test("an exact capture may start at row zero and span hunk separators without counting them as code", () => {
    diff({
      path: "app.ts",
      rows: [ctx(1, 1, "  first"), hunk(), ctx(2, 2, ""), ctx(3, 3, "last  ")],
    });
    const n = note({ a: "n1", b: "n3", code: " first\n \n last" });
    expect(placeNote(n)).toEqual({ fi: 0, i: 0, j: 3, how: "exact" });
    expect(rowOfNote(n)).toBe(3);
    expect(anchorKeys(state.files[0], 0, 3)).toEqual(["n1", "n3"]);
  });

  test("legacy notes without captured code require both ordered endpoints but do not invent content", () => {
    diff({ path: "app.ts", rows: [ctx(1, 1, "first"), ctx(2, 2, "second")] });
    expect(placeNote(note({ a: "n1", b: "n2", code: "" }))).toEqual({
      fi: 0,
      i: 0,
      j: 1,
      how: "exact",
    });
    for (const [a, b] of [
      ["n9", "n2"],
      ["n1", "n9"],
      ["n2", "n1"],
    ])
      expect(placeNote(note({ a, b, code: "" }))).toEqual({
        fi: 0,
        i: -1,
        j: -1,
        how: "outdated",
      });
  });

  test("empty files, populated binaries and captures on a missing side cannot claim a line", () => {
    for (const rows of [[], [hunk()], [del(8, "target")]]) {
      diff({ path: "app.ts", rows });
      expect(placeNote(note({ a: "n8", b: "n8", code: "+target" }))).toEqual({
        fi: 0,
        i: -1,
        j: -1,
        how: "outdated",
      });
    }
    diff({ path: "app.ts", rows: [ctx(3, 3, '  console.log("debug");')] });
    state.files[0].binary = true;
    expect(placeNote(note())).toEqual({ fi: 0, i: -1, j: -1, how: "outdated" });
  });

  test("old-side relocation skips added rows while preserving contiguous old line numbers", () => {
    diff({
      path: "app.ts",
      rows: [
        add(10, "noise"),
        del(7, "target"),
        add(11, "more noise"),
        del(8, "tail"),
      ],
    });
    expect(
      placeNote(
        note({ a: "o70", b: "o71", side: "old", code: "-target\n-tail" }),
      ),
    ).toEqual({ fi: 0, i: 1, j: 3, how: "moved" });
  });

  test("derived note traversal separates globals and orders stray notes by file and original line", () => {
    diff({ path: "app.ts", rows: [ctx(1, 1, "live")] });
    const overall = note({
      id: "|@|@|#global",
      scope: "global",
      file: "",
      a: "@",
      b: "@",
      code: "",
    });
    const live = note({ id: "live", a: "n1", b: "n1", code: " live" });
    const stray = [
      note({ id: "z9", file: "z.ts", start: 9 }),
      note({ id: "a4", file: "a.ts", start: 4 }),
      note({ id: "z2", file: "z.ts", start: 2 }),
    ];
    for (const n of [...stray, live, overall]) state.notes.set(n.id, n);
    placeNotes();
    expect(globalNotes()).toEqual([overall]);
    expect(strayNotes().map((n) => n.id)).toEqual(["a4", "z2", "z9"]);
    expect(orderedNotes().map((e) => e.n.id)).toEqual([
      overall.id,
      live.id,
      "a4",
      "z2",
      "z9",
    ]);
    expect(placeOf(stray[0])).toBeNull();
    expect(rowOfNote(stray[0])).toBe(-1);
    expect(rowOfNote(live)).toBe(0);
    expect(placeOf(live)).toBe(state.place.get(live.id));
  });
});
