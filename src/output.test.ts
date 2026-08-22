import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { excludeRelativeOutput, deleteReviews, listReviews } from "./output.ts";
import { runGit } from "./git.ts";

const workspace = async (...names: string[]) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-output-"));
  for (const name of names) await writeFile(path.join(dir, name), "# Review notes\n", "utf8");
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
    expect(await deleteReviews(dir, ".")).toEqual(["review-1.md", "review-2.md"]);
    expect(await readdir(dir)).toEqual(["notes.md"]);
  });

  test("spares the file it is told to keep", async () => {
    const dir = await workspace("review-1.md", "review-2.md");
    expect(await deleteReviews(dir, ".", "review-2.md")).toEqual(["review-1.md"]);
    expect(await listReviews(dir, ".")).toEqual(["review-2.md"]);
  });

  test("deleting an empty output directory is not an error", async () => {
    expect(await deleteReviews(tmpdir(), "lcr-missing-dir")).toEqual([]);
  });
});
