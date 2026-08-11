import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { listReviews } from "./output.ts";
import { renderMarkdown } from "./review.ts";
import { createSession, matchesContext } from "./session.ts";
import { noteFromComment, parseReview } from "./thread.ts";
import type { ReviewComment } from "./types.ts";

const workspace = async (...names: string[]) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-session-"));
  for (const name of names) await writeFile(path.join(dir, name), "# Review notes\n", "utf8");
  return dir;
};
const note = (id: string, body = "Rename this."): ReviewComment => ({
  id,
  file: "src/app.ts",
  body,
  start: 12,
  end: 12,
  label: "12",
  side: "new",
  code: "+  const tmpValue = load();",
});
const overall = (id: string, body = "This branch does two things."): ReviewComment =>
  ({ id, file: "", body, scope: "global", start: 0, end: 0 });
const read = async (dir: string, file: string) => parseReview(await readFile(path.join(dir, file), "utf8"));

describe("createSession", () => {
  test("the first save opens one timestamped file and later saves stay in it", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".review", "HEAD");
    await session.adoptNewest();

    const first = await session.save({ comments: [note("a|n12|n12|#1")] });
    expect(first.file).toMatch(/^\.review\/review-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.md$/);

    const second = await session.save({ comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")] });
    expect(second.file).toBe(first.file);
    expect(await listReviews(dir, ".review")).toHaveLength(1);
  });

  test("picks the newest review file back up, so a restart continues the conversation", async () => {
    const dir = await workspace("review-2026-01-01T00-00-00.md", "review-2026-02-01T00-00-00.md");
    const session = createSession(dir, ".", "HEAD");
    expect(await session.adoptNewest()).toBe("review-2026-02-01T00-00-00.md");

    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });
    expect(path.basename(file)).toBe("review-2026-02-01T00-00-00.md");
  });

  test("a save keeps the replies and the verdict the agent already wrote", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });

    const name = path.basename(file);
    const answered = (await readFile(path.join(dir, name), "utf8"))
      .replace("Status: pending", "Status: applied — renamed\n\n**Agent** <!-- lcr:m -->\n\nRenamed it.\n");
    await writeFile(path.join(dir, name), answered, "utf8");

    // The reviewer edits the note and saves again while the agent is still working.
    await session.save({ comments: [note("a|n12|n12|#1", "Rename this, and the fixture.")] });
    const doc = await read(dir, name);
    expect(doc.notes[0]).toMatchObject({
      body: "Rename this, and the fixture.",
      status: "applied",
      detail: "renamed",
    });
    expect(doc.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: "Renamed it." }]);
  });

  test("a note the page no longer sends stays in the file", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({
      comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")],
    });

    await session.save({ comments: [note("a|n12|n12|#1")] });
    const doc = await read(dir, path.basename(file));
    expect(doc.notes.map((entry) => entry.id)).toEqual(["a|n12|n12|#1", "a|n20|n20|#2"]);
  });

  test("a reply lands at the end of that note's thread", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });

    expect(await session.reply("nope|n1|n1|#x", "hello")).toBeNull();
    const replied = await session.reply("a|n12|n12|#1", "Also the fixture, please.");
    expect(replied!.messages.at(-1)).toMatchObject({ role: "reviewer", body: "Also the fixture, please." });

    const doc = await read(dir, path.basename(file));
    expect(doc.notes[0]!.messages).toHaveLength(1);
    expect(doc.notes[0]!.messages[0]).toMatchObject({ role: "reviewer", body: "Also the fixture, please." });
  });

  test("deleting a note takes it out of the file", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({
      comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")],
    });

    expect(await session.remove("a|n20|n20|#2")).toBe(true);
    expect(await session.remove("a|n20|n20|#2")).toBe(false);
    const doc = await read(dir, path.basename(file));
    expect(doc.notes.map((entry) => entry.id)).toEqual(["a|n12|n12|#1"]);
  });

  test("clearing the page withdraws every note, overall notes included, in one write", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({
      comments: [overall("|@|@|#g1"), note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")],
    });

    expect(await session.remove(["|@|@|#g1", "a|n12|n12|#1", "a|n20|n20|#2"])).toBe(true);
    const doc = await read(dir, path.basename(file));
    expect(doc.notes).toEqual([]);
    // Nothing left to take out: the file is not rewritten again.
    expect(await session.remove(["a|n12|n12|#1"])).toBe(false);
  });

  test("an overall note keeps its thread across a save, like any other note", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [overall("|@|@|#g1")] });

    const name = path.basename(file);
    const answered = (await readFile(path.join(dir, name), "utf8"))
      .replace("Status: pending", "Status: answered — split in a follow-up\n\n**Agent** <!-- lcr:m -->\n\nNoted.\n");
    await writeFile(path.join(dir, name), answered, "utf8");

    await session.save({ comments: [overall("|@|@|#g1", "This branch does two things. Split it.")] });
    const doc = await read(dir, name);
    expect(doc.notes[0]).toMatchObject({
      scope: "global",
      body: "This branch does two things. Split it.",
      status: "answered",
      detail: "split in a follow-up",
    });
    expect(doc.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: "Noted." }]);
  });

  test("withdrawing against a session with no file yet opens none", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    session.startFresh();

    expect(await session.remove(["a|n12|n12|#1"])).toBe(false);
    expect(await listReviews(dir, ".")).toEqual([]);
  });

  test("starting fresh leaves the old file alone and opens another one", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const first = await session.save({ comments: [note("a|n12|n12|#1")] });

    session.startFresh();
    const second = await session.save({ comments: [note("a|n20|n20|#2", "And this.")] });

    expect(second.file).not.toBe(first.file);
    expect(await listReviews(dir, ".")).toHaveLength(2);
    expect((await read(dir, path.basename(first.file))).notes.map((n) => n.id)).toEqual(["a|n12|n12|#1"]);
    expect((await read(dir, path.basename(second.file))).notes.map((n) => n.id)).toEqual(["a|n20|n20|#2"]);
    // The fresh file has to be the one a restart picks up, however close together the two were made.
    expect(await listReviews(dir, ".")).toEqual([path.basename(first.file), path.basename(second.file)]);
    expect(await session.adoptNewest()).toBe(path.basename(second.file));
  });

  test("replace prunes the earlier reviews and keeps the session file", async () => {
    const dir = await workspace("review-2026-01-01T00-00-00.md", "notes.md");
    const session = createSession(dir, ".", "HEAD");
    session.startFresh(); // do not adopt: this run wants its own file
    const { file, removed } = await session.save({ comments: [note("a|n12|n12|#1")] }, true);

    expect(removed).toEqual(["review-2026-01-01T00-00-00.md"]);
    expect(await listReviews(dir, ".")).toEqual([path.basename(file)]);
    expect(await readdir(dir)).toContain("notes.md");
  });

  test("an absolute output directory answers an absolute path", async () => {
    const dir = await workspace();
    const session = createSession(path.join(dir, "repo"), dir, "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [] });
    expect(path.isAbsolute(file)).toBe(true);
    expect(path.dirname(file)).toBe(dir);
  });

  test("stamps the context it was opened in into the file it mints", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "main..HEAD", { range: "main..HEAD", branch: "feat", base: "abc123" });
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });

    const doc = await read(dir, path.basename(file));
    expect(doc).toMatchObject({ range: "main..HEAD", branch: "feat", base: "abc123" });
  });
});

/** One review file written with the given context, named so the stamps sort as given. */
const reviewFile = (stamp: string, range: string, branch?: string, base?: string) =>
  [`review-${stamp}.md`, renderMarkdown({
    range,
    ...(branch ? { branch } : {}),
    ...(base ? { base } : {}),
    notes: [noteFromComment(note("a|n12|n12|#1"))],
  })] as const;

describe("adoptMatching", () => {
  const fill = async (...files: (readonly [string, string])[]) => {
    const dir = await mkdtemp(path.join(tmpdir(), "lcr-session-"));
    for (const [name, text] of files) await writeFile(path.join(dir, name), text, "utf8");
    return dir;
  };

  test("a restart on the same context continues its own conversation, not the newest one", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "main..HEAD", "feat", "abc123"),
      reviewFile("2026-01-02T00-00-00", "working tree vs HEAD (incl. untracked)", "feat", "abc123"),
    );
    const session = createSession(dir, ".", "main..HEAD", { range: "main..HEAD", branch: "feat", base: "abc123" });
    expect(await session.adoptMatching()).toBe("review-2026-01-01T00-00-00.md");
  });

  test("another branch's review of the same range is not this conversation", async () => {
    const dir = await fill(reviewFile("2026-01-01T00-00-00", "main..HEAD", "other", "abc123"));
    const session = createSession(dir, ".", "main..HEAD", { range: "main..HEAD", branch: "feat", base: "abc123" });
    expect(await session.adoptMatching()).toBe("");
  });

  test("a moved base means new work: the old conversation stays history", async () => {
    const dir = await fill(reviewFile("2026-01-01T00-00-00", "main..HEAD", "feat", "abc123"));
    const session = createSession(dir, ".", "main..HEAD", { range: "main..HEAD", branch: "feat", base: "def456" });
    expect(await session.adoptMatching()).toBe("");
  });

  test("a file from before the context fields matches on its range alone", async () => {
    const dir = await fill(reviewFile("2026-01-01T00-00-00", "main..HEAD"));
    const session = createSession(dir, ".", "main..HEAD", { range: "main..HEAD", branch: "feat", base: "abc123" });
    expect(await session.adoptMatching()).toBe("review-2026-01-01T00-00-00.md");
  });

  test("matchesContext treats an unknown side as agreement, never as difference", () => {
    expect(matchesContext({ range: "HEAD" }, { range: "HEAD", branch: "feat", base: "abc" })).toBe(true);
    expect(matchesContext({ range: "HEAD", branch: "feat" }, { range: "HEAD" })).toBe(true);
    expect(matchesContext({ range: "HEAD" }, { range: "HEAD~1" })).toBe(false);
  });
});

describe("reopening and continuing", () => {
  test("a reopened review keeps saying where it came from, not where it was reopened", async () => {
    const dir = await workspace();
    const first = createSession(dir, ".", "main..HEAD", { range: "main..HEAD", branch: "feat", base: "abc123" });
    const { file } = await first.save({ comments: [note("a|n12|n12|#1")] });
    const name = path.basename(file);

    const second = createSession(dir, ".", "HEAD", { range: "HEAD", branch: "other", base: "def456" });
    expect(await second.adoptFile(name)).toBe(true);
    expect(await second.adoptFile("review-not-there.md")).toBe(false);
    await second.save({ comments: [note("a|n20|n20|#2", "And this.")] });

    const doc = await read(dir, name);
    expect(doc).toMatchObject({ range: "main..HEAD", branch: "feat", base: "abc123" });
    expect(doc.notes).toHaveLength(2);
  });

  test("an imported note lands with its old thread, its provenance, and a fresh start", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    session.startFresh();

    const carried = await session.import(
      note("a|n30|n30|#9", "Rename this."),
      [{ role: "agent", at: "", body: "Renamed the local, not the field." }],
      "review-2026-01-01T00-00-00.md#a|n12|n12|#1",
    );
    expect(carried.status).toBe("pending");

    const doc = await read(dir, session.file);
    expect(doc.notes[0]).toMatchObject({
      id: "a|n30|n30|#9",
      body: "Rename this.",
      status: "pending",
      from: "review-2026-01-01T00-00-00.md#a|n12|n12|#1",
    });
    expect(doc.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: "Renamed the local, not the field." }]);

    // The reviewer edits and saves the continued note: its provenance is not the page's to drop.
    await session.save({ comments: [note("a|n30|n30|#9", "Rename this everywhere.")] });
    const after = await read(dir, session.file);
    expect(after.notes[0]).toMatchObject({
      body: "Rename this everywhere.",
      from: "review-2026-01-01T00-00-00.md#a|n12|n12|#1",
    });
  });
});
