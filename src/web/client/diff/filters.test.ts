import { describe, expect, test } from "bun:test";
import { globRx, filterFiles } from "./filters.ts";

describe("globRx", () => {
  test("matches a bare pattern against the file name at any depth", () => {
    expect(globRx("*.test.*")!.test("src/web/client/tree.test.ts")).toBe(true);
    expect(globRx("*.test.*")!.test("src/tree.ts")).toBe(false);
    expect(globRx("*.lock")!.test("bun.lock")).toBe(true);
  });

  test("anchors a pattern that contains a slash", () => {
    expect(globRx("dist/**")!.test("dist/index.js")).toBe(true);
    expect(globRx("dist/**")!.test("packages/dist/index.js")).toBe(false);
    expect(globRx("src/**/*.snap")!.test("src/a/b/c.snap")).toBe(true);
    expect(globRx("src/**/*.snap")!.test("src/c.snap")).toBe(true);
  });

  test("treats a trailing slash as everything below a directory at any depth", () => {
    expect(globRx("dist/")!.test("packages/app/dist/main.js")).toBe(true);
    expect(globRx("dist/")!.test("dist/main.js")).toBe(true);
    expect(globRx("dist/")!.test("src/dist.ts")).toBe(false);
  });

  test("keeps single star inside one segment and ? at one character", () => {
    expect(globRx("src/*.ts")!.test("src/cli.ts")).toBe(true);
    expect(globRx("src/*.ts")!.test("src/web/cli.ts")).toBe(false);
    expect(globRx("v?.txt")!.test("v1.txt")).toBe(true);
    expect(globRx("v?.txt")!.test("v10.txt")).toBe(false);
  });

  test("escapes regex characters and skips blanks and comments", () => {
    expect(globRx("a+b.ts")!.test("a+b.ts")).toBe(true);
    expect(globRx("a+b.ts")!.test("axb.ts")).toBe(false);
    expect(globRx("  ")).toBe(null);
    expect(globRx("# a comment")).toBe(null);
  });
});

const settings = {
  hide: "*.spec.*",
  disabledHide: [],
  hideEnabled: true,
  hideDeleted: false,
};
const root = { path: "something.spec.ts", status: "added" };
const nested = { path: "src/something.spec.ts", status: "modified" };
const source = { path: "src/something.ts", status: "modified" };
const files = [root, nested, source];

test("a glob excludes matches from the tree and diff, including previously shown files", () => {
  const view = filterFiles(files, settings, { [nested.path]: false });
  expect(view.treeFiles).toEqual([source]);
  expect(view.visibleFiles).toEqual([source]);
  expect(view.hiddenPaths).toEqual(new Set([root.path, nested.path]));
  for (const disabled of [
    { hideEnabled: false },
    { disabledHide: ["*.spec.*"] },
  ]) {
    expect(
      filterFiles(files, { ...settings, ...disabled }, {}).visibleFiles,
    ).toEqual(files);
  }
});

test("revealing a filtered file applies only to that file and its matching rule", () => {
  const overrides = { [nested.path]: ["*.spec.*"] };
  const view = filterFiles(files, settings, overrides);
  expect(view.treeFiles).toEqual([nested, source]);
  expect(view.visibleFiles).toEqual([nested, source]);
  expect(
    filterFiles(files, { ...settings, hide: "src/**" }, overrides).visibleFiles,
  ).toEqual([root]);
  expect(
    filterFiles(files, { ...settings, hide: "*.spec.*,src/**" }, overrides)
      .visibleFiles,
  ).toEqual([]);
});

test("manual and deleted-file eye controls remain available in the tree", () => {
  const deleted = { ...source, status: "deleted" };
  const prefs = { ...settings, hideDeleted: true, hideEnabled: false };
  const hidden = filterFiles([deleted, nested], prefs, { [nested.path]: true });
  expect(hidden.treeFiles).toEqual([deleted, nested]);
  expect(hidden.visibleFiles).toEqual([]);
  expect(
    filterFiles([deleted], prefs, { [deleted.path]: false }).visibleFiles,
  ).toEqual([deleted]);
});
