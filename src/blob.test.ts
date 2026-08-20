import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { imageType, mediaType, readBlob } from "./blob.ts";
import { INDEX, WORKTREE, diffSides } from "./diff.ts";
import { runGit } from "./git.ts";

/** A repository with one commit, so the sides of a diff have something to point at. */
async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-blob-"));
  await runGit(["init", "-q", "-b", "main"], root);
  await runGit(["config", "user.email", "lcr@example.com"], root);
  await runGit(["config", "user.name", "lcr"], root);
  await writeFile(path.join(root, "logo.png"), "first", "utf8");
  await runGit(["add", "-A"], root);
  await runGit(["commit", "-qm", "first"], root);
  return root;
}
const source = (root: string, diffArgs: string[] = []) => ({ repoRoot: root, context: 3, diffArgs });
const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

describe("imageType", () => {
  test("names the type of every extension the page can draw, whatever the case", () => {
    expect(imageType("a/logo.png")).toBe("image/png");
    expect(imageType("Photo.JPEG")).toBe("image/jpeg");
    expect(imageType("icon.svg")).toBe("image/svg+xml");
  });

  test("answers nothing for a binary it cannot draw, or a name with no extension", () => {
    expect(imageType("build/app.wasm")).toBe("");
    expect(imageType("Makefile")).toBe("");
    expect(imageType("png")).toBe("");
  });
});

describe("mediaType", () => {
  test("serves browser audio formats with their proper MIME type", () => {
    expect(mediaType("music/theme.mp3")).toBe("audio/mpeg");
    expect(mediaType("music/theme.WAV")).toBe("audio/wav");
    expect(mediaType("music/theme.ogg")).toBe("audio/ogg");
    expect(mediaType("music/theme.opus")).toBe("audio/ogg");
    expect(mediaType("music/theme.flac")).toBe("audio/flac");
    expect(mediaType("music/theme.m4a")).toBe("audio/mp4");
    expect(mediaType("music/theme.aac")).toBe("audio/aac");
    expect(mediaType("music/theme.aiff")).toBe("audio/aiff");
    expect(mediaType("music/theme.weba")).toBe("audio/webm");
  });

  test("continues serving images but rejects unsupported binary files", () => {
    expect(mediaType("assets/logo.png")).toBe("image/png");
    expect(mediaType("build/app.wasm")).toBe("");
  });
});

describe("diffSides", () => {
  test("an argument-less run is HEAD against the working tree", async () => {
    const root = await repo();
    expect(await diffSides(source(root))).toEqual({ old: "HEAD", new: WORKTREE });
  });

  test("a staged run reads its new side out of the index", async () => {
    const root = await repo();
    expect(await diffSides(source(root, ["--cached"]))).toEqual({ old: "HEAD", new: INDEX });
  });

  test("a range takes its own ends", async () => {
    const root = await repo();
    expect(await diffSides(source(root, ["main..HEAD"]))).toEqual({ old: "main", new: "HEAD" });
  });

  test("a symmetric range takes the merge base, so the branch's own commits are not the old side", async () => {
    const root = await repo();
    const base = (await runGit(["rev-parse", "HEAD"], root)).trim();
    await runGit(["checkout", "-qb", "work"], root);
    await writeFile(path.join(root, "logo.png"), "second", "utf8");
    await runGit(["commit", "-qam", "second"], root);
    expect(await diffSides(source(root, ["main...work"]))).toEqual({ old: base, new: "work" });
  });

  test("two revisions are the two sides", async () => {
    const root = await repo();
    await runGit(["branch", "later"], root);
    expect(await diffSides(source(root, ["main", "later"]))).toEqual({ old: "main", new: "later" });
  });

  test("a pathspec is not a revision, so narrowing a run leaves its sides alone", async () => {
    const root = await repo();
    await mkdir(path.join(root, "assets"), { recursive: true });
    expect(await diffSides(source(root, ["assets"]))).toEqual({ old: "HEAD", new: WORKTREE });
  });
});

describe("readBlob", () => {
  test("reads a revision's blob, the index's, and the working tree's", async () => {
    const root = await repo();
    await writeFile(path.join(root, "logo.png"), "staged", "utf8");
    await runGit(["add", "-A"], root);
    await writeFile(path.join(root, "logo.png"), "working", "utf8");

    expect(text(await readBlob(root, "HEAD", "logo.png"))).toBe("first");
    expect(text(await readBlob(root, INDEX, "logo.png"))).toBe("staged");
    expect(text(await readBlob(root, WORKTREE, "logo.png"))).toBe("working");
  });

  test("a side that has no such file is an absence rather than a failure", async () => {
    const root = await repo();
    expect(await readBlob(root, "HEAD", "added-later.png")).toBeNull();
    expect(await readBlob(root, WORKTREE, "never-written.png")).toBeNull();
    expect(await readBlob(root, "no-such-rev", "logo.png")).toBeNull();
    expect(await readBlob(root, WORKTREE, "")).toBeNull();
  });

  test("nothing outside the repository is served, however the path is written", async () => {
    const root = await repo();
    await writeFile(path.join(root, "..", "outside.png"), "secret", "utf8");
    expect(await readBlob(root, WORKTREE, "../outside.png")).toBeNull();
    expect(await readBlob(root, WORKTREE, "assets/../../outside.png")).toBeNull();
  });
});
