import { describe, expect, test } from "bun:test";
import { wordDiff } from "./word-diff.ts";

type Row = {
  t: "add" | "ctx" | "del" | "hunk";
  text: string;
};

const ranges = (rows: Row[]) => [...wordDiff({ rows }).entries()];

describe("wordDiff", () => {
  test("highlights the complete identifier when its middle changes", () => {
    expect(ranges([
      { t: "del", text: "const oldName = value;" },
      { t: "add", text: "const newName = value;" },
    ])).toEqual([
      [0, [6, 13]],
      [1, [6, 13]],
    ]);
  });

  test("keeps shared punctuation outside the changed range", () => {
    expect(ranges([
      { t: "del", text: "return count + 10;" },
      { t: "add", text: "return count + 20;" },
    ])).toEqual([
      [0, [15, 17]],
      [1, [15, 17]],
    ]);
  });

  test("marks only the new side when text is inserted", () => {
    expect(ranges([
      { t: "del", text: "return value;" },
      { t: "add", text: "return value ?? fallback;" },
    ])).toEqual([[1, [12, 24]]]);
  });

  test("marks only the old side when text is removed", () => {
    expect(ranges([
      { t: "del", text: "return value ?? fallback;" },
      { t: "add", text: "return value;" },
    ])).toEqual([[0, [12, 24]]]);
  });

  test("leaves identical replacement lines unmarked", () => {
    expect(ranges([
      { t: "del", text: "same();" },
      { t: "add", text: "same();" },
    ])).toEqual([]);
  });

  test("leaves unrelated replacement lines to the line-level coloring", () => {
    expect(ranges([
      { t: "del", text: "alpha" },
      { t: "add", text: "zzzzz" },
    ])).toEqual([]);
  });

  test("pairs unequal runs by similarity instead of line position", () => {
    expect(ranges([
      { t: "del", text: "const alpha = load();" },
      { t: "del", text: "return alpha;" },
      { t: "add", text: "return beta;" },
      { t: "add", text: "trace();" },
      { t: "add", text: "const beta = load();" },
    ])).toEqual([
      [0, [6, 11]],
      [4, [6, 10]],
      [1, [7, 12]],
      [2, [7, 11]],
    ]);
  });

  test("does not force an unrelated line into an unequal pairing", () => {
    expect(ranges([
      { t: "del", text: "alpha alpha" },
      { t: "del", text: "keep this value" },
      { t: "add", text: "keep that value" },
    ])).toEqual([
      [1, [5, 9]],
      [2, [5, 9]],
    ]);
  });

  test("keeps separate change runs independent", () => {
    expect(ranges([
      { t: "del", text: "oldName()" },
      { t: "add", text: "newName()" },
      { t: "ctx", text: "kept" },
      { t: "del", text: "left = 1" },
      { t: "add", text: "left = 2" },
    ])).toEqual([
      [0, [0, 7]],
      [1, [0, 7]],
      [3, [7, 8]],
      [4, [7, 8]],
    ]);
  });

  test("a deletion with no following addition has no word-level pair", () => {
    expect(ranges([
      { t: "del", text: "removed();" },
      { t: "ctx", text: "kept();" },
    ])).toEqual([]);
  });

  test("reuses the file cache once ranges have been calculated", () => {
    const cached = new Map([[4, [2, 5]]]);
    const file = { rows: [], wd: cached };

    expect(wordDiff(file)).toBe(cached);
  });
});
