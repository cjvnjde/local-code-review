import { describe, expect, test } from "bun:test";
import { bodyParts, capturedLines, insertBlock, lineDiff, suggestLines, suggestionBlock } from "./suggest.ts";

const ctx = (n: number, text: string) => ({ t: "ctx", o: n, n, text });
const add = (n: number, text: string) => ({ t: "add", n, text });
const del = (o: number, text: string) => ({ t: "del", o, text });

describe("suggestLines", () => {
  test("a range suggests the lines as they stand after the change", () => {
    expect(suggestLines([ctx(4, "const a = 1;"), add(5, "const b = 2;")]))
      .toEqual(["const a = 1;", "const b = 2;"]);
  });

  test("removed lines are left out while the range still has a new side", () => {
    expect(suggestLines([del(9, "const old = 1;"), add(9, "const next = 1;")]))
      .toEqual(["const next = 1;"]);
  });

  test("a range of nothing but deletions falls back to the removed text", () => {
    expect(suggestLines([del(9, "const old = 1;"), del(10, "const gone = 2;")]))
      .toEqual(["const old = 1;", "const gone = 2;"]);
  });

  test("hunk separators carry no code", () => {
    expect(suggestLines([{ t: "hunk", text: "@@ -1,2 +1,3 @@" }, ctx(1, "x")])).toEqual(["x"]);
    expect(suggestLines([])).toEqual([]);
  });

  test("one line is one line, whatever part of it the note was taken from", () => {
    expect(suggestLines([ctx(7, "  return value;")])).toEqual(["  return value;"]);
  });
});

describe("suggestionBlock", () => {
  test("fences the lines the way review sites read a suggestion", () => {
    expect(suggestionBlock(["a", "b"])).toBe("```suggestion\na\nb\n```");
  });

  test("the fence outgrows the backticks in the code it carries", () => {
    expect(suggestionBlock(["const md = ```x```;"])).toBe("````suggestion\nconst md = ```x```;\n````");
  });

  test("an empty range still opens a block to write in", () => {
    expect(suggestionBlock([])).toBe("```suggestion\n\n```");
  });
});

describe("capturedLines", () => {
  test("reads the new side of a capture, as the suggestion was seeded from", () => {
    expect(capturedLines(" const a = 1;\n-const old = 2;\n+const b = 2;"))
      .toEqual(["const a = 1;", "const b = 2;"]);
  });

  test("a capture of nothing but removals is what the suggestion replaces", () => {
    expect(capturedLines("-const old = 1;\n-const gone = 2;"))
      .toEqual(["const old = 1;", "const gone = 2;"]);
  });

  test("a note that captured no code has nothing to read a suggestion against", () => {
    expect(capturedLines("")).toEqual([]);
    expect(capturedLines(undefined as any)).toEqual([]);
  });

  test("an empty line keeps its place, marker and all", () => {
    expect(capturedLines(" a\n \n b")).toEqual(["a", "", "b"]);
  });
});

describe("lineDiff", () => {
  test("shows what a replacement takes away as well as what it puts there", () => {
    expect(lineDiff(["const a = 1;"], ["const a = 2;"])).toEqual([
      { t: "del", v: "const a = 1;" },
      { t: "add", v: "const a = 2;" },
    ]);
  });

  test("lines the suggestion keeps read as context, top and bottom", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "B", "c"])).toEqual([
      { t: "ctx", v: "a" },
      { t: "del", v: "b" },
      { t: "add", v: "B" },
      { t: "ctx", v: "c" },
    ]);
  });

  test("a line only added, and a line only removed", () => {
    expect(lineDiff(["a", "c"], ["a", "b", "c"])).toEqual([
      { t: "ctx", v: "a" },
      { t: "add", v: "b" },
      { t: "ctx", v: "c" },
    ]);
    expect(lineDiff(["a", "b", "c"], ["a", "c"])).toEqual([
      { t: "ctx", v: "a" },
      { t: "del", v: "b" },
      { t: "ctx", v: "c" },
    ]);
  });

  test("a line kept in the middle is found rather than rewritten around", () => {
    expect(lineDiff(["a", "keep", "b"], ["x", "keep", "y"])).toEqual([
      { t: "del", v: "a" },
      { t: "add", v: "x" },
      { t: "ctx", v: "keep" },
      { t: "del", v: "b" },
      { t: "add", v: "y" },
    ]);
  });

  test("a suggestion that changes nothing says so, and one with no base is all new", () => {
    expect(lineDiff(["a", "b"], ["a", "b"])).toEqual([
      { t: "ctx", v: "a" },
      { t: "ctx", v: "b" },
    ]);
    expect(lineDiff([], ["a"])).toEqual([{ t: "add", v: "a" }]);
    expect(lineDiff(["a"], [])).toEqual([{ t: "del", v: "a" }]);
  });

  test("a block past the pairing limit is shown removed whole and added whole", () => {
    const base = Array.from({ length: 80 }, (_, k) => "line " + k);
    const next = base.map((line) => line + ";");
    const out = lineDiff(base, next);
    expect(out.length).toBe(160);
    expect(out.slice(0, 80).every((line) => line.t === "del")).toBe(true);
    expect(out.slice(80).every((line) => line.t === "add")).toBe(true);
  });
});

describe("insertBlock", () => {
  const block = suggestionBlock(["a"]);

  test("an empty note becomes the block, with the caret on its code", () => {
    const out = insertBlock("", 0, block);
    expect(out.value).toBe(block);
    expect(out.value.slice(out.from, out.to)).toBe("a");
  });

  test("a block goes one blank line clear of the prose before it", () => {
    const out = insertBlock("rename this", 11, block);
    expect(out.value).toBe("rename this\n\n```suggestion\na\n```");
    expect(out.value.slice(out.from, out.to)).toBe("a");
  });

  test("text after the caret is kept, one blank line below the block", () => {
    const out = insertBlock("before\nafter", 6, block);
    expect(out.value).toBe("before\n\n```suggestion\na\n```\n\nafter");
    expect(out.value.slice(out.from, out.to)).toBe("a");
  });

  test("whitespace around the caret is not doubled", () => {
    expect(insertBlock("before\n\n", 8, block).value).toBe("before\n\n```suggestion\na\n```");
  });

  test("a caret outside the text lands at the nearest end", () => {
    expect(insertBlock("before", 99, block).value).toBe("before\n\n```suggestion\na\n```");
    expect(insertBlock("after", -3, block).value).toBe("```suggestion\na\n```\n\nafter");
  });
});

describe("bodyParts", () => {
  test("a note without a suggestion is one piece of prose", () => {
    expect(bodyParts("just a remark")).toEqual([{ t: "text", v: "just a remark" }]);
    expect(bodyParts("")).toEqual([]);
  });

  test("prose and suggestion are split, without the blank lines between them", () => {
    expect(bodyParts("rename this\n\n```suggestion\nconst b = 2;\n```\n\nand check callers")).toEqual([
      { t: "text", v: "rename this" },
      { t: "sug", v: "const b = 2;" },
      { t: "text", v: "and check callers" },
    ]);
  });

  test("a block reads as one however many lines and backticks it holds", () => {
    expect(bodyParts("````suggestion\na\n```x```\n````")).toEqual([{ t: "sug", v: "a\n```x```" }]);
  });

  test("several suggestions in one note each stand on their own", () => {
    expect(bodyParts("```suggestion\na\n```\n```suggestion\nb\n```")).toEqual([
      { t: "sug", v: "a" },
      { t: "sug", v: "b" },
    ]);
  });

  test("a fence that was never closed is prose, so a note being typed reads as it looks", () => {
    const half = "rename this\n\n```suggestion\nconst b = 2;";
    expect(bodyParts(half)).toEqual([{ t: "text", v: half }]);
  });

  test("a fenced block that is not a suggestion is left as prose", () => {
    const other = "```ts\nconst a = 1;\n```";
    expect(bodyParts(other)).toEqual([{ t: "text", v: other }]);
  });
});
