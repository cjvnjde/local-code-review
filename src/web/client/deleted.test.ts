import { afterEach, describe, expect, test } from "bun:test";
import { delKey, delRunAt, delRuns, drawnRows, foldingDeleted, revealRow, toggleRun } from "./deleted.ts";
import { state } from "./state.ts";

/** A file whose rows read as the types given: `+` added, `-` removed, ` ` context, `@` a hunk row. */
const fileOf = (shape: string, path = "src/a.ts") => {
  let o = 1;
  let n = 1;
  const rows = [...shape].map((c) => {
    if (c === "@") return { t: "hunk", text: "@@" };
    if (c === "+") return { t: "add", n: n++, text: "added" };
    if (c === "-") return { t: "del", o: o++, text: "removed" };
    return { t: "ctx", o: o++, n: n++, text: "kept" };
  });
  return { path, rows, binary: false };
};
const noteOn = (path: string, i: number, j: number) => {
  state.notes.set("n1", { id: "n1", file: path });
  state.place.set("n1", { fi: 0, i, j, how: "exact" });
};

afterEach(() => {
  state.cfg.foldDel = false;
  state.openDel = new Set<string>();
  state.notes = new Map();
  state.place = new Map();
});

describe("folding removed lines", () => {
  test("does nothing at all while the setting is off", () => {
    const f = fileOf(" --++ ");
    expect(foldingDeleted()).toBe(false);
    expect(delRuns(f, 0, f.rows.length).size).toBe(0);
    expect(drawnRows(f, 0, f.rows.length)).toBe(6);
  });

  test("groups consecutive removed rows into one run per gap", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --+ - ");
    const runs = delRuns(f, 0, f.rows.length);
    expect([...runs.keys()]).toEqual([1, 5]);
    expect(runs.get(1)).toMatchObject({ start: 1, end: 2, count: 2, open: false });
    expect(runs.get(5)).toMatchObject({ start: 5, end: 5, count: 1, open: false });
    // Each folded run gives its rows back and costs one marker line instead.
    expect(drawnRows(f, 0, f.rows.length)).toBe(7 - 2 + 1 - 1 + 1);
  });

  test("cuts a run at the edges of the block that draws it", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" ---- ");
    expect(delRuns(f, 0, 3).get(1)).toMatchObject({ start: 1, end: 2, count: 2 });
    expect(delRuns(f, 3, 6).get(3)).toMatchObject({ start: 3, end: 4, count: 2 });
    expect(drawnRows(f, 0, 3)).toBe(2);
  });

  test("keys a run on the line it removes, not on its row index", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --");
    expect(delKey(f, 1)).toBe("src/a.ts|o2");
    // Two context lines revealed above it: same run, same key, so it stays open.
    const grown = fileOf("   --");
    expect(delKey(grown, 3)).toBe("src/a.ts|o4");
    expect(delKey(fileOf("  --"), 2)).toBe("src/a.ts|o3");
  });

  test("opens and folds one run at a time, and reports which it is", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" -- - ");
    expect(toggleRun(f, 1)).toBe(true);
    expect(state.openDel.has("src/a.ts|o2")).toBe(true);
    const runs = delRuns(f, 0, f.rows.length);
    expect(runs.get(1)!.open).toBe(true);
    expect(runs.get(4)!.open).toBe(false);
    expect(drawnRows(f, 0, f.rows.length)).toBe(6 + 1);
    expect(toggleRun(f, 1)).toBe(false);
    expect(delRuns(f, 0, f.rows.length).get(1)!.open).toBe(false);
  });

  test("a run a note is attached to stays open and says so", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --- ");
    noteOn(f.path, 2, 3);
    const run = delRuns(f, 0, f.rows.length).get(1)!;
    expect(run).toMatchObject({ noted: true, open: true });
    // Folding it away is not something a click can do while the note is on it.
    toggleRun(f, 1);
    expect(delRuns(f, 0, f.rows.length).get(1)!.open).toBe(true);
  });

  test("a note somewhere else in the file folds nothing open", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --- ");
    noteOn(f.path, 0, 0);
    expect(delRuns(f, 0, f.rows.length).get(1)).toMatchObject({ noted: false, open: false });
    noteOn("src/other.ts", 2, 2);
    expect(delRuns(f, 0, f.rows.length).get(1)).toMatchObject({ noted: false, open: false });
  });

  test("a jump opens the fold over the row it is going to, once", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --- ");
    expect(delRunAt(f, 3, 0, f.rows.length)).toMatchObject({ start: 1, end: 3 });
    expect(delRunAt(f, 0, 0, f.rows.length)).toBe(null);
    expect(revealRow(f, 3, 0, f.rows.length)).toBe(true);
    expect(state.openDel.has("src/a.ts|o2")).toBe(true);
    expect(revealRow(f, 3, 0, f.rows.length)).toBe(false);
    expect(revealRow(f, 0, 0, f.rows.length)).toBe(false);
  });

  test("hunk rows break a run, and a binary file has none", () => {
    state.cfg.foldDel = true;
    const f = fileOf("-@-");
    expect([...delRuns(f, 0, f.rows.length).keys()]).toEqual([0, 2]);
    expect(delRuns({ path: "b.png", rows: [], binary: true }, 0, 0).size).toBe(0);
  });
});
