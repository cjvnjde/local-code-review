import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { listReviews } from "./output.ts";
import { createSession } from "./session.ts";
import { parseReview } from "./thread.ts";
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
const read = async (dir: string, file: string) => parseReview(await readFile(path.join(dir, file), "utf8"));

describe("createSession", () => {
  test("the first save opens one timestamped file and later saves stay in it", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".review", "HEAD");
    await session.adoptNewest();

    const first = await session.save({ general: "", comments: [note("a|n12|n12|#1")] });
    expect(first.file).toMatch(/^\.review\/review-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.md$/);

    const second = await session.save({ general: "", comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")] });
    expect(second.file).toBe(first.file);
    expect(await listReviews(dir, ".review")).toHaveLength(1);
  });

  test("picks the newest review file back up, so a restart continues the conversation", async () => {
    const dir = await workspace("review-2026-01-01T00-00-00.md", "review-2026-02-01T00-00-00.md");
    const session = createSession(dir, ".", "HEAD");
    expect(await session.adoptNewest()).toBe("review-2026-02-01T00-00-00.md");

    const { file } = await session.save({ general: "", comments: [note("a|n12|n12|#1")] });
    expect(path.basename(file)).toBe("review-2026-02-01T00-00-00.md");
  });

  test("a save keeps the replies and the verdict the agent already wrote", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ general: "", comments: [note("a|n12|n12|#1")] });

    const name = path.basename(file);
    const answered = (await readFile(path.join(dir, name), "utf8"))
      .replace("Status: pending", "Status: applied — renamed\n\n**Agent** <!-- lcr:m -->\n\nRenamed it.\n");
    await writeFile(path.join(dir, name), answered, "utf8");

    // The reviewer edits the note and saves again while the agent is still working.
    await session.save({ general: "", comments: [note("a|n12|n12|#1", "Rename this, and the fixture.")] });
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
      general: "",
      comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")],
    });

    await session.save({ general: "", comments: [note("a|n12|n12|#1")] });
    const doc = await read(dir, path.basename(file));
    expect(doc.notes.map((entry) => entry.id)).toEqual(["a|n12|n12|#1", "a|n20|n20|#2"]);
  });

  test("a reply lands at the end of that note's thread", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ general: "", comments: [note("a|n12|n12|#1")] });

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
      general: "",
      comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")],
    });

    expect(await session.remove("a|n20|n20|#2")).toBe(true);
    expect(await session.remove("a|n20|n20|#2")).toBe(false);
    const doc = await read(dir, path.basename(file));
    expect(doc.notes.map((entry) => entry.id)).toEqual(["a|n12|n12|#1"]);
  });

  test("starting fresh leaves the old file alone and opens another one", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const first = await session.save({ general: "", comments: [note("a|n12|n12|#1")] });

    session.startFresh();
    const second = await session.save({ general: "", comments: [note("a|n20|n20|#2", "And this.")] });

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
    const { file, removed } = await session.save({ general: "", comments: [note("a|n12|n12|#1")] }, true);

    expect(removed).toEqual(["review-2026-01-01T00-00-00.md"]);
    expect(await listReviews(dir, ".")).toEqual([path.basename(file)]);
    expect(await readdir(dir)).toContain("notes.md");
  });

  test("an absolute output directory answers an absolute path", async () => {
    const dir = await workspace();
    const session = createSession(path.join(dir, "repo"), dir, "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ general: "", comments: [] });
    expect(path.isAbsolute(file)).toBe(true);
    expect(path.dirname(file)).toBe(dir);
  });
});
