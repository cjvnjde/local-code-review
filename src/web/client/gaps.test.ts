import { describe, expect, test } from "bun:test";
import { expandRange, gapOf, gapSize, hasTail, insertContext, markTails, retitle } from "./gaps.ts";

/** Two hunks over a file whose new-side lines 4-10 the diff left out, and which runs on past line 12. */
const sample = () => ({
  rows: [
    { t: "hunk", text: "@@ -1,2 +1,3 @@ function a()", head: " function a()" },
    { t: "ctx", o: 1, n: 1, text: "a" },
    { t: "add", n: 2, text: "b" },
    { t: "ctx", o: 2, n: 3, text: "c" },
    { t: "hunk", text: "@@ -10,3 +11,2 @@ function b()", head: " function b()" },
    { t: "ctx", o: 10, n: 11, text: "j" },
    { t: "del", o: 11, text: "k" },
    { t: "ctx", o: 12, n: 12, text: "l" },
  ] as any[],
});
/** Context rows the server would answer with for an inclusive new-side range. */
const ctx = (from: number, to: number, shift = 1) => {
  const rows = [];
  for (let n = from; n <= to; n++) rows.push({ t: "ctx", o: n - shift, n, text: "line " + n });
  return rows;
};

describe("gapOf", () => {
  test("reads the hidden run between two hunks", () => {
    const f = sample();
    expect(gapOf(f, 4)).toEqual({ from: 4, to: 10 });
    expect(gapSize(gapOf(f, 4))).toBe(7);
  });

  test("the first hunk hides everything above it", () => {
    const f = { rows: [{ t: "hunk", text: "@@ -20,1 +20,1 @@" }, { t: "ctx", o: 20, n: 20, text: "a" }] };
    expect(gapOf(f, 0)).toEqual({ from: 1, to: 19 });
  });

  test("a hunk that opens on line 1 hides nothing", () => {
    const f = { rows: [{ t: "hunk", text: "@@ -1,1 +1,1 @@" }, { t: "ctx", o: 1, n: 1, text: "a" }] };
    expect(gapOf(f, 0)).toBe(null);
  });

  test("only hunk rows carry a gap, and a hunk with no new-side lines carries none", () => {
    const f = sample();
    expect(gapOf(f, 1)).toBe(null);
    expect(gapOf({ rows: [{ t: "hunk", text: "@@ -1,1 +0,0 @@" }, { t: "del", o: 1, text: "a" }] }, 0)).toBe(null);
  });

  test("the trailing row reaches on with no known end", () => {
    const f = sample();
    markTails([f], 1);
    expect(gapOf(f, f.rows.length - 1)).toEqual({ from: 13, to: null });
    expect(gapSize(gapOf(f, f.rows.length - 1))).toBe(null);
  });
});

describe("hasTail", () => {
  const trailing = (run: number) => {
    const rows: any[] = [{ t: "hunk", text: "@@ -1,1 +1,1 @@" }, { t: "add", n: 1, text: "x" }];
    for (let k = 0; k < run; k++) rows.push({ t: "ctx", o: k + 1, n: k + 2, text: "c" });
    return { rows };
  };

  test("a full run of trailing context means the file goes on", () => {
    expect(hasTail(trailing(5), 5)).toBe(true);
    expect(hasTail(trailing(4), 5)).toBe(false);
    expect(hasTail(trailing(0), 5)).toBe(false);
  });

  test("binary files and a zero-context diff get no trailing expander", () => {
    expect(hasTail({ rows: trailing(5).rows, binary: true }, 5)).toBe(false);
    expect(hasTail(trailing(5), 0)).toBe(false);
    expect(hasTail({ rows: [] }, 5)).toBe(false);
  });

  test("markTails only appends where a tail was found", () => {
    const on = trailing(5), off = trailing(1);
    markTails([on, off], 5);
    expect(on.rows[on.rows.length - 1]).toEqual({ t: "hunk", text: "", tail: true });
    expect(off.rows.some((r: any) => r.tail)).toBe(false);
  });
});

describe("expandRange", () => {
  const gap = { from: 4, to: 10 };

  test("down walks from the top of the gap, up from its bottom", () => {
    expect(expandRange(gap, 3, "down")).toEqual({ from: 4, to: 6 });
    expect(expandRange(gap, 3, "up")).toEqual({ from: 8, to: 10 });
  });

  test("neither direction overshoots the gap, and all takes it whole", () => {
    expect(expandRange(gap, 40, "down")).toEqual({ from: 4, to: 10 });
    expect(expandRange(gap, 40, "up")).toEqual({ from: 4, to: 10 });
    expect(expandRange(gap, 3, "all")).toEqual({ from: 4, to: 10 });
  });

  test("an open-ended gap simply takes one step", () => {
    expect(expandRange({ from: 12, to: null }, 20, "down")).toEqual({ from: 12, to: 31 });
  });
});

describe("insertContext", () => {
  test("expanding down grows the hunk above and keeps its heading", () => {
    const f = sample();
    expect(insertContext(f, 4, "down", ctx(4, 6), 3)).toBe(4);
    expect(f.rows[7].t).toBe("hunk");
    expect(f.rows[7].text).toBe("@@ -10,3 +11,2 @@ function b()");
    expect(f.rows[0].text).toBe("@@ -1,5 +1,6 @@ function a()");
    expect(gapOf(f, 7)).toEqual({ from: 7, to: 10 });
  });

  test("expanding up grows the hunk below and drops a heading that no longer names it", () => {
    const f = sample();
    expect(insertContext(f, 4, "up", ctx(8, 10), 3)).toBe(5);
    expect(f.rows[4].text).toBe("@@ -7,6 +8,5 @@");
    expect(f.rows[0].text).toBe("@@ -1,2 +1,3 @@ function a()");
    expect(gapOf(f, 4)).toEqual({ from: 4, to: 7 });
  });

  test("closing a gap merges the two hunks into one header", () => {
    const f = sample();
    expect(insertContext(f, 4, "all", ctx(4, 10), 7)).toBe(4);
    expect(f.rows.filter((r: any) => r.t === "hunk")).toHaveLength(1);
    expect(f.rows[0].text).toBe("@@ -1,12 +1,12 @@ function a()");
    expect(gapOf(f, 0)).toBe(null);
  });

  test("a full answer on the trailing row keeps it, a short one means end of file", () => {
    const going = sample(), done = sample();
    markTails([going, done], 1);
    const tail = going.rows.length - 1;
    expect(insertContext(going, tail, "down", ctx(13, 15, 0), 3)).toBe(tail);
    expect(going.rows[going.rows.length - 1].tail).toBe(true);
    expect(insertContext(done, tail, "down", ctx(13, 14, 0), 3)).toBe(tail);
    expect(done.rows.some((r: any) => r.tail)).toBe(false);
  });

  test("an empty answer reports nothing inserted", () => {
    const f = sample();
    markTails([f], 1);
    expect(insertContext(f, f.rows.length - 1, "down", [], 3)).toBe(-1);
  });

  test("row-indexed caches are dropped, since every index below the splice moved", () => {
    const f: any = sample();
    f.wd = new Map(); f.ki = new Map();
    insertContext(f, 4, "down", ctx(4, 6), 3);
    expect(f.wd).toBeUndefined();
    expect(f.ki).toBeUndefined();
  });
});

describe("retitle", () => {
  test("a hunk with no old-side lines reports a zero range", () => {
    const f = { rows: [{ t: "hunk", text: "x" }, { t: "add", n: 1, text: "a" }] };
    retitle(f, 0);
    expect(f.rows[0].text).toBe("@@ -0,0 +1,1 @@");
  });

  test("the trailing row and code rows are left alone", () => {
    const f = { rows: [{ t: "hunk", text: "", tail: true }, { t: "ctx", o: 1, n: 1, text: "a" }] };
    retitle(f, 0); retitle(f, 1);
    expect(f.rows[0].text).toBe("");
    expect(f.rows[1].text).toBe("a");
  });
});
