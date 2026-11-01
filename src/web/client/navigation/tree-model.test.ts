import { describe, expect, test } from "bun:test";
import {
  buildTree,
  dirTree,
  expandedToFile,
  filesUnder,
  inTreeOrder,
  shownChildren,
  treeOrder,
} from "./tree-model.ts";
import { state } from "../app/state.ts";

const files = (...paths: string[]) => paths.map((path) => ({ path }));

describe("treeOrder", () => {
  test("a folder's own files come after its subfolders, as the tree draws them", () => {
    // git lists these the other way round: it sorts the whole path, so "src/w…" precedes "src/x…".
    expect(
      treeOrder(
        files("src/index.ts", "src/web/client/tree.ts", "src/watch.ts"),
      ),
    ).toEqual(["src/web/client/tree.ts", "src/index.ts", "src/watch.ts"]);
  });

  test("files and folders are each in name order", () => {
    expect(treeOrder(files("b/one.ts", "a/two.ts", "z.ts", "c.ts"))).toEqual([
      "a/two.ts",
      "b/one.ts",
      "c.ts",
      "z.ts",
    ]);
  });

  test("every file is listed exactly once, whatever the diff's order was", () => {
    const paths = ["a/b/c.ts", "a/b.ts", "a.ts", "README.md", "a/b/d/e.ts"];
    expect([...treeOrder(files(...paths))].sort()).toEqual([...paths].sort());
  });
});

describe("expandedToFile", () => {
  test("opens only folders containing the current file", () => {
    const collapsed = new Set([
      "src",
      "src/web/client",
      "src/web/server",
      "docs",
    ]);

    expect([...expandedToFile(collapsed, "src/web/client/tree.ts")]).toEqual([
      "src/web/server",
      "docs",
    ]);
    expect([...collapsed]).toEqual([
      "src",
      "src/web/client",
      "src/web/server",
      "docs",
    ]);
  });
});

describe("inTreeOrder", () => {
  test("the files themselves come back in that order, with what they carry", () => {
    const given = [
      { path: "src/index.ts", added: 1 },
      { path: "src/web/shell.html", added: 2 },
    ];
    expect(inTreeOrder(given).map((f) => f.path)).toEqual([
      "src/web/shell.html",
      "src/index.ts",
    ]);
    expect(inTreeOrder(given)[0]!.added).toBe(2);
  });

  test("the diff's own list is left alone: it is read again on the next load", () => {
    const given = files("b.ts", "a/c.ts");
    inTreeOrder(given);
    expect(given.map((f) => f.path)).toEqual(["b.ts", "a/c.ts"]);
  });
});

describe("tree shape invariants", () => {
  test("single-folder chains squash without swallowing branches or the leaf filename", () => {
    const input = files(
      "src/web/client/a.ts",
      "src/web/client/z/b.ts",
      "src/web/client/z/c.ts",
      "README.md",
    );
    const tree = buildTree(input);
    const children = shownChildren(tree);
    expect(children.map((c) => [c.name, c.path, c.dir])).toEqual([
      ["src/web/client", "src/web/client", true],
      ["README.md", "README.md", false],
    ]);
    const nested = shownChildren(children[0]);
    expect(nested.map((c) => [c.name, c.dir])).toEqual([
      ["z", true],
      ["a.ts", false],
    ]);
    expect(shownChildren(nested[0]).map((c) => c.path)).toEqual([
      "src/web/client/z/b.ts",
      "src/web/client/z/c.ts",
    ]);
    expect(nested[1].file).toBe(input[0]);
    expect(new Set(filesUnder(tree))).toEqual(
      new Set(input.map((f) => f.path)),
    );
  });

  test("tree order is independent of insertion order and retains every original file object", () => {
    const input = files(
      "root.ts",
      "z/one.ts",
      "a/deep/two.ts",
      "a/direct.ts",
      ".config",
    );
    const expected = treeOrder(input);
    for (const given of [
      input,
      [...input].reverse(),
      [...input.slice(2), ...input.slice(0, 2)],
    ]) {
      const before = [...given];
      expect(treeOrder(given)).toEqual(expected);
      const sorted = inTreeOrder(given);
      expect(sorted.map((f) => f.path)).toEqual(expected);
      expect(sorted.every((f) => input.includes(f))).toBe(true);
      expect(given).toEqual(before);
      expect(inTreeOrder(sorted)).toEqual(sorted);
    }
  });

  test("expansion respects slash boundaries rather than textual prefixes and returns a new set", () => {
    const collapsed = new Set([
      "src",
      "src/a",
      "src/ab",
      "src/a.ts",
      "src/a/deep",
      "other",
    ]);
    const next = expandedToFile(collapsed, "src/a/deep/file.ts");
    expect([...next]).toEqual(["src/ab", "src/a.ts", "other"]);
    expect(next).not.toBe(collapsed);
    expect(collapsed.size).toBe(6);
    expect([...expandedToFile(collapsed, "root.ts")]).toEqual([...collapsed]);
  });

  test("filesUnder appends to a caller-owned accumulator and an empty tree has no phantom entries", () => {
    const accumulator = ["previous.ts"];
    expect(filesUnder(buildTree(files("a/b.ts", "c.ts")), accumulator)).toBe(
      accumulator,
    );
    expect(accumulator).toEqual(["previous.ts", "a/b.ts", "c.ts"]);
    expect(treeOrder([])).toEqual([]);
    expect(shownChildren(buildTree([]))).toEqual([]);
    expect(filesUnder(buildTree([]))).toEqual([]);
  });
});

test("a cached tree keeps its read until invalidation, then adopts the new file objects", () => {
  const saved = { tree: state.tree, files: state.files, byPath: state.byPath };
  try {
    const first = { path: "first.ts", rows: [] };
    state.files = [first];
    state.byPath = new Map([["first.ts", 0]]);
    state.tree = null;
    const original = dirTree();
    expect(shownChildren(original)[0].file).toBe(first);
    expect(shownChildren(original)[0].idx).toBe(0);
    const second = { path: "nested/second.ts", rows: [] };
    state.files = [second];
    state.byPath = new Map([["nested/second.ts", 0]]);
    expect(dirTree()).toBe(original);
    state.tree = null;
    const next = dirTree();
    expect(next).not.toBe(original);
    expect(filesUnder(next)).toEqual(["nested/second.ts"]);
    expect(shownChildren(shownChildren(next)[0])[0].file).toBe(second);
  } finally {
    Object.assign(state, saved);
  }
});
