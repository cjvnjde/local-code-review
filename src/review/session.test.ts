import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { listReviews } from "./output.ts";
import { renderMarkdown } from "./render.ts";
import { createSession, matchesContext } from "./session.ts";
import { noteFromComment, parseReview } from "./thread.ts";
import type { ReviewComment } from "../shared/review-types.ts";
import { reviewerRevision } from "../agent/agent-queue.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const workspace = async (...names: string[]) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-session-"));
  roots.push(dir);
  for (const name of names)
    await writeFile(path.join(dir, name), "# Review notes\n", "utf8");
  return dir;
};
const note = (id: string, body = "Rename this."): ReviewComment => ({
  id,
  file: id.split("|")[0]!,
  body,
  start: 12,
  end: 12,
  label: "12",
  side: "new",
  code: "+  const tmpValue = load();",
});
const overall = (
  id: string,
  body = "This branch does two things.",
): ReviewComment => ({ id, file: "", body, scope: "global", start: 0, end: 0 });
const read = async (dir: string, file: string) =>
  parseReview(await readFile(path.join(dir, file), "utf8"));

describe("createSession", () => {
  test("screenshot regions survive replies, edits and restarts; deletion removes only the chosen region", async () => {
    const dir = await workspace(),
      session = createSession(dir, ".review", "HEAD");
    const image = {
      side: "new" as const,
      x: 10,
      y: 100,
      width: 40,
      height: 30,
      imageWidth: 100,
      imageHeight: 2000,
      source: "abc",
      capture: "images/area.png",
    };
    const area: ReviewComment = {
      id: "screen.png|*|*|#area",
      file: "screen.png",
      scope: "file",
      start: 0,
      end: 0,
      body: "Move this label.",
      image,
    };
    const other = {
      ...area,
      id: "screen.png|*|*|#other",
      image: { ...image, y: 300 },
    };
    const { file } = await session.save({ comments: [area, other] });
    await session.reply(area.id!, "Keep the button where it is.");
    await session.save({
      comments: [{ ...area, body: "Move this label left." }],
    });
    const restarted = createSession(dir, ".review", "HEAD");
    await restarted.adoptNewest();
    const doc = await read(dir, file);
    expect(doc.notes[0]!.image).toEqual(image);
    expect(doc.notes[0]!.messages[0]!.body).toBe(
      "Keep the button where it is.",
    );
    await restarted.remove([area.id!]);
    expect((await read(dir, file)).notes.map((n) => n.id)).toEqual([other.id]);
  });
  test("the first save opens one timestamped file and later saves stay in it", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".review", "HEAD");
    await session.adoptNewest();

    const first = await session.save({ comments: [note("a|n12|n12|#1")] });
    expect(first.file).toMatch(
      /^\.review\/review-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.md$/,
    );

    const second = await session.save({
      comments: [note("a|n12|n12|#1"), note("a|n20|n20|#2", "And this.")],
    });
    expect(second.file).toBe(first.file);
    expect(await listReviews(dir, ".review")).toHaveLength(1);
  });

  test("picks the newest review file back up, so a restart continues the conversation", async () => {
    const dir = await workspace(
      "review-2026-01-01T00-00-00.md",
      "review-2026-02-01T00-00-00.md",
    );
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
    const answered = (await readFile(path.join(dir, name), "utf8")).replace(
      "Status: pending",
      "Status: applied — renamed\n\n**Agent** <!-- lcr:m -->\n\nRenamed it.\n",
    );
    await writeFile(path.join(dir, name), answered, "utf8");

    await expect(
      session.save({
        comments: [note("a|n12|n12|#1", "Rename this, and the fixture.")],
      }),
    ).rejects.toThrow("follow-up");
    const unchanged = await session.save({ comments: [note("a|n12|n12|#1")] });
    expect(unchanged.changed).toEqual([]);
    const doc = await read(dir, name);
    expect(doc.notes[0]).toMatchObject({
      body: "Rename this.",
      status: "applied",
      detail: "renamed",
    });
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "", body: "Renamed it." },
    ]);
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
    expect(doc.notes.map((entry) => entry.id)).toEqual([
      "a|n12|n12|#1",
      "a|n20|n20|#2",
    ]);
  });

  test("a reply lands at the end of that note's thread", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });

    expect(await session.reply("nope|n1|n1|#x", "hello")).toBeNull();
    const replied = await session.reply(
      "a|n12|n12|#1",
      "Also the fixture, please.",
    );
    expect(replied!.messages.at(-1)).toMatchObject({
      role: "reviewer",
      body: "Also the fixture, please.",
    });

    const doc = await read(dir, path.basename(file));
    expect(doc.notes[0]!.messages).toHaveLength(1);
    expect(doc.notes[0]!.messages[0]).toMatchObject({
      role: "reviewer",
      body: "Also the fixture, please.",
    });
  });

  test("two replies on one note never share a stamp, so each stays addressable", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    await session.save({ comments: [note("a|n12|n12|#1")] });

    await session.reply("a|n12|n12|#1", "One.");
    const twice = await session.reply("a|n12|n12|#1", "Two.");
    const stamps = twice!.messages.map((entry) => entry.at);
    expect(stamps.filter(Boolean)).toHaveLength(2);
    expect(new Set(stamps).size).toBe(2);
  });

  test("a reply can be reworded where it stands, keeping its stamp and its place", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });
    const first = await session.reply(
      "a|n12|n12|#1",
      "Also the fixture, please.",
    );
    await session.reply("a|n12|n12|#1", "And the docs.");
    const at = first!.messages[0]!.at;

    expect(
      await session.editReply(
        "a|n12|n12|#1",
        at,
        "Also the fixture — and its snapshot.",
      ),
    ).not.toBeNull();
    const doc = await read(dir, path.basename(file));
    expect(doc.notes[0]!.messages).toEqual([
      { role: "reviewer", at, body: "Also the fixture — and its snapshot." },
      {
        role: "reviewer",
        at: doc.notes[0]!.messages[1]!.at,
        body: "And the docs.",
      },
    ]);

    // A stamp nobody wrote, and a note that is not in the file, are both refusals rather than writes.
    expect(
      await session.editReply(
        "a|n12|n12|#1",
        "2020-01-01T00:00:00.000Z",
        "nope",
      ),
    ).toBeNull();
    expect(await session.editReply("gone|n1|n1|#x", at, "nope")).toBeNull();
    expect(await session.editReply("a|n12|n12|#1", "", "nope")).toBeNull();
  });

  test("answered replies are immutable while a new follow-up can still be corrected", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const id = "a|n12|n12|#1";
    await session.save({ comments: [note(id)] });
    const first = await session.reply(id, "Check the fixture too.");
    const at = first!.messages[0]!.at;
    await session.answer(session.file, id, "Checked.", "answered");
    await expect(session.editReply(id, at, "Changed history.")).rejects.toThrow(
      "answered",
    );
    await expect(session.dropReply(id, at)).rejects.toThrow("answered");
    const next = await session.reply(id, "Now check the docs.");
    const followupAt = next!.messages.at(-1)!.at;
    expect(
      await session.editReply(id, followupAt, "Check both docs."),
    ).not.toBeNull();
    expect(await session.dropReply(id, followupAt)).not.toBeNull();
    const kept = (await session.read()).notes[0]!;
    expect(kept.messages.map((message) => message.body)).toEqual([
      "Check the fixture too.",
      "Checked.",
    ]);
    expect(kept.status).toBe("answered");
  });

  test("a terminal verdict locks the original even without an agent message", async () => {
    for (const status of ["applied", "answered", "skipped"]) {
      const dir = await workspace();
      const session = createSession(dir, ".", "HEAD");
      const id = "a|n12|n12|#1";
      await session.save({ comments: [note(id)] });
      const file = path.join(dir, session.file);
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace(
          "Status: pending",
          "Status: " + status,
        ),
      );
      await expect(
        session.save({ comments: [note(id, "Replace the original.")] }),
      ).rejects.toThrow("answered");
      expect((await session.save({ comments: [note(id)] })).changed).toEqual(
        [],
      );
    }
  });

  test("the agent's own messages are not the page's to rewrite or take back", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });

    const name = path.basename(file);
    const answered = (await readFile(path.join(dir, name), "utf8")).replace(
      "Status: pending",
      "Status: applied — renamed\n\n**Agent** <!-- lcr:m 2026-03-01T10-00-00.000Z -->\n\nRenamed it.\n",
    );
    await writeFile(path.join(dir, name), answered, "utf8");

    const stamp = (await read(dir, name)).notes[0]!.messages[0]!.at;
    expect(
      await session.editReply("a|n12|n12|#1", stamp, "no i didn't"),
    ).toBeNull();
    expect(await session.dropReply("a|n12|n12|#1", stamp)).toBeNull();
    expect((await read(dir, name)).notes[0]!.messages).toEqual([
      { role: "agent", at: stamp, body: "Renamed it." },
    ]);
  });

  test("deleting a reply takes that message out of the thread and leaves the rest", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    await session.adoptNewest();
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });
    const first = await session.reply(
      "a|n12|n12|#1",
      "Also the fixture, please.",
    );
    await session.reply("a|n12|n12|#1", "And the docs.");
    const at = first!.messages[0]!.at;

    expect(await session.dropReply("a|n12|n12|#1", at)).not.toBeNull();
    expect(await session.dropReply("a|n12|n12|#1", at)).toBeNull();
    const doc = await read(dir, path.basename(file));
    expect(doc.notes[0]!.messages.map((entry) => entry.body)).toEqual([
      "And the docs.",
    ]);
    // The note itself is untouched by what it said back.
    expect(doc.notes[0]).toMatchObject({
      id: "a|n12|n12|#1",
      body: "Rename this.",
    });
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
      comments: [
        overall("|@|@|#g1"),
        note("a|n12|n12|#1"),
        note("a|n20|n20|#2", "And this."),
      ],
    });

    expect(
      await session.remove(["|@|@|#g1", "a|n12|n12|#1", "a|n20|n20|#2"]),
    ).toBe(true);
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
    const answered = (await readFile(path.join(dir, name), "utf8")).replace(
      "Status: pending",
      "Status: answered — split in a follow-up\n\n**Agent** <!-- lcr:m -->\n\nNoted.\n",
    );
    await writeFile(path.join(dir, name), answered, "utf8");

    await expect(
      session.save({
        comments: [
          overall("|@|@|#g1", "This branch does two things. Split it."),
        ],
      }),
    ).rejects.toThrow("follow-up");
    await session.save({ comments: [overall("|@|@|#g1")] });
    const doc = await read(dir, name);
    expect(doc.notes[0]).toMatchObject({
      scope: "global",
      body: "This branch does two things.",
      status: "answered",
      detail: "split in a follow-up",
    });
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "", body: "Noted." },
    ]);
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
    const second = await session.save({
      comments: [note("a|n20|n20|#2", "And this.")],
    });

    expect(second.file).not.toBe(first.file);
    expect(await listReviews(dir, ".")).toHaveLength(2);
    expect(
      (await read(dir, path.basename(first.file))).notes.map((n) => n.id),
    ).toEqual(["a|n12|n12|#1"]);
    expect(
      (await read(dir, path.basename(second.file))).notes.map((n) => n.id),
    ).toEqual(["a|n20|n20|#2"]);
    // The fresh file has to be the one a restart picks up, however close together the two were made.
    expect(await listReviews(dir, ".")).toEqual([
      path.basename(first.file),
      path.basename(second.file),
    ]);
    expect(await session.adoptNewest()).toBe(path.basename(second.file));
  });

  test("replace prunes the earlier reviews and keeps the session file", async () => {
    const dir = await workspace("review-2026-01-01T00-00-00.md", "notes.md");
    const session = createSession(dir, ".", "HEAD");
    session.startFresh(); // do not adopt: this run wants its own file
    const { file, removed } = await session.save(
      { comments: [note("a|n12|n12|#1")] },
      true,
    );

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
    const session = createSession(dir, ".", "main..HEAD", {
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });

    const doc = await read(dir, path.basename(file));
    expect(doc).toMatchObject({
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
  });
});

/** One review file written with the given context, named so the stamps sort as given. */
const reviewFile = (
  stamp: string,
  range: string,
  branch?: string,
  base?: string,
  id?: string,
) =>
  [
    `review-${stamp}.md`,
    renderMarkdown({
      range,
      ...(id ? { id } : {}),
      ...(branch ? { branch } : {}),
      ...(base ? { base } : {}),
      notes: [noteFromComment(note("a|n12|n12|#1"))],
    }),
  ] as const;

describe("adoptMatching", () => {
  const fill = async (...files: (readonly [string, string])[]) => {
    const dir = await workspace();
    for (const [name, text] of files)
      await writeFile(path.join(dir, name), text, "utf8");
    return dir;
  };

  test("a restart on the same context continues its own conversation, not the newest one", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "main..HEAD", "feat", "abc123"),
      reviewFile(
        "2026-01-02T00-00-00",
        "working tree vs HEAD (incl. untracked)",
        "feat",
        "abc123",
      ),
    );
    const session = createSession(dir, ".", "main..HEAD", {
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
    expect(await session.adoptMatching()).toBe("review-2026-01-01T00-00-00.md");
  });

  test("another branch's review of the same range is not this conversation", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "main..HEAD", "other", "abc123"),
    );
    const session = createSession(dir, ".", "main..HEAD", {
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
    expect(await session.adoptMatching()).toBe("");
  });

  test("a moved base means new work: the old conversation stays history", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "main..HEAD", "feat", "abc123"),
    );
    const session = createSession(dir, ".", "main..HEAD", {
      range: "main..HEAD",
      branch: "feat",
      base: "def456",
    });
    expect(await session.adoptMatching()).toBe("");
  });

  test("a file from before the context fields matches on its range alone", async () => {
    const dir = await fill(reviewFile("2026-01-01T00-00-00", "main..HEAD"));
    const session = createSession(dir, ".", "main..HEAD", {
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
    expect(await session.adoptMatching()).toBe("review-2026-01-01T00-00-00.md");
  });

  test("matchesContext treats an unknown side as agreement, never as difference", () => {
    expect(
      matchesContext(
        { range: "HEAD" },
        { range: "HEAD", branch: "feat", base: "abc" },
      ),
    ).toBe(true);
    expect(
      matchesContext({ range: "HEAD", branch: "feat" }, { range: "HEAD" }),
    ).toBe(true);
    expect(matchesContext({ range: "HEAD" }, { range: "HEAD~1" })).toBe(false);
  });

  test("a name is the whole identity: it outranks the diff, and both sides must agree on it", () => {
    // The same name continues its review wherever the diff, branch, and base have moved to since.
    expect(
      matchesContext(
        { range: "main..HEAD", id: "auth", branch: "feat", base: "abc" },
        { range: "HEAD", id: "auth", branch: "other", base: "def" },
      ),
    ).toBe(true);
    // Another name is another review, and a run that names none stays out of every named one.
    expect(
      matchesContext(
        { range: "HEAD", id: "auth" },
        { range: "HEAD", id: "docs" },
      ),
    ).toBe(false);
    expect(
      matchesContext({ range: "HEAD", id: "auth" }, { range: "HEAD" }),
    ).toBe(false);
    expect(
      matchesContext({ range: "HEAD" }, { range: "HEAD", id: "auth" }),
    ).toBe(false);
  });
});

describe("named reviews", () => {
  const fill = async (...files: (readonly [string, string])[]) => {
    const dir = await workspace();
    for (const [name, text] of files)
      await writeFile(path.join(dir, name), text, "utf8");
    return dir;
  };
  const named = (dir: string, id: string, range = "HEAD") =>
    createSession(dir, ".", range, {
      range,
      id,
      branch: "feat",
      base: "abc123",
    });

  test("the same name continues its review, even from another diff", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "main..HEAD", "feat", "abc123", "auth"),
      reviewFile("2026-01-02T00-00-00", "HEAD", "feat", "abc123"),
    );
    expect(await named(dir, "auth").adoptMatching()).toBe(
      "review-2026-01-01T00-00-00.md",
    );
  });

  test("a name nothing was written under yet starts an altogether new review", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "HEAD", "feat", "abc123", "auth"),
      reviewFile("2026-01-02T00-00-00", "HEAD", "feat", "abc123"),
    );
    const session = named(dir, "docs");
    expect(await session.adoptMatching()).toBe("");

    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });
    const doc = await read(dir, path.basename(file));
    expect(doc.id).toBe("docs");
    expect(doc.notes.map((entry) => entry.id)).toEqual(["a|n12|n12|#1"]);
    // The reviews already on disk are untouched history.
    expect(await listReviews(dir, ".")).toHaveLength(3);
  });

  test("an unnamed run leaves a named review alone, however well its diff matches", async () => {
    const dir = await fill(
      reviewFile("2026-01-01T00-00-00", "HEAD", "feat", "abc123", "auth"),
    );
    const session = createSession(dir, ".", "HEAD", {
      range: "HEAD",
      branch: "feat",
      base: "abc123",
    });
    expect(await session.adoptMatching()).toBe("");
  });

  test("a named review keeps its name across saves and replies", async () => {
    const dir = await fill();
    const session = named(dir, "auth", "main..HEAD");
    const { file } = await session.save({ comments: [note("a|n12|n12|#1")] });
    await session.reply("a|n12|n12|#1", "Also the fixture, please.");

    const doc = await read(dir, path.basename(file));
    expect(doc).toMatchObject({
      id: "auth",
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
    // A restart under that name comes back to this file.
    expect(await named(dir, "auth", "HEAD").adoptMatching()).toBe(
      path.basename(file),
    );
  });
});

describe("reopening and continuing", () => {
  test("a reopened review keeps saying where it came from, not where it was reopened", async () => {
    const dir = await workspace();
    const first = createSession(dir, ".", "main..HEAD", {
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
    const { file } = await first.save({ comments: [note("a|n12|n12|#1")] });
    const name = path.basename(file);

    const second = createSession(dir, ".", "HEAD", {
      range: "HEAD",
      branch: "other",
      base: "def456",
    });
    expect(await second.adoptFile(name)).toBe(true);
    expect(await second.adoptFile("review-not-there.md")).toBe(false);
    await second.save({ comments: [note("a|n20|n20|#2", "And this.")] });

    const doc = await read(dir, name);
    expect(doc).toMatchObject({
      range: "main..HEAD",
      branch: "feat",
      base: "abc123",
    });
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
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "", body: "Renamed the local, not the field." },
    ]);

    await expect(
      session.save({
        comments: [note("a|n30|n30|#9", "Rename this everywhere.")],
      }),
    ).rejects.toThrow("follow-up");
    await session.reply("a|n30|n30|#9", "Rename this everywhere.");
    const after = await read(dir, session.file);
    expect(after.notes[0]).toMatchObject({
      body: "Rename this.",
      from: "review-2026-01-01T00-00-00.md#a|n12|n12|#1",
    });
  });
});

test("reviewer mutations retain the review they named while another review is adopted", async () => {
  const root = await workspace();
  const session = createSession(root, ".review", "HEAD");
  await session.save({ comments: [note("src/app.ts|n12|n12|#routing")] });
  const original = session.file;
  session.startFresh();
  await session.save({
    comments: [note("src/app.ts|n12|n12|#routing", "Another review")],
  });
  const other = session.file;
  await session.reply(
    "src/app.ts|n12|n12|#routing",
    "Answer the original",
    original,
  );
  expect(
    (await session.readNote(original, "src/app.ts|n12|n12|#routing"))!
      .messages[0]!.body,
  ).toBe("Answer the original");
  expect(
    (await session.readNote(other, "src/app.ts|n12|n12|#routing"))!.messages,
  ).toEqual([]);
  await session.remove(["src/app.ts|n12|n12|#routing"], original);
  expect(
    await session.readNote(original, "src/app.ts|n12|n12|#routing"),
  ).toBeNull();
  expect((await session.read()).notes).toHaveLength(1);
});

describe("serialized conversation mutations", () => {
  test("concurrent saves, answers, follow-ups and withdrawal preserve their invocation order", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a"),
      b = note("b|n12|n12|#b");
    await session.save({ comments: [a, b] });
    const file = session.file;
    const results = await Promise.all([
      session.save({ comments: [{ ...a, body: "Revised before answering." }] }),
      session.answer(file, a.id!, "Applied the revised request.", "applied"),
      session.reply(a.id!, "Please check the tests too."),
      session.remove(b.id!),
      session.read(),
    ]);
    expect(results[0].changed.map((entry) => entry.body)).toEqual([
      "Revised before answering.",
    ]);
    const doc = results[4];
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({
      id: a.id,
      body: "Revised before answering.",
      status: "applied",
    });
    expect(
      doc.notes[0]!.messages.map(({ role, body }) => ({ role, body })),
    ).toEqual([
      { role: "agent", body: "Applied the revised request." },
      { role: "reviewer", body: "Please check the tests too." },
    ]);
    expect(await read(dir, file)).toEqual(doc);
  });

  test("one locked edit aborts the whole save and does not poison later queued mutations", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a"),
      b = note("b|n12|n12|#b");
    await session.save({ comments: [a, b] });
    await session.answer(session.file, b.id!, "Already answered.", "answered");
    const before = await readFile(path.join(dir, session.file), "utf8");
    const failed = session.save({
      comments: [
        { ...a, body: "Must not partially persist." },
        { ...b, body: "Cannot rewrite this." },
      ],
    });
    const following = session.reply(a.id!, "Queue still works.");
    await expect(failed).rejects.toThrow("follow-up");
    expect((await following)!.body).toBe(a.body);
    const doc = await session.read();
    expect(doc.notes.map((entry) => entry.body)).toEqual([a.body, b.body]);
    expect(doc.notes[0]!.messages[0]!.body).toBe("Queue still works.");
    expect(parseReview(before).notes[1]).toEqual(doc.notes[1]);
  });

  test("fresh external verdicts, provenance and messages survive unrelated multi-note saves", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a"),
      b = note("b|n12|n12|#b");
    await session.save({ comments: [a, b] });
    const external = await read(dir, session.file);
    Object.assign(external.notes[0]!, {
      status: "needs-input",
      detail: "Which callers?",
      from: "review-old.md#a|n1|n1|#source",
      messages: [
        {
          role: "agent",
          at: "2026-01-01T00:00:00.000Z",
          body: "Need a decision.",
        },
      ],
    });
    await writeFile(
      path.join(dir, session.file),
      renderMarkdown(external),
      "utf8",
    );
    const result = await session.save({
      comments: [a, { ...b, body: "Only this changed." }],
    });
    expect(result.changed.map((entry) => entry.id)).toEqual([b.id]);
    expect((await session.read()).notes[0]).toEqual(external.notes[0]);
    const retry = await session.save({
      comments: [a, { ...b, body: "Only this changed." }],
    });
    expect(retry.changed).toEqual([]);
  });

  test("a queue barrier switches conversations only after earlier writes finish", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a");
    await session.save({ comments: [a] });
    const first = session.file;
    const pending = session.reply(a.id!, "Belongs to the old conversation.");
    const switchFile = session.run(async () => {
      session.startFresh();
    });
    const fresh = session.save({ comments: [note("b|n12|n12|#b")] });
    await Promise.all([pending, switchFile, fresh]);
    expect(session.file).not.toBe(first);
    expect((await read(dir, first)).notes[0]!.messages[0]!.body).toBe(
      "Belongs to the old conversation.",
    );
    expect((await session.read()).notes.map((entry) => entry.id)).toEqual([
      "b|n12|n12|#b",
    ]);
  });

  test("unstamped reviewer messages cannot be edited or withdrawn", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a");
    await session.import(
      a,
      [{ role: "reviewer", at: "", body: "Hand-written follow-up." }],
      "",
    );
    const before = await readFile(path.join(dir, session.file), "utf8");
    expect(await session.editReply(a.id!, "", "Replacement.")).toBeNull();
    expect(await session.dropReply(a.id!, "")).toBeNull();
    expect(await readFile(path.join(dir, session.file), "utf8")).toBe(before);
  });
});

describe("submitted revision ownership", () => {
  test("an unchanged submission receives its verdict and clears the previous detail", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a");
    await session.save({ comments: [a] });
    const doc = await session.read();
    doc.notes[0]!.status = "needs-input";
    doc.notes[0]!.detail = "Old question.";
    await writeFile(path.join(dir, session.file), renderMarkdown(doc), "utf8");
    const revision = reviewerRevision(doc.notes[0]!);
    const result = await session.answerRevision(
      session.file,
      a.id!,
      "Resolved.",
      revision,
      "applied",
    );
    expect(result).toMatchObject({ status: "applied", detail: "" });
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]!.body).toBe("Resolved.");
    expect((await session.read()).notes[0]).toEqual(result);
  });

  test.each(["edit", "follow-up"] as const)(
    "a later %s retains its status when an older submission completes",
    async (change) => {
      const dir = await workspace();
      const session = createSession(dir, ".", "HEAD");
      const a = note("a|n12|n12|#a");
      await session.save({ comments: [a] });
      const submitted = (await session.read()).notes[0]!;
      const revision = reviewerRevision(submitted);
      if (change === "edit")
        await session.save({ comments: [{ ...a, body: "New request." }] });
      else await session.reply(a.id!, "One more requirement.");
      const result = await session.answerRevision(
        session.file,
        a.id!,
        "Old result.",
        revision,
        "applied",
      );
      expect(result!.status).toBe("pending");
      expect(result!.messages.at(-1)).toMatchObject({ role: "agent" });
      expect(result!.messages.at(-1)!.body).toContain(revision.slice(0, 12));
      expect(result!.messages.at(-1)!.body).toContain("Old result.");
      expect(result!.body).toBe(change === "edit" ? "New request." : a.body);
      if (change === "follow-up")
        expect(result!.messages[0]!.body).toBe("One more requirement.");
    },
  );

  test("late agent results neither resurrect withdrawn notes nor change the current conversation", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a");
    await session.save({ comments: [a] });
    const first = session.file,
      revision = reviewerRevision((await session.read()).notes[0]!);
    await session.remove(a.id!);
    const before = await readFile(path.join(dir, first), "utf8");
    session.startFresh();
    await session.save({ comments: [a] });
    expect(
      await session.answerRevision(
        first,
        a.id!,
        "Too late.",
        revision,
        "applied",
      ),
    ).toBeNull();
    expect(
      await session.answer("review-missing.md", a.id!, "Missing."),
    ).toBeNull();
    expect(await readFile(path.join(dir, first), "utf8")).toBe(before);
    expect((await session.read()).notes[0]).toMatchObject({
      status: "pending",
      messages: [],
    });
  });

  test("concurrent agent and reviewer messages all retain distinct addressable stamps", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a");
    await session.save({ comments: [a] });
    await Promise.all([
      session.reply(a.id!, "First."),
      session.answer(session.file, a.id!, "Answer."),
      session.reply(a.id!, "Second."),
      session.reply(a.id!, "Third."),
    ]);
    const messages = (await session.read()).notes[0]!.messages;
    expect(new Set(messages.map((entry) => entry.at)).size).toBe(4);
    expect(
      messages.every((entry) => Number.isFinite(Date.parse(entry.at))),
    ).toBe(true);
    await session.editReply(a.id!, messages[2]!.at, "Corrected second.");
    await session.dropReply(a.id!, messages[3]!.at);
    expect(
      (await session.read()).notes[0]!.messages.map((entry) => entry.body),
    ).toEqual(["First.", "Answer.", "Corrected second."]);
  });
});

test("named adoption selects the newest matching name and preserves its original context", async () => {
  const dir = await workspace();
  const entries = [
    reviewFile("2026-01-01T00-00-00", "old..HEAD", "old", "111", "auth"),
    reviewFile("2026-01-02T00-00-00", "moved..HEAD", "moved", "222", "auth"),
    reviewFile("2026-01-03T00-00-00", "HEAD", "current", "333", "other"),
  ];
  for (const [file, text] of entries)
    await writeFile(path.join(dir, file), text);
  const session = createSession(dir, ".", "HEAD", {
    range: "HEAD",
    id: "auth",
    branch: "current",
    base: "333",
  });
  expect(await session.adoptMatching()).toBe(entries[1]![0]);
  await session.save({ comments: [note("b|n12|n12|#b")] });
  expect(await session.read()).toMatchObject({
    id: "auth",
    range: "moved..HEAD",
    branch: "moved",
    base: "222",
  });
  expect(await readFile(path.join(dir, entries[0]![0]), "utf8")).toBe(
    entries[0]![1],
  );
  expect(await readFile(path.join(dir, entries[2]![0]), "utf8")).toBe(
    entries[2]![1],
  );
});

describe("reviewer evidence change detection", () => {
  test.each([
    ["captured code", { code: "+  const renamed = load();" }],
    ["removed captured code", { code: "" }],
    ["selected text", { snippet: "load()" }],
    ["selected side", { side: "old" as const }],
  ])(
    "a changed %s is submitted even when the request wording is unchanged",
    async (_field, patch) => {
      const dir = await workspace();
      const session = createSession(dir, ".", "HEAD");
      const original = note("a|n12|n12|#evidence");
      await session.save({ comments: [original] });
      const edited = { ...original, ...patch };
      const result = await session.save({ comments: [edited] });
      expect(result.changed).toHaveLength(1);
      expect(result.changed[0]!.id).toBe(original.id);
      const persisted = (await session.read()).notes[0]!;
      expect(persisted.body).toBe(original.body);
      if ("code" in patch) expect(persisted.code ?? "").toBe(patch.code);
      if ("snippet" in patch) expect(persisted.snippet).toBe(patch.snippet);
      if ("side" in patch) expect(persisted.side).toBe(patch.side);
      expect((await session.save({ comments: [edited] })).changed).toEqual([]);
    },
  );

  test("changing captured evidence on an answered note is rejected without altering the file", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const original = note("a|n12|n12|#evidence");
    await session.save({ comments: [original] });
    await session.answer(
      session.file,
      original.id!,
      "I used the captured code.",
      "answered",
    );
    const before = await readFile(path.join(dir, session.file), "utf8");
    await expect(
      session.save({
        comments: [{ ...original, code: "+different evidence" }],
      }),
    ).rejects.toThrow();
    expect(await readFile(path.join(dir, session.file), "utf8")).toBe(before);
  });

  test("first-save legacy comments without ids are returned as changed and persisted independently", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const result = await session.save({
      comments: [
        { ...note("a|n12|n12|#a", "First observation."), id: undefined },
        { ...note("a|n12|n12|#b", "Second observation."), id: undefined },
      ],
    });
    expect(result.changed.map((entry) => entry.body)).toEqual([
      "First observation.",
      "Second observation.",
    ]);
    expect((await session.read()).notes.map((entry) => entry.body)).toEqual([
      "First observation.",
      "Second observation.",
    ]);
    expect(session.shownFile).toBe(result.file);
    expect(result.removed).toEqual([]);
    const added = await session.save({ comments: [note("b|n12|n12|#new")] });
    expect(added.changed.map((entry) => entry.id)).toEqual(["b|n12|n12|#new"]);
    expect((await session.read()).notes).toHaveLength(3);
  });

  test("named reads and answers target the requested note and do not substitute the first note", async () => {
    const dir = await workspace();
    const session = createSession(dir, ".", "HEAD");
    const a = note("a|n12|n12|#a"),
      b = note("b|n12|n12|#b");
    await session.save({ comments: [a, b] });
    const file = session.file;
    expect((await session.readNote(file, b.id!))!.body).toBe(b.body);
    expect(await session.readNote(file, "absent")).toBeNull();
    expect(await session.readNote("review-absent.md", a.id!)).toBeNull();
    expect(
      await session.answer(
        file,
        "absent",
        "Do not attach this to the first note.",
      ),
    ).toBeNull();
    const second = await session.answer(file, b.id!, "Only the second note.");
    expect(second!.id).toBe(b.id!);
    expect(second!.status).toBe("pending");
    expect((await session.readNote(file, a.id!))!.messages).toEqual([]);
    expect(
      (await session.readNote(file, b.id!))!.messages.map(
        (entry) => entry.body,
      ),
    ).toEqual(["Only the second note."]);
    await writeFile(
      path.join(dir, "private.md"),
      renderMarkdown({
        range: "HEAD",
        notes: [noteFromComment(a)],
      }),
    );
    expect(await session.readNote("private.md", a.id!)).toBeNull();
    expect(
      await session.answer("private.md", a.id!, "Not a generated review."),
    ).toBeNull();
    expect(
      parseReview(await readFile(path.join(dir, "private.md"), "utf8"))
        .notes[0]!.messages,
    ).toEqual([]);
  });
});
