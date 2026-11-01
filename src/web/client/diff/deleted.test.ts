import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  delKey,
  delRunAt,
  delRuns,
  drawnRows,
  foldingDeleted,
  revealRow,
  toggleFileFold,
  toggleRun,
} from "./deleted.ts";
import { resolutionKey, state } from "../app/state.ts";

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

let saved: Pick<
  typeof state,
  "openDel" | "delFold" | "notes" | "place" | "resolved" | "showResolved"
> & { foldDel: boolean };
beforeEach(() => {
  saved = {
    foldDel: state.cfg.foldDel,
    openDel: state.openDel,
    delFold: state.delFold,
    notes: state.notes,
    place: state.place,
    resolved: state.resolved,
    showResolved: state.showResolved,
  };
  state.cfg.foldDel = false;
  state.openDel = new Set();
  state.delFold = new Map();
  state.notes = new Map();
  state.place = new Map();
  state.resolved = new Map();
  state.showResolved = false;
});
afterEach(() => {
  const { foldDel, ...rest } = saved;
  state.cfg.foldDel = foldDel;
  Object.assign(state, rest);
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
    expect(runs.get(1)).toMatchObject({
      start: 1,
      end: 2,
      count: 2,
      open: false,
    });
    expect(runs.get(5)).toMatchObject({
      start: 5,
      end: 5,
      count: 1,
      open: false,
    });
    // Each folded run gives its rows back and costs one marker line instead.
    expect(drawnRows(f, 0, f.rows.length)).toBe(7 - 2 + 1 - 1 + 1);
  });

  test("cuts a run at the edges of the block that draws it", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" ---- ");
    expect(delRuns(f, 0, 3).get(1)).toMatchObject({
      start: 1,
      end: 2,
      count: 2,
    });
    expect(delRuns(f, 3, 6).get(3)).toMatchObject({
      start: 3,
      end: 4,
      count: 2,
    });
    expect(drawnRows(f, 0, 3)).toBe(2);
  });

  test("keys a run on the line it removes, not on its row index", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --");
    expect(delKey(f, 1)).toBe("src/a.ts|o2");
    const grown = {
      ...f,
      rows: [{ t: "ctx", n: 0, o: 0, text: "revealed" }, ...f.rows],
    };
    toggleRun(f, 1);
    expect(delKey(grown, 2)).toBe("src/a.ts|o2");
    expect(delRuns(grown, 0, grown.rows.length).get(2)?.open).toBe(true);
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
    expect(delRuns(f, 0, f.rows.length).get(1)).toMatchObject({
      noted: false,
      open: false,
    });
    noteOn("src/other.ts", 2, 2);
    expect(delRuns(f, 0, f.rows.length).get(1)).toMatchObject({
      noted: false,
      open: false,
    });
  });

  test("a jump opens the fold over the row it is going to, once", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --- ");
    expect(delRunAt(f, 3, 0, f.rows.length)).toMatchObject({
      start: 1,
      end: 3,
    });
    expect(delRunAt(f, 0, 0, f.rows.length)).toBe(null);
    expect(revealRow(f, 3, 0, f.rows.length)).toBe(true);
    expect(state.openDel.has("src/a.ts|o2")).toBe(true);
    expect(revealRow(f, 3, 0, f.rows.length)).toBe(false);
    expect(revealRow(f, 0, 0, f.rows.length)).toBe(false);
  });

  test("a file answers for itself, and the setting is only its default", () => {
    const f = fileOf(" -- ", "src/a.ts");
    const other = fileOf(" -- ", "src/b.ts");
    // Folding one file while the setting is off leaves every other file alone.
    expect(toggleFileFold(f.path)).toBe(true);
    expect(foldingDeleted(f.path)).toBe(true);
    expect(delRuns(f, 0, f.rows.length).size).toBe(1);
    expect(delRuns(other, 0, other.rows.length).size).toBe(0);
    // And opening one file inside a folded diff is the same answer the other way.
    state.cfg.foldDel = true;
    expect(toggleFileFold(f.path)).toBe(false);
    expect(delRuns(f, 0, f.rows.length).size).toBe(0);
    expect(delRuns(other, 0, other.rows.length).size).toBe(1);
    // The setting moving does not take that answer back.
    state.cfg.foldDel = false;
    expect(foldingDeleted(f.path)).toBe(false);
    expect(foldingDeleted()).toBe(false);
  });

  test("folding a file again folds all of it, and leaves other files' runs open", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" -- - ", "src/a.ts");
    toggleRun(f, 1);
    toggleRun(fileOf(" --", "src/b.ts"), 1);
    expect(toggleFileFold(f.path)).toBe(false); // opened whole
    expect(state.openDel.has("src/a.ts|o2")).toBe(false);
    expect(state.openDel.has("src/b.ts|o2")).toBe(true);
  });

  test("hunk rows break a run, and a binary file has none", () => {
    state.cfg.foldDel = true;
    const f = fileOf("-@-");
    expect([...delRuns(f, 0, f.rows.length).keys()]).toEqual([0, 2]);
    expect(delRuns({ path: "b.png", rows: [], binary: true }, 0, 0).size).toBe(
      0,
    );
  });

  test("a note touching either edge opens only the intersected run", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" -- -- ");
    for (const [i, j, expected] of [
      [0, 1, [true, false]],
      [2, 3, [true, false]],
      [3, 4, [false, true]],
      [5, 6, [false, true]],
      [2, 4, [true, true]],
    ] as const) {
      noteOn(f.path, i, j);
      expect(
        [...delRuns(f, 0, f.rows.length).values()].map((r) => r.noted),
      ).toEqual(expected);
    }
  });

  test("outdated notes do not pin runs open and a row outside the block cannot reveal one", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" -- ");
    noteOn(f.path, -1, -1);
    expect(delRuns(f, 0, f.rows.length).get(1)?.open).toBe(false);
    state.notes.clear();
    state.place.clear();
    expect(revealRow(f, 2, 0, 2)).toBe(false);
    expect(state.openDel.size).toBe(0);
  });

  test("file toggles clear exact path keys, including pipe-containing paths, not prefixes", () => {
    state.cfg.foldDel = true;
    const path = "src/a|b.ts";
    state.openDel = new Set([
      path + "|o1",
      path + "|o5",
      path + ".bak|o1",
      "src/a|o1",
    ]);
    expect(toggleFileFold(path)).toBe(false);
    expect([...state.openDel]).toEqual([path + ".bak|o1", "src/a|o1"]);
  });

  test("drawn row counts reflect closed, opened and note-pinned runs without mutating rows", () => {
    state.cfg.foldDel = true;
    const f = fileOf("--+--- "),
      original = structuredClone(f.rows);
    expect(drawnRows(f, 0, f.rows.length)).toBe(4);
    expect(revealRow(f, 1, 0, f.rows.length)).toBe(true);
    expect(drawnRows(f, 0, f.rows.length)).toBe(6);
    noteOn(f.path, 4, 4);
    expect(drawnRows(f, 0, f.rows.length)).toBe(9);
    expect(f.rows).toEqual(original);
    expect(delRuns(f, 2, 2).size).toBe(0);
    expect(drawnRows(f, 2, 2)).toBe(0);
  });

  test("resolved-note visibility controls whether its deleted subject must stay open", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" -- ");
    noteOn(f.path, 1, 2);
    const n = state.notes.get("n1");
    state.resolved.set(n.id, resolutionKey(n));
    expect(delRuns(f, 0, f.rows.length).get(1)).toMatchObject({
      noted: false,
      open: false,
    });
    state.showResolved = true;
    expect(delRuns(f, 0, f.rows.length).get(1)).toMatchObject({
      noted: true,
      open: true,
    });
    expect(state.openDel.size).toBe(0);
  });

  test("revealing the first row of a deletion run opens that run, not just interior rows", () => {
    state.cfg.foldDel = true;
    const f = fileOf(" --- ");
    expect(delRunAt(f, 1, 0, f.rows.length)).toMatchObject({
      start: 1,
      end: 3,
    });
    expect(revealRow(f, 1, 0, f.rows.length)).toBe(true);
    expect(revealRow(f, 1, 0, f.rows.length)).toBe(false);
    expect(foldingDeleted(undefined)).toBe(true);
  });
});
