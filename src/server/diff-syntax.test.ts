import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readBlob } from "../git/blob.ts";
import { runGit } from "../git/commands.ts";
import { diffSides, getDiff, getFileContext } from "../git/diff.ts";
import type { DiffFile } from "../shared/review-types.ts";
import { createDiffSyntax } from "./diff-syntax.ts";
import { MAX_SYNTAX_BYTES } from "./tree-sitter.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

// The process/HTML boundary has its own tests; this exercises real Git reads and row mapping.
function recorder() {
  const sources: { file: string; source: string }[] = [];
  return {
    sources,
    available: async () => true,
    highlight: async (file: string, source: string) => {
      sources.push({ file, source });
      return source
        .split("\n")
        .map((text) => [{ text, kind: "comment" as const }]);
    },
  };
}

test("reads full staged, committed, renamed, deleted, and untracked versions and expands with the same tokens", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-diff-syntax-"));
  roots.push(root);
  const git = (args: string[]) => runGit(args, root);
  await git(["init", "-q"]);
  const original = "/* start\none\ntwo\nthree\nfour\nfive\nend */\n";
  const staged = original.replace("three", "staged");
  const working = original.replace("three", "working");
  await writeFile(path.join(root, "old.js"), original);
  await writeFile(path.join(root, "context.js"), original);
  await writeFile(path.join(root, "deleted.js"), "deleted\n");
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "base",
  ]);
  await git(["mv", "old.js", "new.js"]);
  await writeFile(path.join(root, "new.js"), staged);
  await writeFile(path.join(root, "context.js"), staged);
  await git(["add", "new.js", "context.js"]);
  await writeFile(path.join(root, "new.js"), working);
  await writeFile(path.join(root, "context.js"), working);
  await rm(path.join(root, "deleted.js"));
  await writeFile(path.join(root, "untracked.js"), "untracked\n");

  const check = async (diffArgs: string[], expected: string) => {
    const source = { repoRoot: root, context: 0, diffArgs };
    const sides = await diffSides(source);
    const backend = recorder();
    const syntax = createDiffSyntax(
      (side, file) => readBlob(root, sides[side], file, MAX_SYNTAX_BYTES),
      backend,
    );
    const files = await syntax.files(await getDiff(source));
    const renamed = files.find((file) => file.path === "new.js")!;
    expect(renamed.from).toBe("old.js");
    expect(backend.sources).toContainEqual({
      file: "old.js",
      source: original,
    });
    expect(backend.sources).toContainEqual({
      file: "new.js",
      source: expected,
    });
    for (const file of files)
      for (const row of file.rows.filter((row) => row.t !== "hunk"))
        expect(row.syntax?.map((token) => token.text).join("")).toBe(row.text);
    const expanded = await syntax.context(
      "context.js",
      await getFileContext(source, "context.js", 1, 3),
    );
    expect(expanded).toHaveLength(3);
    expect(expanded[1]?.syntax).toEqual([{ text: "one", kind: "comment" }]);
    return files;
  };
  await check(["--staged"], staged);
  const files = await check([], working);
  expect(
    files
      .find((file) => file.path === "deleted.js")
      ?.rows.some((row) => row.syntax),
  ).toBe(true);
  expect(
    files
      .find((file) => file.path === "untracked.js")
      ?.rows.some((row) => row.syntax),
  ).toBe(true);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "staged rename",
  ]);
  await check(["HEAD~1..HEAD"], staged);
});

test("missing, changed, non-UTF8, and oversized content falls back without changing diff text or identity", async () => {
  const file: DiffFile = {
    path: "code.js",
    status: "modified",
    hash: "same",
    added: 2,
    removed: 1,
    rows: [
      { t: "hunk", text: "@@" },
      { t: "del", text: "old", o: 1 },
      { t: "add", text: "new", n: 1 },
      { t: "add", text: "same", n: 2 },
    ],
  };
  for (const bytes of [
    null,
    new TextEncoder().encode("changed\nsame"),
    new Uint8Array([0xff]),
    new Uint8Array(MAX_SYNTAX_BYTES + 1),
  ]) {
    const backend = recorder();
    const syntax = createDiffSyntax(
      async (side) =>
        side === "old" ? new TextEncoder().encode("old") : bytes,
      backend,
    );
    const highlighted = (await syntax.files([file]))[0]!;
    expect(highlighted.rows[1]?.syntax).toEqual([
      { text: "old", kind: "comment" },
    ]);
    expect(highlighted.rows.slice(2)).toEqual(file.rows.slice(2));
    expect(highlighted.hash).toBe(file.hash);
    expect(file.rows[1]?.syntax).toBeUndefined();
  }
});

test("disabled backends, binary files, and empty expansions never read source blobs", async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return null;
  };
  const binary: DiffFile = {
    path: "image.png",
    binary: true,
    status: "modified",
    rows: [],
    added: 0,
    removed: 0,
    hash: "x",
  };
  const backend = recorder();
  await createDiffSyntax(read, backend).files([binary]);
  await createDiffSyntax(read, backend).context("outside", []);
  await createDiffSyntax(read, {
    ...backend,
    available: async () => false,
  }).files([
    { ...binary, binary: false, rows: [{ t: "add", n: 1, text: "text" }] },
  ]);
  expect(reads).toBe(0);
});
