import { describe, expect, test } from "bun:test";
import { expandedToFile, inTreeOrder, treeOrder } from "./tree-model.ts";

const files = (...paths: string[]) => paths.map((path) => ({ path }));

describe("treeOrder", () => {
  test("a folder's own files come after its subfolders, as the tree draws them", () => {
    // git lists these the other way round: it sorts the whole path, so "src/w…" precedes "src/x…".
    expect(treeOrder(files("src/index.ts", "src/web/client/tree.ts", "src/watch.ts")))
      .toEqual(["src/web/client/tree.ts", "src/index.ts", "src/watch.ts"]);
  });

  test("files and folders are each in name order", () => {
    expect(treeOrder(files("b/one.ts", "a/two.ts", "z.ts", "c.ts")))
      .toEqual(["a/two.ts", "b/one.ts", "c.ts", "z.ts"]);
  });

  test("every file is listed exactly once, whatever the diff's order was", () => {
    const paths = ["a/b/c.ts", "a/b.ts", "a.ts", "README.md", "a/b/d/e.ts"];
    expect([...treeOrder(files(...paths))].sort()).toEqual([...paths].sort());
  });
});

describe("expandedToFile", () => {
  test("opens only folders containing the current file", () => {
    const collapsed = new Set(["src", "src/web/client", "src/web/server", "docs"]);

    expect([...expandedToFile(collapsed, "src/web/client/tree.ts")])
      .toEqual(["src/web/server", "docs"]);
    expect([...collapsed]).toEqual(["src", "src/web/client", "src/web/server", "docs"]);
  });
});

describe("inTreeOrder", () => {
  test("the files themselves come back in that order, with what they carry", () => {
    const given = [
      { path: "src/index.ts", added: 1 },
      { path: "src/web/shell.html", added: 2 },
    ];
    expect(inTreeOrder(given).map((f) => f.path)).toEqual(["src/web/shell.html", "src/index.ts"]);
    expect(inTreeOrder(given)[0]!.added).toBe(2);
  });

  test("the diff's own list is left alone: it is read again on the next load", () => {
    const given = files("b.ts", "a/c.ts");
    inTreeOrder(given);
    expect(given.map((f) => f.path)).toEqual(["b.ts", "a/c.ts"]);
  });
});
