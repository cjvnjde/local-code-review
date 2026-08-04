import { afterEach, describe, expect, test } from "bun:test";
import {
  compileHide,
  filteredCount,
  filteredOut,
  globRx,
  isDeleted,
  isHidden,
  matchesHide,
} from "./filters.ts";
import { state } from "./state.ts";

const hides = (patterns: string, path: string) => {
  state.hideRx = compileHide(patterns);
  return matchesHide(path);
};

const loadFiles = (files: { path: string; status: string }[]) => {
  state.files = files;
  state.byPath = new Map(files.map((f, i) => [f.path, i]));
  state.hidden = new Set<string>();
  state.shown = new Set<string>();
  state.hideRx = [];
};

afterEach(() => {
  state.cfg.hideDeleted = false;
  state.files = [];
  state.byPath = new Map();
  state.hidden = new Set<string>();
  state.shown = new Set<string>();
  state.hideRx = [];
});

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

describe("hide patterns", () => {
  test("splits patterns on newlines and commas", () => {
    expect(hides("*.test.*\ndist/", "dist/app.js")).toBe(true);
    expect(hides("*.test.*, *.snap", "src/a.snap")).toBe(true);
    expect(hides("", "src/a.snap")).toBe(false);
  });

  test("a revealed file overrides its pattern, a manual hide still wins", () => {
    state.hideRx = compileHide("*.test.*");
    state.hidden = new Set<string>();
    state.shown = new Set<string>(["src/a.test.ts"]);
    expect(filteredOut("src/a.test.ts")).toBe(false);
    expect(isHidden("src/a.test.ts")).toBe(false);
    expect(isHidden("src/b.test.ts")).toBe(true);
    state.hidden = new Set<string>(["src/a.test.ts"]);
    expect(isHidden("src/a.test.ts")).toBe(true);
  });
});

describe("hide deleted files", () => {
  test("only hides deleted files, and only while the setting is on", () => {
    loadFiles([
      { path: "src/gone.ts", status: "deleted" },
      { path: "src/kept.ts", status: "modified" },
    ]);
    expect(isDeleted("src/gone.ts")).toBe(true);
    expect(isDeleted("src/kept.ts")).toBe(false);
    expect(isDeleted("src/unknown.ts")).toBe(false);
    expect(isHidden("src/gone.ts")).toBe(false);
    state.cfg.hideDeleted = true;
    expect(isHidden("src/gone.ts")).toBe(true);
    expect(isHidden("src/kept.ts")).toBe(false);
    expect(filteredCount()).toBe(1);
  });

  test("revealing a deleted file by hand keeps it visible", () => {
    loadFiles([{ path: "src/gone.ts", status: "deleted" }]);
    state.cfg.hideDeleted = true;
    state.shown = new Set<string>(["src/gone.ts"]);
    expect(filteredOut("src/gone.ts")).toBe(false);
    expect(isHidden("src/gone.ts")).toBe(false);
    expect(filteredCount()).toBe(0);
  });
});
