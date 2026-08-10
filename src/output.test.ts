import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { deleteReviews, listReviews } from "./output.ts";

const workspace = async (...names: string[]) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-output-"));
  for (const name of names) await writeFile(path.join(dir, name), "# Review notes\n", "utf8");
  return dir;
};

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
