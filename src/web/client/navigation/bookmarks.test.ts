import { describe, expect, test } from "bun:test";
import {
  bmKey,
  bookmarkOf,
  bookmarksIn,
  orderBookmarks,
  stepAt,
} from "./bookmarks.ts";

describe("bookmarkOf", () => {
  test("an added or context line is anchored on its new-side number", () => {
    const b = bookmarkOf("src/app.ts", {
      t: "add",
      n: 42,
      text: "  useThing(id)  ",
    });
    expect(b).toMatchObject({
      key: "src/app.ts|n42",
      file: "src/app.ts",
      a: "n42",
      side: "new",
      line: 42,
    });
    expect(b.text).toBe("useThing(id)");
  });

  test("a deleted line has only an old-side number to sit on", () => {
    expect(
      bookmarkOf("src/app.ts", { t: "del", o: 7, text: "gone()" }),
    ).toMatchObject({ key: "src/app.ts|o7", a: "o7", side: "old", line: 7 });
  });

  test("one row holds one bookmark, so the same row keys to the same bookmark", () => {
    const row = { t: "ctx", n: 3, o: 3, text: "x" };
    expect(bookmarkOf("a.ts", row).key).toBe(bookmarkOf("a.ts", row).key);
    expect(bmKey("a.ts", "n3")).toBe(bookmarkOf("a.ts", row).key);
  });
});

describe("bookmarksIn", () => {
  const kept = { key: "a.ts|n3", file: "a.ts", a: "n3" };

  test("a record made in this read hands its bookmarks back", () => {
    expect(bookmarksIn({ scope: "r1:HEAD", list: [kept] }, "r1:HEAD")).toEqual([
      kept,
    ]);
  });

  test("another repository's record is not this read's, whatever the diff is called", () => {
    expect(bookmarksIn({ scope: "r2:HEAD", list: [kept] }, "r1:HEAD")).toEqual(
      [],
    );
  });

  test("the same repository read over a different range starts empty", () => {
    expect(
      bookmarksIn({ scope: "r1:HEAD~1..HEAD", list: [kept] }, "r1:HEAD"),
    ).toEqual([]);
  });

  test("nothing stored, or stored as something else, is no bookmarks rather than a throw", () => {
    expect(bookmarksIn(null, "r1:HEAD")).toEqual([]);
    expect(bookmarksIn({ scope: "r1:HEAD" }, "r1:HEAD")).toEqual([]);
    expect(bookmarksIn("bookmarks", "r1:HEAD")).toEqual([]);
  });

  test("an entry with no row to sit on is dropped, since nothing could place it", () => {
    const list = [kept, null, { key: "b.ts|n1" }, { file: "b.ts", a: "n1" }];
    expect(bookmarksIn({ scope: "r1:HEAD", list }, "r1:HEAD")).toEqual([kept]);
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
    const out = orderBookmarks(
      [bm("b.ts|n2"), bm("a.ts|n90"), bm("a.ts|n10")],
      place,
    );
    expect(keys(out)).toEqual(["a.ts|n10", "a.ts|n90", "b.ts|n2"]);
    expect(out.every((e) => !e.gone)).toBe(true);
  });

  test("a bookmark this diff cannot place is marked gone and sinks below the rest", () => {
    const out = orderBookmarks(
      [bm("old.ts|n5"), bm("a.ts|n10"), bm("a.ts|n999")],
      place,
    );
    expect(keys(out)).toEqual(["a.ts|n10", "old.ts|n5", "a.ts|n999"]);
    expect(out.map((e) => e.gone)).toEqual([false, true, true]);
  });

  test("a gone row in a live file still sinks below every live bookmark", () => {
    const rowless = (b: any) =>
      b.key === "a.ts|n999" ? { fi: 0, i: -1 } : place(b);
    const out = orderBookmarks(
      [bm("a.ts|n10"), bm("a.ts|n999"), bm("b.ts|n2")],
      rowless,
    );
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

describe("bookmark invariants", () => {
  test("context chooses the new side even when old line numbers differ or the new number is zero", () => {
    const row = { t: "ctx", n: 0, o: 90, text: "  kept  " };
    expect(bookmarkOf("a|b.ts", row)).toEqual({
      key: "a|b.ts|n0",
      file: "a|b.ts",
      a: "n0",
      side: "new",
      line: 0,
      text: "kept",
    });
    expect(bookmarkOf("a.ts", { ...row, n: 2 }).key).not.toBe(
      bookmarkOf("b.ts", { ...row, n: 2 }).key,
    );
    expect(bookmarkOf("a.ts", { t: "del", o: 2, text: "old" }).key).not.toBe(
      bookmarkOf("a.ts", { t: "add", n: 2, text: "new" }).key,
    );
  });

  test("line previews bound long text but leave anchor identity independent of its contents", () => {
    const row = { t: "add", n: 8, text: "  " + "x".repeat(200) + "  " };
    const bookmark = bookmarkOf("a.ts", row);
    expect(bookmark.text.length).toBeLessThanOrEqual(120);
    expect(bookmark.text).toContain("x".repeat(100));
    expect(bookmark.key).toBe(
      bookmarkOf("a.ts", { ...row, text: "edited" }).key,
    );
    expect(row.text.length).toBe(204);
  });

  test("sorting preserves caller order and object identity for tied live and gone bookmarks", () => {
    const bookmarks = ["gone1", "live1", "gone2", "live2"].map((key) => ({
      key,
    }));
    const out = orderBookmarks(bookmarks, (b) =>
      b.key.startsWith("live") ? { fi: 0, i: 2 } : { fi: -1, i: 0 },
    );
    expect(keys(out)).toEqual(["live1", "live2", "gone1", "gone2"]);
    expect(bookmarks.map((b) => b.key)).toEqual([
      "gone1",
      "live1",
      "gone2",
      "live2",
    ]);
    expect(out[0]!.b).toBe(bookmarks[1]);
    expect(out.map((e) => e.gone)).toEqual([false, false, true, true]);
  });

  test("a full traversal visits every bookmark once, wraps, and reversing undoes each step", () => {
    for (let length = 1; length <= 8; length++) {
      for (const dir of [-1, 1]) {
        const visited: number[] = [];
        let current = -1;
        for (let i = 0; i < length; i++) {
          current = stepAt(length, current, dir);
          visited.push(current);
          expect(stepAt(length, stepAt(length, current, dir), -dir)).toBe(
            current,
          );
        }
        expect(new Set(visited).size).toBe(length);
        expect(stepAt(length, current, dir)).toBe(visited[0]!);
      }
    }
  });

  test("navigation follows reading order, not its reverse, and a cursor equal to length is already gone", () => {
    expect([0, 1, 2, 3].map((i) => stepAt(4, i, 1))).toEqual([1, 2, 3, 0]);
    expect([0, 1, 2, 3].map((i) => stepAt(4, i, -1))).toEqual([3, 0, 1, 2]);
    expect(stepAt(4, 4, 1)).toBe(0);
    expect(stepAt(4, 4, -1)).toBe(3);
  });

  test("a bookmark at row zero is live and sorts before subsequent rows", () => {
    const list = [{ key: "later" }, { key: "first" }, { key: "gone" }];
    const sorted = orderBookmarks(list, (b) => ({
      fi: 0,
      i: b.key === "first" ? 0 : b.key === "later" ? 2 : -1,
    }));
    expect(keys(sorted)).toEqual(["first", "later", "gone"]);
    expect(sorted.map((e) => e.gone)).toEqual([false, false, true]);
  });
});
