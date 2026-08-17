import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./review.ts";
import { noteFromComment, parseReview, renderNote } from "./thread.ts";
import type { ReviewComment } from "./types.ts";

const write = (comments: ReviewComment[]) =>
  renderMarkdown({ range: "HEAD", notes: comments.map(noteFromComment) });

const comment: ReviewComment = {
  id: "src/app.ts|n12|n12|#a1",
  file: "src/app.ts",
  body: "Rename this.",
  start: 12,
  end: 12,
  label: "12",
  side: "new",
  code: "+  const tmpValue = load();",
};

describe("parseReview", () => {
  test("reads a note back with everything the page put into it", () => {
    const doc = parseReview(write([{
      ...comment,
      id: "src/app.ts|n12|n12|6-14|#a1",
      label: "12:7-14",
      ca: 6,
      cb: 14,
      snippet: "tmpValue",
    }]));

    expect(doc.range).toBe("HEAD");
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({
      id: "src/app.ts|n12|n12|6-14|#a1",
      key: "src/app.ts:12:7-14",
      file: "src/app.ts",
      label: "12:7-14",
      start: 12,
      end: 12,
      ca: 6,
      cb: 14,
      snippet: "tmpValue",
      code: "+  const tmpValue = load();",
      body: "Rename this.",
      status: "pending",
      messages: [],
    });
  });

  test("round-trips a whole-file note", () => {
    const doc = parseReview(write([{
      id: "src/app.ts|*|*|#a2",
      file: "src/app.ts",
      body: "Split this module.",
      scope: "file",
      start: 0,
      end: 0,
    }]));
    expect(doc.notes[0]).toMatchObject({ scope: "file", file: "src/app.ts", label: "", body: "Split this module." });
  });

  test("keeps an old-side note on the old side", () => {
    const doc = parseReview(write([{
      id: "src/app.ts|o4|o5|#a3",
      file: "src/app.ts",
      body: "Keep compatibility.",
      start: 4,
      end: 5,
      side: "old",
      code: "-oldCall()",
    }]));
    expect(doc.notes[0]).toMatchObject({ side: "old", start: 4, end: 5, label: "4-5" });
  });

  test("reads a thread and the verdict above it", () => {
    const doc = parseReview([
      write([comment]).replace("Status: pending", "Status: applied — renamed to profile"),
      "",
    ].join("\n").replace(
      "Status: applied — renamed to profile\n",
      [
        "Status: applied — renamed to profile",
        "",
        "**Agent** <!-- lcr:m 2026-08-10T09:00:00.000Z -->",
        "",
        "Renamed it to `profile` and updated both call sites.",
        "",
        "**Reviewer** <!-- lcr:m 2026-08-10T09:05:00.000Z -->",
        "",
        "Also rename the test fixture.",
        "",
      ].join("\n"),
    ));

    const note = doc.notes[0]!;
    expect(note.status).toBe("applied");
    expect(note.detail).toBe("renamed to profile");
    expect(note.messages).toEqual([
      {
        role: "agent",
        at: "2026-08-10T09:00:00.000Z",
        body: "Renamed it to `profile` and updated both call sites.",
      },
      { role: "reviewer", at: "2026-08-10T09:05:00.000Z", body: "Also rename the test fixture." },
    ]);
  });

  test("a thread survives being written out and read back", () => {
    const first = parseReview(write([comment]));
    first.notes[0]!.messages.push({ role: "agent", at: "2026-08-10T09:00:00.000Z", body: "Done." });
    first.notes[0]!.messages.push({ role: "reviewer", at: "", body: "Thanks — and the test?" });
    const second = parseReview(renderMarkdown(first));
    expect(second.notes[0]!.messages).toEqual(first.notes[0]!.messages);
    expect(second.notes[0]!.body).toBe("Rename this.");
    expect(second.notes[0]!.code).toBe("+  const tmpValue = load();");
  });

  test("keeps a reply an agent wrote without a speaker line", () => {
    const doc = parseReview(
      write([comment]).replace("Status: pending", "Status: applied — renamed\n\nRenamed it everywhere."),
    );
    expect(doc.notes[0]!.status).toBe("applied");
    expect(doc.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: "Renamed it everywhere." }]);
  });

  test("a suggestion block in the note stays in the note", () => {
    const doc = parseReview(write([{
      ...comment,
      body: "Use const:\n\n```suggestion\nconst tmpValue = load();\n```",
    }]));
    expect(doc.notes[0]!.body).toBe("Use const:\n\n```suggestion\nconst tmpValue = load();\n```");
    expect(doc.notes[0]!.code).toBe("+  const tmpValue = load();");
  });

  test("ignores structure inside captured code", () => {
    const doc = parseReview(write([{
      ...comment,
      file: "docs/guide.md",
      id: "docs/guide.md|n8|n8|#a4",
      start: 8,
      end: 8,
      label: "8",
      code: "+### Not a heading\n+Status: applied\n+**Agent** <!-- lcr:m -->",
      body: "Reword this.",
    }]));
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({ status: "pending", body: "Reword this.", messages: [] });
  });

  test("the working agreement at the end is not read as a note", () => {
    const doc = parseReview(write([comment]));
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]!.messages).toEqual([]);
  });

  test("a body speaking the file's own structure round-trips without breaking the section", () => {
    const body = [
      "Part one.",
      "---",
      "### not a new note",
      "Status: not a verdict",
      "**Agent**",
      "Part two.",
    ].join("\n");
    const first = parseReview(write([{ ...comment, body }]).replace("Status: pending", "Status: applied — done"));
    expect(first.notes).toHaveLength(1);
    expect(first.notes[0]).toMatchObject({ body, status: "applied", detail: "done", messages: [] });
    // The next save rewrites the file from the parsed doc; nothing may shift on the second pass.
    const second = parseReview(renderMarkdown(first));
    expect(second.notes[0]).toMatchObject({ body, status: "applied", detail: "done", messages: [] });
  });

  test("an unclosed fence in one note cannot swallow the next", () => {
    const doc = parseReview(write([
      { ...comment, body: "fence:\n```\nnever closed" },
      { ...comment, id: "src/app.ts|n20|n20|#a9", start: 20, end: 20, label: "20", body: "second" },
    ]));
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes[0]!.body).toBe("fence:\n```\nnever closed");
    expect(doc.notes[1]!.body).toBe("second");
  });

  // Nothing escapes what an agent appends, so its reply is read as prose and only lcr's own marked
  // lines bound a note. Overall notes feel this first: they invite the long structured answers.
  describe("a reply nobody escaped", () => {
    /** One agent reply written into the first note of a two-note review. */
    const answered = (reply: string) =>
      parseReview(write([
        { id: "|@|@|#g1", file: "", body: "How does this hang together?", scope: "global", start: 0, end: 0 },
        comment,
      ]).replace("Status: pending", `Status: answered — below\n\n**Agent** <!-- lcr:m -->\n\n${reply}\n`));

    test("a fence it left open cannot swallow the note after it", () => {
      // Quoting Markdown that itself holds a fence is what leaves one open: the inner opener is
      // content, the first plain run closes the outer block, and the last one opens a fence for good.
      const reply = "The README should read:\n\n```md\nUse it:\n```ts\nimport { add } from \"./math.js\";\n```\n```";
      const doc = answered(reply);
      expect(doc.notes.map((n) => n.id)).toEqual(["|@|@|#g1", comment.id]);
      expect(doc.notes[1]).toMatchObject({ body: "Rename this.", status: "pending", messages: [] });
      // The reply keeps its own words. A file heading below it has no marker to be lifted out of the
      // open fence by, so it stays in the reply — the next save escapes it and the file settles.
      const [said, ...rest] = doc.notes[0]!.messages;
      expect(rest).toEqual([]);
      expect(said).toMatchObject({ role: "agent", at: "" });
      expect(said!.body).toStartWith(reply);
      expect(said!.body).not.toContain("Rename this.");
    });

    test("a heading it wrote stays in the reply", () => {
      const reply = "Split in two.\n\n### What I changed\n\n- `add` now guards\n- `sub` unchanged";
      const doc = answered(reply);
      expect(doc.notes.map((n) => n.id)).toEqual(["|@|@|#g1", comment.id]);
      expect(doc.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: reply }]);
      // The next save escapes the heading, and the pass after that gives the same reply back.
      const again = parseReview(renderMarkdown(doc));
      expect(again.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: reply }]);
      expect(again.notes.map((n) => n.id)).toEqual(["|@|@|#g1", comment.id]);
    });

    test("the reviewer's follow-up under it is still its own message", () => {
      const doc = answered("```\nnever closed\n\n**Reviewer** <!-- lcr:m -->\n\nThen check the exports.");
      expect(doc.notes[0]!.messages.map((m) => m.role)).toEqual(["agent", "reviewer"]);
      expect(doc.notes[0]!.messages[1]!.body).toBe("Then check the exports.");
    });

    test("a note heading that lost its marker still starts a note under one", () => {
      // Read by its heading, the way a hand-edited file is, with a thread standing above it.
      const doc = parseReview(
        write([
          { id: "|@|@|#g1", file: "", body: "How does this hang together?", scope: "global", start: 0, end: 0 },
          comment,
        ])
          .replace("Status: pending", "Status: answered — below\n\n**Agent** <!-- lcr:m -->\n\nDone.\n")
          .replace(` <!-- lcr:${comment.id} -->`, ""),
      );
      expect(doc.notes.map((n) => n.key)).toEqual(["Overall note", "src/app.ts:12"]);
      expect(doc.notes[1]).toMatchObject({ file: "src/app.ts", label: "12", body: "Rename this." });
    });

    test("the working agreement is not read into it", () => {
      const doc = answered("```\nnever closed");
      expect(doc.notes).toHaveLength(2);
      expect(doc.notes[0]!.messages[0]!.body).not.toContain("How to work through this file");
      expect(doc.notes[1]!.messages).toEqual([]);
    });
  });

  test("a body line that looks like the end marker stays prose", () => {
    const doc = parseReview(write([{ ...comment, body: "<!-- lcr:end -->\nis what closes it." }, {
      ...comment,
      id: "src/app.ts|n20|n20|#a10",
      start: 20,
      end: 20,
      label: "20",
      body: "second",
    }]));
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes[0]!.body).toBe("<!-- lcr:end -->\nis what closes it.");
  });

  test("a balanced fence in the body keeps its content unescaped on disk", () => {
    const body = "look:\n```\n### fenced heading\n```";
    const text = write([{ ...comment, body }]);
    expect(text).toContain("### fenced heading");
    expect(text).not.toContain("\\### fenced heading");
    expect(parseReview(text).notes[0]!.body).toBe(body);
  });

  test("structure lines in an overall note stay in that note", () => {
    const body = "Fine overall.\n### src/app.ts:1\n---\ndone";
    const doc = parseReview(write([{ id: "|@|@|#g1", file: "", body, scope: "global", start: 0, end: 0 }, comment]));
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes[0]).toMatchObject({ id: "|@|@|#g1", scope: "global", key: "Overall note", file: "", body });
    expect(doc.notes[1]!.id).toBe(comment.id);
  });

  test("an overall note round-trips with its thread and its verdict", () => {
    const text = write([{ id: "|@|@|#g1", file: "", body: "Split this branch up.", scope: "global", start: 0, end: 0 }])
      .replace("Status: pending", "Status: skipped — one branch is the ask\n\n**Agent** <!-- lcr:m -->\n\nKeeping it.\n");
    const note = parseReview(text).notes[0]!;
    expect(note).toMatchObject({ scope: "global", status: "skipped", detail: "one branch is the ask", label: "" });
    expect(note.messages).toEqual([{ role: "agent", at: "", body: "Keeping it." }]);
  });

  test("prose an older lcr wrote under `## Overall` comes back as the first overall note", () => {
    const doc = parseReview([
      "# Review notes",
      "",
      "Diff under review: `HEAD`",
      "",
      "## Overall",
      "",
      "Watch the call sites.",
      "",
      "## src/app.ts",
      "",
      "### src/app.ts:12 <!-- lcr:src/app.ts|n12|n12|#old -->",
      "",
      "Rename this.",
      "",
      "Status: pending",
      "",
    ].join("\n"));
    expect(doc.notes.map((n) => n.id)).toEqual(["|@|@|#legacy", "src/app.ts|n12|n12|#old"]);
    expect(doc.notes[0]).toMatchObject({ scope: "global", body: "Watch the call sites.", status: "pending" });
    // Reading what that produced does not produce it again.
    expect(parseReview(renderMarkdown({ range: "HEAD", notes: doc.notes })).notes).toHaveLength(2);
  });

  test("a snippet keeping its surrounding spaces survives the round trip", () => {
    const doc = parseReview(write([{
      ...comment,
      id: "src/app.ts|n12|n12|4-9|#a5",
      label: "12:5-9",
      ca: 4,
      cb: 9,
      snippet: " foo ",
    }]));
    expect(doc.notes[0]!.snippet).toBe(" foo ");
  });

  test("a whole-file note whose body opens with a diff fence keeps it as prose", () => {
    const body = "```diff\n+this is prose\n```";
    const doc = parseReview(write([{
      id: "src/app.ts|*|*|#a6",
      file: "src/app.ts",
      body,
      scope: "file",
      start: 0,
      end: 0,
    }]));
    expect(doc.notes[0]!.body).toBe(body);
    expect(doc.notes[0]!.code).toBeUndefined();
  });

  test("reads a note a previous lcr version wrote", () => {
    const doc = parseReview([
      "# Review notes",
      "",
      "Diff under review: `HEAD`",
      "Written: 2026-01-01T00:00:00.000Z",
      "",
      "## src/app.ts",
      "",
      "### src/app.ts:12 <!-- lcr:src/app.ts|n12|n12|#old -->",
      "",
      "```diff",
      "+  const tmpValue = load();",
      "```",
      "",
      "Rename this.",
      "",
      "Status: pending",
      "",
    ].join("\n"));
    expect(doc.notes[0]).toMatchObject({
      file: "src/app.ts",
      label: "12",
      body: "Rename this.",
      code: "+  const tmpValue = load();",
      messages: [],
    });
  });
});

describe("renderNote", () => {
  test("writes the verdict above the thread so a reply is always an append", () => {
    const note = noteFromComment(comment);
    note.status = "applied";
    note.detail = "renamed";
    note.messages = [{ role: "agent", at: "", body: "Done." }];
    const text = renderNote(note).join("\n");
    expect(text.indexOf("Status: applied — renamed")).toBeLessThan(text.indexOf("**Agent**"));
  });
});

describe("review context", () => {
  test("branch and base survive the round trip", () => {
    const markdown = renderMarkdown({
      range: "main..HEAD",
      branch: "feature-x",
      base: "abc123def456",
      notes: [noteFromComment(comment)],
    });
    expect(markdown).toContain("Branch: `feature-x`");
    expect(markdown).toContain("Base: `abc123def456`");

    const doc = parseReview(markdown);
    expect(doc.range).toBe("main..HEAD");
    expect(doc.branch).toBe("feature-x");
    expect(doc.base).toBe("abc123def456");
  });

  test("a file from before these fields parses with neither", () => {
    const doc = parseReview(renderMarkdown({ range: "HEAD", notes: [] }));
    expect(doc.id).toBeUndefined();
    expect(doc.branch).toBeUndefined();
    expect(doc.base).toBeUndefined();
  });

  test("the name a review was opened under survives the round trip", () => {
    const markdown = renderMarkdown({
      range: "HEAD",
      id: "auth rework",
      branch: "feature-x",
      notes: [noteFromComment(comment)],
    });
    expect(markdown).toContain("Review id: `auth rework`");
    expect(parseReview(markdown).id).toBe("auth rework");
  });

  test("a Review id line in a note's own prose is not read as the review's", () => {
    const doc = parseReview(renderMarkdown({
      range: "HEAD",
      notes: [noteFromComment({ ...comment, body: "Review id: `other`\nis what the log says." })],
    }));
    expect(doc.id).toBeUndefined();
    expect(doc.notes[0]!.body).toBe("Review id: `other`\nis what the log says.");
  });

  test("a Branch line in a note's own prose is not read as the review's", () => {
    const doc = parseReview(renderMarkdown({
      range: "HEAD",
      notes: [noteFromComment({ ...comment, body: "Branch: `main`\nis what the docs should say." })],
    }));
    expect(doc.branch).toBeUndefined();
    expect(doc.notes[0]!.body).toBe("Branch: `main`\nis what the docs should say.");
  });
});

describe("continued notes", () => {
  test("the provenance marker survives the round trip", () => {
    const note = noteFromComment(comment);
    note.from = "review-2026-01-01T00-00-00.md#src/app.ts|n8|n8|#z1";
    note.messages = [{ role: "agent", at: "", body: "Carried over." }];

    const doc = parseReview(renderMarkdown({ range: "HEAD", notes: [note] }));
    expect(doc.notes[0]).toMatchObject({
      from: "review-2026-01-01T00-00-00.md#src/app.ts|n8|n8|#z1",
      body: "Rename this.",
    });
    expect(doc.notes[0]!.messages).toEqual([{ role: "agent", at: "", body: "Carried over." }]);
  });

  test("a body line that looks like a provenance marker stays prose", () => {
    const note = noteFromComment({ ...comment, body: "<!-- lcr:from fake.md#x -->" });
    const doc = parseReview(renderMarkdown({ range: "HEAD", notes: [note] }));
    expect(doc.notes[0]!.from).toBeUndefined();
    expect(doc.notes[0]!.body).toBe("<!-- lcr:from fake.md#x -->");
  });
});
