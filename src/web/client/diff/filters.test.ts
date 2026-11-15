import { describe, expect, test } from "bun:test";
import { globRx, compileHide, fileHidden } from "./filters.ts";
const hides = (patterns: string, path: string) =>
  compileHide(patterns).some((pattern) => pattern.test(path));

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

test("manual visibility overrides and independent hide switches keep their meaning", () => {
  const file = { path: "src/a.test.ts", status: "deleted" };
  const settings = {
    hide: "*.test.*",
    disabledHide: [],
    hideEnabled: true,
    hideDeleted: false,
  };
  expect(fileHidden(file, settings, {})).toBe(true);
  expect(fileHidden(file, settings, { [file.path]: false })).toBe(false);
  expect(
    fileHidden(file, { ...settings, disabledHide: ["*.test.*"] }, {}),
  ).toBe(false);
  expect(fileHidden(file, { ...settings, hideEnabled: false }, {})).toBe(false);
  expect(
    fileHidden(
      file,
      { ...settings, hideEnabled: false, hideDeleted: true },
      {},
    ),
  ).toBe(true);
  expect(
    fileHidden(
      { ...file, status: "added" },
      { ...settings, hideEnabled: false },
      { [file.path]: true },
    ),
  ).toBe(true);
});
