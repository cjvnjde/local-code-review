import { describe, expect, test } from "bun:test";
import { bmKey, bookmarkOf, orderBookmarks, stepAt } from "./bookmarks.ts";

describe("bookmarkOf", () => {
  test("an added or context line is anchored on its new-side number", () => {
    const b = bookmarkOf("src/app.ts", { t: "add", n: 42, text: "  useThing(id)  " });
    expect(b).toMatchObject({ key: "src/app.ts|n42", file: "src/app.ts", a: "n42", side: "new", line: 42 });
    expect(b.text).toBe("useThing(id)");
  });

  test("a deleted line has only an old-side number to sit on", () => {
    expect(bookmarkOf("src/app.ts", { t: "del", o: 7, text: "gone()" }))
      .toMatchObject({ key: "src/app.ts|o7", a: "o7", side: "old", line: 7 });
  });

  test("one row holds one bookmark, so the same row keys to the same bookmark", () => {
    const row = { t: "ctx", n: 3, o: 3, text: "x" };
    expect(bookmarkOf("a.ts", row).key).toBe(bookmarkOf("a.ts", row).key);
    expect(bmKey("a.ts", "n3")).toBe(bookmarkOf("a.ts", row).key);
  });
});

// Two files, whose rows the diff currently places at these indices.
const PLACES: Record<string, { fi: number; i: number }> = {
  "a.ts|n10": { fi: 0, i: 4 },
  "a.ts|n90": { fi: 0, i: 30 },
  "b.ts|n2": { fi: 1, i: 1 },
};
const place = (b: any) => PLACES[b.key] || { fi: -1, i: -1 };
const bm = (key: string) => ({ key });
const keys = (list: any[]) => list.map((e) => e.b.key);

describe("orderBookmarks", () => {
  test("the list reads down the diff whatever order the bookmarks were made in", () => {
    const out = orderBookmarks([bm("b.ts|n2"), bm("a.ts|n90"), bm("a.ts|n10")], place);
    expect(keys(out)).toEqual(["a.ts|n10", "a.ts|n90", "b.ts|n2"]);
    expect(out.every((e) => !e.gone)).toBe(true);
  });

  test("a bookmark this diff cannot place is marked gone and sinks below the rest", () => {
    const out = orderBookmarks([bm("old.ts|n5"), bm("a.ts|n10"), bm("a.ts|n999")], place);
    expect(keys(out)).toEqual(["a.ts|n10", "old.ts|n5", "a.ts|n999"]);
    expect(out.map((e) => e.gone)).toEqual([false, true, true]);
  });

  test("a gone row in a live file still sinks below every live bookmark", () => {
    const rowless = (b: any) => (b.key === "a.ts|n999" ? { fi: 0, i: -1 } : place(b));
    const out = orderBookmarks([bm("a.ts|n10"), bm("a.ts|n999"), bm("b.ts|n2")], rowless);
    expect(keys(out)).toEqual(["a.ts|n10", "b.ts|n2", "a.ts|n999"]);
    expect(out.map((e) => e.gone)).toEqual([false, false, true]);
  });

  test("nothing bookmarked is an empty list, not a placeholder", () => {
    expect(orderBookmarks([], place)).toEqual([]);
  });
});

describe("stepAt", () => {
  test("stepping from nowhere enters at the end the step comes from", () => {
    expect(stepAt(3, -1, 1)).toBe(0);
    expect(stepAt(3, -1, -1)).toBe(2);
  });

  test("both ends wrap, so two bookmarks are one step from each other either way", () => {
    expect(stepAt(2, 0, 1)).toBe(1);
    expect(stepAt(2, 1, 1)).toBe(0);
    expect(stepAt(2, 0, -1)).toBe(1);
  });

  test("an empty list has nowhere to step to", () => {
    expect(stepAt(0, -1, 1)).toBe(-1);
    expect(stepAt(0, 0, -1)).toBe(-1);
  });

  test("a cursor left past the end of a shortened list re-enters at the near end", () => {
    expect(stepAt(2, 5, 1)).toBe(0);
    expect(stepAt(2, 5, -1)).toBe(1);
  });
});
