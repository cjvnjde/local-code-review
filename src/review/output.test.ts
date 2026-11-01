import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { excludeRelativeOutput, deleteReviews, listReviews } from "./output.ts";
import { runGit } from "../git/commands.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const workspace = async (...names: string[]) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-output-"));
  roots.push(dir);
  for (const name of names)
    await writeFile(path.join(dir, name), "# Review notes\n", "utf8");
  return dir;
};

describe("excludeRelativeOutput", () => {
  test("adds one normalized output-directory entry to Git's local excludes", async () => {
    const root = await workspace();
    await runGit(["init", "-q", "-b", "main"], root);
    const excludeFile = path.join(root, ".git", "info", "exclude");
    await writeFile(excludeFile, "existing-entry\n", "utf8");

    await excludeRelativeOutput(root, "./review-notes/");
    await excludeRelativeOutput(root, "review-notes");

    expect(await readFile(excludeFile, "utf8")).toBe(
      "existing-entry\n/review-notes/\n",
    );
  });

  test("keeps an existing final line before appending the entry", async () => {
    const root = await workspace();
    await runGit(["init", "-q", "-b", "main"], root);
    const excludeFile = path.join(root, ".git", "info", "exclude");
    await writeFile(excludeFile, "existing-entry", "utf8");

    await excludeRelativeOutput(root, ".review");

    expect(await readFile(excludeFile, "utf8")).toBe(
      "existing-entry\n/.review/\n",
    );
  });

  test("does not put an absolute output directory into repository excludes", async () => {
    const root = await workspace();
    await runGit(["init", "-q", "-b", "main"], root);
    const excludeFile = path.join(root, ".git", "info", "exclude");
    const before = await readFile(excludeFile, "utf8");

    await excludeRelativeOutput(root, path.join(tmpdir(), "lcr-reviews"));

    expect(await readFile(excludeFile, "utf8")).toBe(before);
  });

  test("is best effort outside a Git repository", async () => {
    const root = await workspace();

    expect(await excludeRelativeOutput(root, ".review")).toBeUndefined();
  });
});

describe("listReviews", () => {
  test("names generated review files oldest first and leaves everything else out", async () => {
    const dir = await workspace(
      "review-2026-02-01T00-00-00.md",
      "review-2026-01-01T00-00-00.md",
      "notes.md",
      "review-notes.txt",
    );
    expect(await listReviews(dir, ".")).toEqual([
      "review-2026-01-01T00-00-00.md",
      "review-2026-02-01T00-00-00.md",
    ]);
  });

  test("answers nothing for a directory that was never written to", async () => {
    expect(await listReviews(tmpdir(), "lcr-missing-dir")).toEqual([]);
  });
});

describe("deleteReviews", () => {
  test("removes every review file and keeps the rest of the directory", async () => {
    const dir = await workspace("review-1.md", "review-2.md", "notes.md");
    expect(await deleteReviews(dir, ".")).toEqual([
      "review-1.md",
      "review-2.md",
    ]);
    expect(await readdir(dir)).toEqual(["notes.md"]);
  });

  test("spares the file it is told to keep", async () => {
    const dir = await workspace("review-1.md", "review-2.md");
    expect(await deleteReviews(dir, ".", "review-2.md")).toEqual([
      "review-1.md",
    ]);
    expect(await listReviews(dir, ".")).toEqual(["review-2.md"]);
  });

  test("deleting an empty output directory is not an error", async () => {
    expect(await deleteReviews(tmpdir(), "lcr-missing-dir")).toEqual([]);
  });
});

describe("review deletion ownership", () => {
  test("nonempty review-named directories are retained and do not prevent later files being deleted", async () => {
    const dir = await workspace("review-1.md", "review-3.md", "notes.md");
    await mkdir(path.join(dir, "review-2.md"));
    await writeFile(path.join(dir, "review-2.md", "owned-by-user.txt"), "keep");
    expect(await deleteReviews(dir, ".")).toEqual([
      "review-1.md",
      "review-3.md",
    ]);
    expect(
      await readFile(
        path.join(dir, "review-2.md", "owned-by-user.txt"),
        "utf8",
      ),
    ).toBe("keep");
    expect(await readFile(path.join(dir, "notes.md"), "utf8")).toBe(
      "# Review notes\n",
    );
  });

  test("deleting a generated-name symlink removes only the link, never its target", async () => {
    const dir = await workspace("private.md");
    await symlink(path.join(dir, "private.md"), path.join(dir, "review-1.md"));
    expect(await deleteReviews(dir, ".")).toEqual(["review-1.md"]);
    expect(await readdir(dir)).toEqual(["private.md"]);
    expect(await readFile(path.join(dir, "private.md"), "utf8")).toBe(
      "# Review notes\n",
    );
  });

  test("retention is an exact filename match and lookalike artifacts remain outside deletion ownership", async () => {
    const dir = await workspace(
      "review-1.md",
      "review-10.md",
      "review-1.md.bak",
      "review-uppercase.MD",
      "my-review-1.md",
      "review-1.md.png",
      "review.md",
    );
    expect(await deleteReviews(dir, ".", "review-1.md")).toEqual([
      "review-10.md",
    ]);
    expect((await readdir(dir)).sort()).toEqual([
      "my-review-1.md",
      "review-1.md",
      "review-1.md.bak",
      "review-1.md.png",
      "review-uppercase.MD",
      "review.md",
    ]);
  });

  test("an absolute output directory is listed and pruned without touching the repository", async () => {
    const repo = await workspace("review-repository.md");
    const output = await workspace("review-1.md", "review-2.md", "notes.md");
    expect(await listReviews(repo, output)).toEqual([
      "review-1.md",
      "review-2.md",
    ]);
    expect(await deleteReviews(repo, output, "review-2.md")).toEqual([
      "review-1.md",
    ]);
    expect(await readdir(repo)).toEqual(["review-repository.md"]);
    expect((await readdir(output)).sort()).toEqual(["notes.md", "review-2.md"]);
  });
});

test("excluding nested output preserves internal separators and dot-ending directory names", async () => {
  const root = await workspace();
  await runGit(["init", "-q", "-b", "main"], root);
  const excludeFile = path.join(root, ".git", "info", "exclude");
  await writeFile(excludeFile, "", "utf8");
  await excludeRelativeOutput(root, "team./reviews/");
  expect(await readFile(excludeFile, "utf8")).toBe("/team./reviews/\n");
  expect(
    await runGit(["check-ignore", "team./reviews/review-1.md"], root),
  ).toBe("team./reviews/review-1.md\n");
  await expect(
    runGit(["check-ignore", "teamreviews/review-1.md"], root),
  ).rejects.toThrow();
});

test("a missing exclude file is recreated without losing the requested output exclusion", async () => {
  const root = await workspace();
  await runGit(["init", "-q", "-b", "main"], root);
  const excludeFile = path.join(root, ".git", "info", "exclude");
  await rm(excludeFile, { force: true });
  await excludeRelativeOutput(root, "notes/reviews");
  expect(await readFile(excludeFile, "utf8")).toBe("/notes/reviews/\n");
  expect(
    await runGit(["check-ignore", "notes/reviews/review-1.md"], root),
  ).toBe("notes/reviews/review-1.md\n");
});
