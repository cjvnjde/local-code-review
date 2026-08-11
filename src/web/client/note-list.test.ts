import { describe, expect, test } from "bun:test";
import { FILTERS, groupNotes, matchesFilter, noteSummary, orderNotes } from "./note-list.ts";

// Notes as the list sees them: an id to recognise, the file they belong to, and where they started.
const note = (id: string, file: string, start = 0) => ({ id, file, start, body: "" });
const ids = (list: any[]) => list.map((e) => e.n.id);

describe("orderNotes", () => {
  // Two files at indices 0 and 1, with each note's placement given by id.
  const PLACES: Record<string, any> = {
    a1: { fi: 0, i: 4, how: "exact" },
    a2: { fi: 0, i: 30, how: "moved" },
    b1: { fi: 1, i: 1, how: "near" },
  };
  const at = (n: any) => PLACES[n.id] || null;

  test("the list reads down the diff, whatever order the notes were written in", () => {
    const out = orderNotes([note("b1", "b.ts"), note("a2", "a.ts"), note("a1", "a.ts")], at);
    expect(ids(out)).toEqual(["a1", "a2", "b1"]);
    expect(out.every((e) => !e.gone)).toBe(true);
  });

  test("a file's own note comes before the lines of that file", () => {
    const places = (n: any) => (n.id === "af" ? { fi: 0, i: -1, how: "file" } : at(n));
    expect(ids(orderNotes([note("a1", "a.ts"), note("af", "a.ts")], places))).toEqual(["af", "a1"]);
  });

  test("a note with no line left in its file comes after every note that has one", () => {
    const places = (n: any) => (n.id === "al" ? { fi: 0, i: -1, how: "loose" } : at(n));
    const out = orderNotes([note("al", "a.ts"), note("b1", "b.ts"), note("a1", "a.ts")], places);
    expect(ids(out)).toEqual(["a1", "al", "b1"]);
    expect(out.every((e) => !e.gone)).toBe(true);
  });

  test("a note whose file left the diff is gone, and sinks below every placed note", () => {
    const out = orderNotes([note("x", "old.ts"), note("b1", "b.ts"), note("a1", "a.ts")], at);
    expect(ids(out)).toEqual(["a1", "b1", "x"]);
    expect(out.map((e) => e.gone)).toEqual([false, false, true]);
  });

  test("notes with nowhere to go read by file and then by the line they were written on", () => {
    const out = orderNotes([note("s2", "z.ts", 9), note("s1", "z.ts", 2), note("s0", "a.ts", 5)], () => null);
    expect(ids(out)).toEqual(["s0", "s1", "s2"]);
  });

  test("a note about the review as a whole reads before the first file, and never counts as gone", () => {
    const places = (n: any) => (n.id.startsWith("g") ? { fi: -1, i: -1, how: "global" } : at(n));
    const out = orderNotes([note("a1", "a.ts"), note("g2", ""), note("g1", "")], places);
    // Two of them keep the order they were written in: neither has a place to be sorted by.
    expect(ids(out)).toEqual(["g2", "g1", "a1"]);
    expect(out.every((e) => !e.gone)).toBe(true);
  });

  test("no notes is an empty list rather than a placeholder", () => {
    expect(orderNotes([], at)).toEqual([]);
  });
});

describe("groupNotes", () => {
  const entry = (id: string, file: string, fi: number, gone = false) =>
    ({ n: note(id, file), fi, rank: 1, i: 0, how: gone ? "stray" : "exact", gone });

  test("consecutive notes on one file read under one heading", () => {
    const out = groupNotes([entry("a1", "a.ts", 0), entry("a2", "a.ts", 0), entry("b1", "b.ts", 1)]);
    expect(out.map((g) => [g.path, g.entries.length])).toEqual([["a.ts", 2], ["b.ts", 1]]);
    expect(out.every((g) => !g.stray)).toBe(true);
  });

  test("notes with nowhere to go share one group, whatever files they came from", () => {
    const out = groupNotes([entry("a1", "a.ts", 0), entry("x", "old.ts", -1, true), entry("y", "gone.ts", -1, true)]);
    expect(out.length).toBe(2);
    expect(out[1]).toMatchObject({ stray: true, path: "", fi: -1 });
    expect(out[1].entries.length).toBe(2);
  });

  test("a file actually called ' stray' is still its own group", () => {
    const out = groupNotes([entry("s", " stray", 0), entry("x", "old.ts", -1, true)]);
    expect(out.map((g) => g.stray)).toEqual([false, true]);
  });

  test("notes about the review as a whole share one group of their own", () => {
    const global = (id: string) => ({ n: note(id, ""), fi: -1, rank: 0, i: -1, how: "global", gone: false });
    const out = groupNotes([global("g1"), global("g2"), entry("a1", "a.ts", 0)]);
    expect(out.map((g) => [g.global, g.entries.length])).toEqual([[true, 2], [false, 1]]);
    expect(out[0]).toMatchObject({ path: "", fi: -1, stray: false });
  });

  test("nothing to group is no groups", () => {
    expect(groupNotes([])).toEqual([]);
  });
});

describe("matchesFilter", () => {
  test("all keeps every note, however it stands", () => {
    expect(matchesFilter("all", 0, "applied")).toBe(true);
    expect(matchesFilter("all", 0, null)).toBe(true);
  });

  test("new is exactly the notes with something unread in them", () => {
    expect(matchesFilter("new", 1, "applied")).toBe(true);
    expect(matchesFilter("new", 0, null)).toBe(false);
  });

  test("a note nobody has answered yet is open, and so is one still asking", () => {
    expect(matchesFilter("open", 0, null)).toBe(true);
    expect(matchesFilter("open", 0, "pending")).toBe(true);
    expect(matchesFilter("open", 0, "needs-input")).toBe(true);
    expect(matchesFilter("open", 0, "unknown")).toBe(true);
  });

  test("done is the three verdicts that finish a note, and nothing else", () => {
    expect(["applied", "answered", "skipped"].map((s) => matchesFilter("done", 0, s))).toEqual([true, true, true]);
    expect(matchesFilter("done", 0, "pending")).toBe(false);
    expect(matchesFilter("done", 0, null)).toBe(false);
  });

  test("a status kind nobody here has heard of counts as open rather than as finished", () => {
    expect(matchesFilter("open", 0, "escalated")).toBe(true);
    expect(matchesFilter("done", 0, "escalated")).toBe(false);
  });

  test("every chip the panel offers is a filter this understands", () => {
    expect(FILTERS.every((f) => matchesFilter(f, 1, null) || matchesFilter(f, 0, "applied"))).toBe(true);
  });
});

describe("noteSummary", () => {
  test("the first line of prose is what names a note", () => {
    expect(noteSummary("  \nThis leaks the handle.\nSecond line.")).toBe("This leaks the handle.");
  });

  test("a note that only proposes a replacement says so, instead of quoting the code", () => {
    expect(noteSummary("```suggestion\nconst a = 1\n```")).toBe("suggested change");
  });

  test("prose around a suggestion still wins over the block", () => {
    expect(noteSummary("```suggestion\nconst a = 1\n```\n\nUse the helper.")).toBe("Use the helper.");
  });

  test("an empty note has nothing to say for itself", () => {
    expect(noteSummary("")).toBe("");
    expect(noteSummary("   \n\n")).toBe("");
  });
});
