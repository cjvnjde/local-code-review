import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readBlob } from "./blob.ts";
import { runGit } from "./commands.ts";
import {
  diffBase,
  diffSides,
  getDiff,
  getFileContext,
  INDEX,
  validateDiff,
  WORKTREE,
} from "./diff.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-git-boundary-"));
  roots.push(root);
  await runGit(["init", "-q", "-b", "main"], root);
  await runGit(["config", "user.name", "Reviewer"], root);
  await runGit(["config", "user.email", "reviewer@example.test"], root);
  await writeFile(path.join(root, "app.txt"), "one\ntwo\nthree\nfour\nfive\n");
  await runGit(["add", "-A"], root);
  await commit(root, "initial");
  return root;
}

const commit = (root: string, message: string) =>
  runGit(["-c", "commit.gpgsign=false", "commit", "-qam", message], root);
const source = (repoRoot: string, diffArgs: string[] = []) => ({
  repoRoot,
  diffArgs,
  context: 0,
});
const decode = (value: Uint8Array | null) =>
  value === null ? null : new TextDecoder().decode(value);

describe("Git diff isolation and revision boundaries", () => {
  test("validation checks arguments without turning untracked files into intent-to-add entries", async () => {
    const root = await repository();
    await writeFile(path.join(root, "untracked.txt"), "new\n");
    const before = await runGit(["status", "--porcelain=v1", "-z"], root);
    await validateDiff(source(root));
    expect(await runGit(["status", "--porcelain=v1", "-z"], root)).toBe(before);
    await expect(
      validateDiff(source(root, ["missing-revision", "--"])),
    ).rejects.toThrow();
    expect(await runGit(["status", "--porcelain=v1", "-z"], root)).toBe(before);
    expect(await runGit(["ls-files", "--", "untracked.txt"], root)).toBe("");
  });

  test("cached review uses staged bytes and leaves untracked and later edits alone", async () => {
    const root = await repository();
    await writeFile(path.join(root, "app.txt"), "staged\n");
    await runGit(["add", "--", "app.txt"], root);
    await writeFile(path.join(root, "app.txt"), "working\n");
    await writeFile(path.join(root, "untracked.txt"), "untracked\n");
    const before = await runGit(["status", "--porcelain=v1", "-z"], root);
    const files = await getDiff(
      source(root, ["--cached", "main", "--", "app.txt"]),
    );
    expect(files.map((file) => file.path)).toEqual(["app.txt"]);
    expect(files[0]!.rows.filter((row) => row.t === "add")).toEqual([
      { t: "add", n: 1, text: "staged" },
    ]);
    const sides = await diffSides(
      source(root, ["--cached", "main", "--", "app.txt"]),
    );
    expect(sides).toEqual({ old: "main", new: INDEX });
    expect(decode(await readBlob(root, sides.new, "app.txt"))).toBe("staged\n");
    expect(await runGit(["status", "--porcelain=v1", "-z"], root)).toBe(before);
  });

  test("symmetric revisions use the true common ancestor after both branches diverge", async () => {
    const root = await repository();
    const ancestor = (await runGit(["rev-parse", "HEAD"], root)).trim();
    await runGit(["checkout", "-qb", "feature"], root);
    await writeFile(path.join(root, "app.txt"), "feature\n");
    await commit(root, "feature");
    await runGit(["checkout", "-q", "main"], root);
    await writeFile(path.join(root, "app.txt"), "main moved\n");
    await commit(root, "main moved");
    const selected = source(root, ["main...feature", "--", "app.txt"]);
    expect(await diffSides(selected)).toEqual({
      old: ancestor,
      new: "feature",
    });
    expect(await diffBase(selected)).toBe(ancestor.slice(0, 12));
    const files = await getDiff(selected);
    expect(
      files[0]!.rows.filter((row) => row.t === "del").map((row) => row.text),
    ).toEqual(["one", "two", "three", "four", "five"]);
    expect(files[0]!.rows.some((row) => row.text === "main moved")).toBe(false);
  });

  test("omitted range endpoints resolve to HEAD for both ordinary and symmetric comparisons", async () => {
    const root = await repository();
    const ancestor = (await runGit(["rev-parse", "HEAD"], root)).trim();
    await writeFile(path.join(root, "app.txt"), "second\n");
    await commit(root, "second");
    for (const args of [["main.."], ["..main"]])
      expect(await diffSides(source(root, args))).toEqual({
        old: args[0]!.startsWith("..") ? "HEAD" : "main",
        new: args[0]!.startsWith("..") ? "main" : "HEAD",
      });
    expect(await diffSides(source(root, ["HEAD~1..."]))).toEqual({
      old: ancestor,
      new: "HEAD",
    });
    expect(await diffSides(source(root, ["...HEAD~1"]))).toEqual({
      old: ancestor,
      new: "HEAD~1",
    });
  });

  test("pathspecs after -- never masquerade as revisions even when a branch has that name", async () => {
    const root = await repository();
    await writeFile(path.join(root, "main"), "file named like branch\n");
    const selected = source(root, ["--", "main"]);
    expect(await diffSides(selected)).toEqual({ old: INDEX, new: WORKTREE });
    expect((await getDiff(selected)).map((file) => file.path)).toEqual([
      "main",
    ]);
  });

  test("an explicitly pinned worktree base survives later commits", async () => {
    const root = await repository();
    const base = (await runGit(["rev-parse", "HEAD"], root)).trim();
    await writeFile(path.join(root, "app.txt"), "committed later\n");
    await commit(root, "later");
    const selected = { ...source(root), worktreeBase: base };
    expect(await diffSides(selected)).toEqual({ old: base, new: WORKTREE });
    expect(await getDiff(source(root))).toEqual([]);
    const files = await getDiff(selected);
    expect(files[0]!.removed).toBe(5);
    expect(files[0]!.rows.filter((row) => row.t === "add")).toEqual([
      { t: "add", n: 1, text: "committed later" },
    ]);
  });

  test("Git formatting and external diff configuration cannot replace the review diff", async () => {
    const root = await repository();
    const file = "naïve file.txt";
    await writeFile(path.join(root, file), "old\n");
    await runGit(["add", "--", file], root);
    await commit(root, "unicode file");
    await runGit(["config", "core.quotepath", "true"], root);
    await runGit(["config", "diff.noprefix", "true"], root);
    await runGit(["config", "diff.external", "false"], root);
    await writeFile(path.join(root, file), "new\n");
    const files = await getDiff(source(root));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: file, added: 1, removed: 1 });
    expect(files[0]!.rows.filter((row) => row.t === "add")).toEqual([
      { t: "add", n: 1, text: "new" },
    ]);
  });

  test("real Git paths with tabs, newlines, quotes and backslashes roundtrip unchanged", async () => {
    const root = await repository();
    const names = [
      "tab\tname.txt",
      "line\nname.txt",
      'quote"name.txt',
      "back\\slash.txt",
    ];
    for (const file of names)
      await writeFile(path.join(root, file), "before\n");
    await runGit(["add", "-A"], root);
    await commit(root, "unusual names");
    for (const file of names) await writeFile(path.join(root, file), "after\n");
    const files = await getDiff(source(root));
    expect(files.map((file) => file.path).sort()).toEqual([...names].sort());
    for (const file of files) {
      expect(file.rows.filter((row) => row.t === "add")).toEqual([
        { t: "add", n: 1, text: "after" },
      ]);
      expect(decode(await readBlob(root, "HEAD", file.path))).toBe("before\n");
    }
  });

  test("renamed files retain old blob identity and deleted files retain old-side rows", async () => {
    const root = await repository();
    await writeFile(path.join(root, "deleted.txt"), "gone\n");
    await runGit(["add", "-A"], root);
    await commit(root, "second file");
    await runGit(["mv", "app.txt", "renamed.txt"], root);
    await runGit(["rm", "-q", "deleted.txt"], root);
    const files = await getDiff(source(root));
    expect(files.find((file) => file.path === "deleted.txt")).toMatchObject({
      status: "deleted",
      added: 0,
      removed: 1,
    });
    const renamed = files.find((file) => file.path === "renamed.txt")!;
    expect(renamed).toMatchObject({
      status: "renamed",
      from: "app.txt",
      added: 0,
      removed: 0,
    });
    expect(decode(await readBlob(root, "HEAD", renamed.from!))).toBe(
      "one\ntwo\nthree\nfour\nfive\n",
    );
    expect(await readBlob(root, "HEAD", renamed.path)).toBeNull();
  });
});

describe("context and blob filesystem boundaries", () => {
  test("expands unchanged new-side lines with shifted old numbers after an insertion", async () => {
    const root = await repository();
    await writeFile(
      path.join(root, "app.txt"),
      "inserted\none\ntwo\nthree\nfour\nfive\n",
    );
    expect(
      await getFileContext(
        source(root, ["HEAD", "--", "app.txt"]),
        "app.txt",
        2,
        3,
      ),
    ).toEqual([
      { t: "ctx", o: 1, n: 2, text: "one" },
      { t: "ctx", o: 2, n: 3, text: "two" },
    ]);
  });

  test("expansion reads the chosen commit range rather than unrelated working-copy content", async () => {
    const root = await repository();
    await writeFile(
      path.join(root, "app.txt"),
      "one\ntwo\nchanged\nfour\nfive\n",
    );
    await commit(root, "range endpoint");
    await writeFile(path.join(root, "app.txt"), "unrelated working tree\n");
    expect(
      await getFileContext(source(root, ["HEAD~1..HEAD"]), "app.txt", 2, 4),
    ).toEqual([
      { t: "ctx", o: 2, n: 2, text: "two" },
      { t: "ctx", o: 4, n: 4, text: "four" },
    ]);
  });

  test("caps context expansions at 20000 inclusive rows without an off-by-one", async () => {
    const root = await repository();
    const lines = Array.from(
      { length: 20002 },
      (_, index) => `line ${index + 1}`,
    );
    await writeFile(path.join(root, "app.txt"), lines.join("\n") + "\n");
    await commit(root, "large file");
    await writeFile(
      path.join(root, "app.txt"),
      [...lines, "added"].join("\n") + "\n",
    );
    const rows = await getFileContext(source(root), "app.txt", 2, 50000);
    expect(rows).toHaveLength(20000);
    expect(rows[0]).toEqual({ t: "ctx", o: 2, n: 2, text: "line 2" });
    expect(rows.at(-1)).toEqual({
      t: "ctx",
      o: 20001,
      n: 20001,
      text: "line 20001",
    });
  });

  test("invalid numeric expansion inputs return no rows without needing a repository", async () => {
    for (const [start, end] of [
      [1.5, 2],
      [1, 2.5],
      [NaN, 2],
      [1, Infinity],
      [Infinity, Infinity],
    ])
      expect(
        await getFileContext(
          source("/not-a-repository"),
          "app.txt",
          start!,
          end!,
        ),
      ).toEqual([]);
  });

  test("empty blobs are present bytes, while deleted blobs and directories are absent", async () => {
    const root = await repository();
    await writeFile(path.join(root, "empty.png"), new Uint8Array());
    await runGit(["add", "--", "empty.png"], root);
    await commit(root, "empty media");
    for (const side of ["HEAD", INDEX, WORKTREE])
      expect(await readBlob(root, side, "empty.png")).toEqual(new Uint8Array());
    await rm(path.join(root, "empty.png"));
    expect(await readBlob(root, WORKTREE, "empty.png")).toBeNull();
    expect(await readBlob(root, WORKTREE, ".")).toBeNull();
    expect(await readBlob(root, WORKTREE, ".git")).toBeNull();
  });

  test("nested internal symlinks work but directory links to prefix-matching siblings cannot escape", async () => {
    const root = await repository();
    await mkdir(path.join(root, "assets"));
    const bytes = new Uint8Array([0, 255, 128, 42]);
    await writeFile(path.join(root, "assets", "picture.png"), bytes);
    await symlink("assets", path.join(root, "internal"));
    expect(await readBlob(root, WORKTREE, "internal/picture.png")).toEqual(
      bytes,
    );
    const outside = root + "-copy";
    roots.push(outside);
    await mkdir(outside);
    await writeFile(path.join(outside, "private.png"), "secret");
    await symlink(outside, path.join(root, "external"));
    expect(await readBlob(root, WORKTREE, "external/private.png")).toBeNull();
    expect(
      await readBlob(root, WORKTREE, path.join(outside, "private.png")),
    ).toBeNull();
  });
});
