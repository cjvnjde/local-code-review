import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentBranch, GitError, runGit, runGitBytes } from "./commands.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-commands-"));
  roots.push(root);
  await runGit(["init", "-q", "-b", "main", "--object-format=sha1"], root);
  await runGit(["config", "user.name", "Test Reviewer"], root);
  await runGit(["config", "user.email", "reviewer@example.test"], root);
  return root;
}

describe("Git subprocess contracts", () => {
  test("streams large Unicode stdin through a real blob without losing decoder boundaries", async () => {
    const root = await repository();
    const contents = "αβ🙂雪\n".repeat(20000) + "last line without newline";
    const hash = (
      await runGit(["hash-object", "-w", "--stdin"], root, contents)
    ).trim();
    expect(await runGit(["cat-file", "blob", hash], root)).toBe(contents);
  });

  test("distinguishes an empty supplied stdin from absent file contents", async () => {
    const root = await repository();
    const hash = (
      await runGit(["hash-object", "-w", "--stdin"], root, "")
    ).trim();
    expect(hash).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(await runGit(["cat-file", "blob", hash], root)).toBe("");
    expect(await runGitBytes(["cat-file", "blob", hash], root)).toEqual(
      new Uint8Array(),
    );
  });

  test("preserves arbitrary binary octets rather than decoding and reencoding them", async () => {
    const root = await repository();
    const bytes = Uint8Array.from({ length: 65537 }, (_, index) => index % 256);
    await writeFile(path.join(root, "binary.dat"), bytes);
    const hash = (
      await runGit(["hash-object", "-w", "--", "binary.dat"], root)
    ).trim();
    expect(await runGitBytes(["cat-file", "blob", hash], root)).toEqual(bytes);
  });

  test("text and byte failures retain the Git invocation, exit code and useful stderr", async () => {
    const root = await repository();
    const args = ["rev-parse", "--verify", "missing-review-revision"];
    for (const run of [runGit, runGitBytes]) {
      const error = await run(args, root).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GitError);
      const failure = error as GitError;
      expect(failure.args).toEqual(args);
      expect(failure.exitCode).toBe(128);
    }
  });

  test("retains the invocation and exit status even when Git fails without stderr", async () => {
    const root = await repository();
    const args = ["config", "--get", "lcr.nonexistent"];
    for (const run of [runGit, runGitBytes]) {
      const error = await run(args, root).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GitError);
      expect(error).toMatchObject({
        args,
        exitCode: 1,
      });
    }
  });

  test("keeps option-looking and shell-looking filenames literal after the Git separator", async () => {
    const root = await repository();
    const file = "--$(touch owned).txt";
    await writeFile(path.join(root, file), "literal filename\n");
    await runGit(["add", "--", file], root);
    expect(await runGit(["show", `:${file}`], root)).toBe("literal filename\n");
    expect(await Bun.file(path.join(root, "owned")).exists()).toBe(false);
  });

  test("reports branches but not detached HEAD or directories outside Git", async () => {
    const root = await repository();
    await runGit(
      [
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-qm",
        "initial",
      ],
      root,
    );
    expect(await currentBranch(root)).toBe("main");
    await runGit(["checkout", "-qb", "feature/review-boundaries"], root);
    expect(await currentBranch(root)).toBe("feature/review-boundaries");
    await runGit(["checkout", "--detach", "-q"], root);
    expect(await currentBranch(root)).toBe("");
    const outside = await mkdtemp(path.join(tmpdir(), "lcr-nonrepo-"));
    roots.push(outside);
    expect(await currentBranch(outside)).toBe("");
  });
});
