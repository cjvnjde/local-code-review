import { describe, expect, test } from "bun:test";
import { wordDiff } from "./word-diff.ts";

type Row = {
  t: "add" | "ctx" | "del" | "hunk";
  text: string;
};

const ranges = (rows: Row[]) => [...wordDiff({ rows }).entries()];

describe("wordDiff", () => {
  test("highlights the complete identifier when its middle changes", () => {
    expect(
      ranges([
        { t: "del", text: "const oldName = value;" },
        { t: "add", text: "const newName = value;" },
      ]),
    ).toEqual([
      [0, [6, 13]],
      [1, [6, 13]],
    ]);
  });

  test("keeps shared punctuation outside the changed range", () => {
    expect(
      ranges([
        { t: "del", text: "return count + 10;" },
        { t: "add", text: "return count + 20;" },
      ]),
    ).toEqual([
      [0, [15, 17]],
      [1, [15, 17]],
    ]);
  });

  test("marks only the new side when text is inserted", () => {
    expect(
      ranges([
        { t: "del", text: "return value;" },
        { t: "add", text: "return value ?? fallback;" },
      ]),
    ).toEqual([[1, [12, 24]]]);
  });

  test("marks only the old side when text is removed", () => {
    expect(
      ranges([
        { t: "del", text: "return value ?? fallback;" },
        { t: "add", text: "return value;" },
      ]),
    ).toEqual([[0, [12, 24]]]);
  });

  test("leaves identical replacement lines unmarked", () => {
    expect(
      ranges([
        { t: "del", text: "same();" },
        { t: "add", text: "same();" },
      ]),
    ).toEqual([]);
  });

  test("leaves unrelated replacement lines to the line-level coloring", () => {
    expect(
      ranges([
        { t: "del", text: "alpha" },
        { t: "add", text: "zzzzz" },
      ]),
    ).toEqual([]);
  });

  test("pairs unequal runs by similarity instead of line position", () => {
    expect(
      ranges([
        { t: "del", text: "const alpha = load();" },
        { t: "del", text: "return alpha;" },
        { t: "add", text: "return beta;" },
        { t: "add", text: "trace();" },
        { t: "add", text: "const beta = load();" },
      ]),
    ).toEqual([
      [0, [6, 11]],
      [4, [6, 10]],
      [1, [7, 12]],
      [2, [7, 11]],
    ]);
  });

  test("does not force an unrelated line into an unequal pairing", () => {
    expect(
      ranges([
        { t: "del", text: "alpha alpha" },
        { t: "del", text: "keep this value" },
        { t: "add", text: "keep that value" },
      ]),
    ).toEqual([
      [1, [5, 9]],
      [2, [5, 9]],
    ]);
  });

  test("keeps separate change runs independent", () => {
    expect(
      ranges([
        { t: "del", text: "oldName()" },
        { t: "add", text: "newName()" },
        { t: "ctx", text: "kept" },
        { t: "del", text: "left = 1" },
        { t: "add", text: "left = 2" },
      ]),
    ).toEqual([
      [0, [0, 7]],
      [1, [0, 7]],
      [3, [7, 8]],
      [4, [7, 8]],
    ]);
  });

  test("a deletion with no following addition has no word-level pair", () => {
    expect(
      ranges([
        { t: "del", text: "removed();" },
        { t: "ctx", text: "kept();" },
      ]),
    ).toEqual([]);
  });

  test("reuses the file cache once ranges have been calculated", () => {
    const cached = new Map([[4, [2, 5]]]);
    const file = { rows: [], wd: cached };

    expect(wordDiff(file)).toBe(cached);
  });

  test("identifier growth includes dollar signs and underscores but stops at punctuation", () => {
    expect(
      ranges([
        { t: "del", text: "use($old_name);" },
        { t: "add", text: "use($new_name);" },
      ]),
    ).toEqual([
      [0, [4, 13]],
      [1, [4, 13]],
    ]);
    expect(
      ranges([
        { t: "del", text: "a.b" },
        { t: "add", text: "a+b" },
      ]),
    ).toEqual([
      [0, [1, 2]],
      [1, [1, 2]],
    ]);
  });

  test("a shared prefix or suffix cannot overlap when one line is a repeated substring", () => {
    expect(
      ranges([
        { t: "del", text: "x x" },
        { t: "add", text: "x x x" },
      ]),
    ).toEqual([[1, [3, 5]]]);
    expect(
      ranges([
        { t: "del", text: " x" },
        { t: "add", text: "x" },
      ]),
    ).toEqual([[0, [0, 1]]]);
  });

  test("pure additions, empty replacements and hunk-separated changes have no false pairing", () => {
    for (const rows of [
      [{ t: "add", text: "new" }],
      [
        { t: "del", text: "" },
        { t: "add", text: "" },
      ],
      [
        { t: "del", text: "old();" },
        { t: "hunk", text: "@@" },
        { t: "add", text: "new();" },
      ],
    ] as Row[][])
      expect(ranges(rows)).toEqual([]);
  });

  test("unequal matching never reuses the same replacement for two removed lines", () => {
    expect(
      ranges([
        { t: "del", text: "return alpha;" },
        { t: "del", text: "return gamma;" },
        { t: "add", text: "return beta;" },
      ]),
    ).toEqual([
      [0, [7, 12]],
      [2, [7, 11]],
    ]);
  });

  test("the minimum relatedness boundary is inclusive", () => {
    expect(
      ranges([
        { t: "del", text: "aXXXX" },
        { t: "add", text: "aYYYY" },
      ]),
    ).toEqual([
      [0, [0, 5]],
      [1, [0, 5]],
    ]);
    expect(
      ranges([
        { t: "del", text: "aXXXXX" },
        { t: "add", text: "aYYYYY" },
      ]),
    ).toEqual([]);
  });

  test("equal multi-line replacement runs retain positional pairing for every line", () => {
    expect(
      ranges([
        { t: "del", text: "const first = 1;" },
        { t: "del", text: "return second;" },
        { t: "add", text: "const first = 2;" },
        { t: "add", text: "return third;" },
      ]),
    ).toEqual([
      [0, [14, 15]],
      [2, [14, 15]],
      [1, [7, 13]],
      [3, [7, 12]],
    ]);
  });

  test("unequal pairing uses the longer line to enforce its inclusive similarity threshold", () => {
    expect(
      ranges([
        { t: "del", text: "abcXXXXXXX" },
        { t: "del", text: "unrelated" },
        { t: "add", text: "abcYYYYYYY" },
      ]),
    ).toEqual([
      [0, [0, 10]],
      [2, [0, 10]],
    ]);
    expect(
      ranges([
        { t: "del", text: "ab" },
        { t: "del", text: "unrelated" },
        { t: "add", text: "ab12345678" },
      ]),
    ).toEqual([]);
  });

  test("unequal score ties retain the first available replacement rather than jumping to a later one", () => {
    expect(
      ranges([
        { t: "del", text: "return old;" },
        { t: "add", text: "return one;" },
        { t: "add", text: "return two;" },
      ]),
    ).toEqual([
      [0, [7, 10]],
      [1, [7, 10]],
    ]);
  });

  test("bounded unequal matching uses similarity through its budget then falls back to positional pairs", () => {
    const removed: Row[] = Array.from({ length: 8 }, (_, i) => ({
      t: "del",
      text: `item${i} = old;`,
    }));
    const added: Row[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        t: "add" as const,
        text: `item${7 - i} = new;`,
      })),
      ...Array.from({ length: 24 }, () => ({
        t: "add" as const,
        text: "unrelated",
      })),
    ];
    const bounded = wordDiff({ rows: [...removed, ...added] });
    expect(bounded.get(0)).toEqual([8, 11]);
    expect(bounded.get(15)).toEqual([8, 11]);
    expect(bounded.size).toBe(16);
    const fallback = wordDiff({
      rows: [...removed, ...added, { t: "add", text: "extra" }],
    });
    expect(fallback.get(0)).toEqual([0, 11]);
    expect(fallback.get(8)).toEqual([0, 11]);
    expect(fallback.size).toBe(16);
  });
});
