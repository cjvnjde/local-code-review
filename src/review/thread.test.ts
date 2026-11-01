import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render.ts";
import { noteFromComment, parseReview, renderNote } from "./thread.ts";
import type { ReviewComment } from "../shared/review-types.ts";

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
    const doc = parseReview(
      write([
        {
          ...comment,
          id: "src/app.ts|n12|n12|6-14|#a1",
          label: "12:7-14",
          ca: 6,
          cb: 14,
          snippet: "tmpValue",
        },
      ]),
    );

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
    const doc = parseReview(
      write([
        {
          id: "src/app.ts|*|*|#a2",
          file: "src/app.ts",
          body: "Split this module.",
          scope: "file",
          start: 0,
          end: 0,
        },
      ]),
    );
    expect(doc.notes[0]).toMatchObject({
      scope: "file",
      file: "src/app.ts",
      label: "",
      body: "Split this module.",
    });
  });

  test("keeps an old-side note on the old side", () => {
    const doc = parseReview(
      write([
        {
          id: "src/app.ts|o4|o5|#a3",
          file: "src/app.ts",
          body: "Keep compatibility.",
          start: 4,
          end: 5,
          side: "old",
          code: "-oldCall()",
        },
      ]),
    );
    expect(doc.notes[0]).toMatchObject({
      side: "old",
      start: 4,
      end: 5,
      label: "4-5",
    });
  });

  test("reads a thread and the verdict above it", () => {
    const doc = parseReview(
      [
        write([comment]).replace(
          "Status: pending",
          "Status: applied — renamed to profile",
        ),
        "",
      ]
        .join("\n")
        .replace(
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
        ),
    );

    const note = doc.notes[0]!;
    expect(note.status).toBe("applied");
    expect(note.detail).toBe("renamed to profile");
    expect(note.messages).toEqual([
      {
        role: "agent",
        at: "2026-08-10T09:00:00.000Z",
        body: "Renamed it to `profile` and updated both call sites.",
      },
      {
        role: "reviewer",
        at: "2026-08-10T09:05:00.000Z",
        body: "Also rename the test fixture.",
      },
    ]);
  });

  test("a thread survives being written out and read back", () => {
    const first = parseReview(write([comment]));
    first.notes[0]!.messages.push({
      role: "agent",
      at: "2026-08-10T09:00:00.000Z",
      body: "Done.",
    });
    first.notes[0]!.messages.push({
      role: "reviewer",
      at: "",
      body: "Thanks — and the test?",
    });
    const second = parseReview(renderMarkdown(first));
    expect(second.notes[0]!.messages).toEqual(first.notes[0]!.messages);
    expect(second.notes[0]!.body).toBe("Rename this.");
    expect(second.notes[0]!.code).toBe("+  const tmpValue = load();");
  });

  test("keeps a reply an agent wrote without a speaker line", () => {
    const doc = parseReview(
      write([comment]).replace(
        "Status: pending",
        "Status: applied — renamed\n\nRenamed it everywhere.",
      ),
    );
    expect(doc.notes[0]!.status).toBe("applied");
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "", body: "Renamed it everywhere." },
    ]);
  });

  test("a suggestion block in the note stays in the note", () => {
    const doc = parseReview(
      write([
        {
          ...comment,
          body: "Use const:\n\n```suggestion\nconst tmpValue = load();\n```",
        },
      ]),
    );
    expect(doc.notes[0]!.body).toBe(
      "Use const:\n\n```suggestion\nconst tmpValue = load();\n```",
    );
    expect(doc.notes[0]!.code).toBe("+  const tmpValue = load();");
  });

  test("ignores structure inside captured code", () => {
    const doc = parseReview(
      write([
        {
          ...comment,
          file: "docs/guide.md",
          id: "docs/guide.md|n8|n8|#a4",
          start: 8,
          end: 8,
          label: "8",
          code: "+### Not a heading\n+Status: applied\n+**Agent** <!-- lcr:m -->",
          body: "Reword this.",
        },
      ]),
    );
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({
      status: "pending",
      body: "Reword this.",
      messages: [],
    });
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
    const first = parseReview(
      write([{ ...comment, body }]).replace(
        "Status: pending",
        "Status: applied — done",
      ),
    );
    expect(first.notes).toHaveLength(1);
    expect(first.notes[0]).toMatchObject({
      body,
      status: "applied",
      detail: "done",
      messages: [],
    });
    // The next save rewrites the file from the parsed doc; nothing may shift on the second pass.
    const second = parseReview(renderMarkdown(first));
    expect(second.notes[0]).toMatchObject({
      body,
      status: "applied",
      detail: "done",
      messages: [],
    });
  });

  test("an unclosed fence in one note cannot swallow the next", () => {
    const doc = parseReview(
      write([
        { ...comment, body: "fence:\n```\nnever closed" },
        {
          ...comment,
          id: "src/app.ts|n20|n20|#a9",
          start: 20,
          end: 20,
          label: "20",
          body: "second",
        },
      ]),
    );
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes[0]!.body).toBe("fence:\n```\nnever closed");
    expect(doc.notes[1]!.body).toBe("second");
  });

  // Nothing escapes what an agent appends, so its reply is read as prose and only lcr's own marked
  // lines bound a note. Overall notes feel this first: they invite the long structured answers.
  describe("a reply nobody escaped", () => {
    /** One agent reply written into the first note of a two-note review. */
    const answered = (reply: string) =>
      parseReview(
        write([
          {
            id: "|@|@|#g1",
            file: "",
            body: "How does this hang together?",
            scope: "global",
            start: 0,
            end: 0,
          },
          comment,
        ]).replace(
          "Status: pending",
          `Status: answered — below\n\n**Agent** <!-- lcr:m -->\n\n${reply}\n`,
        ),
      );

    test("a fence it left open cannot swallow the note after it", () => {
      // Quoting Markdown that itself holds a fence is what leaves one open: the inner opener is
      // content, the first plain run closes the outer block, and the last one opens a fence for good.
      const reply =
        'The README should read:\n\n```md\nUse it:\n```ts\nimport { add } from "./math.js";\n```\n```';
      const doc = answered(reply);
      expect(doc.notes.map((n) => n.id)).toEqual(["|@|@|#g1", comment.id]);
      expect(doc.notes[1]).toMatchObject({
        body: "Rename this.",
        status: "pending",
        messages: [],
      });
      // The reply keeps its own words. A file heading below it has no marker to be lifted out of the
      // open fence by, so it stays in the reply — the next save escapes it and the file settles.
      const [said, ...rest] = doc.notes[0]!.messages;
      expect(rest).toEqual([]);
      expect(said).toMatchObject({ role: "agent", at: "" });
      expect(said!.body).toStartWith(reply);
      expect(said!.body).not.toContain("Rename this.");
    });

    test("a heading it wrote stays in the reply", () => {
      const reply =
        "Split in two.\n\n### What I changed\n\n- `add` now guards\n- `sub` unchanged";
      const doc = answered(reply);
      expect(doc.notes.map((n) => n.id)).toEqual(["|@|@|#g1", comment.id]);
      expect(doc.notes[0]!.messages).toEqual([
        { role: "agent", at: "", body: reply },
      ]);
      // The next save escapes the heading, and the pass after that gives the same reply back.
      const again = parseReview(renderMarkdown(doc));
      expect(again.notes[0]!.messages).toEqual([
        { role: "agent", at: "", body: reply },
      ]);
      expect(again.notes.map((n) => n.id)).toEqual(["|@|@|#g1", comment.id]);
    });

    test("the reviewer's follow-up under it is still its own message", () => {
      const doc = answered(
        "```\nnever closed\n\n**Reviewer** <!-- lcr:m -->\n\nThen check the exports.",
      );
      expect(doc.notes[0]!.messages.map((m) => m.role)).toEqual([
        "agent",
        "reviewer",
      ]);
      expect(doc.notes[0]!.messages[1]!.body).toBe("Then check the exports.");
    });

    test("a note heading that lost its marker still starts a note under one", () => {
      // Read by its heading, the way a hand-edited file is, with a thread standing above it.
      const doc = parseReview(
        write([
          {
            id: "|@|@|#g1",
            file: "",
            body: "How does this hang together?",
            scope: "global",
            start: 0,
            end: 0,
          },
          comment,
        ])
          .replace(
            "Status: pending",
            "Status: answered — below\n\n**Agent** <!-- lcr:m -->\n\nDone.\n",
          )
          .replace(` <!-- lcr:${comment.id} -->`, ""),
      );
      expect(doc.notes.map((n) => n.key)).toEqual([
        "Overall note",
        "src/app.ts:12",
      ]);
      expect(doc.notes[1]).toMatchObject({
        file: "src/app.ts",
        label: "12",
        body: "Rename this.",
      });
    });

    test("the working agreement is not read into it", () => {
      const doc = answered("```\nnever closed");
      expect(doc.notes).toHaveLength(2);
      expect(doc.notes[0]!.messages[0]!.body).not.toContain(
        "How to work through this file",
      );
      expect(doc.notes[1]!.messages).toEqual([]);
    });
  });

  test("a body line that looks like the end marker stays prose", () => {
    const doc = parseReview(
      write([
        { ...comment, body: "<!-- lcr:end -->\nis what closes it." },
        {
          ...comment,
          id: "src/app.ts|n20|n20|#a10",
          start: 20,
          end: 20,
          label: "20",
          body: "second",
        },
      ]),
    );
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
    const doc = parseReview(
      write([
        { id: "|@|@|#g1", file: "", body, scope: "global", start: 0, end: 0 },
        comment,
      ]),
    );
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes[0]).toMatchObject({
      id: "|@|@|#g1",
      scope: "global",
      key: "Overall note",
      file: "",
      body,
    });
    expect(doc.notes[1]!.id).toBe(comment.id);
  });

  test("an overall note round-trips with its thread and its verdict", () => {
    const text = write([
      {
        id: "|@|@|#g1",
        file: "",
        body: "Split this branch up.",
        scope: "global",
        start: 0,
        end: 0,
      },
    ]).replace(
      "Status: pending",
      "Status: skipped — one branch is the ask\n\n**Agent** <!-- lcr:m -->\n\nKeeping it.\n",
    );
    const note = parseReview(text).notes[0]!;
    expect(note).toMatchObject({
      scope: "global",
      status: "skipped",
      detail: "one branch is the ask",
      label: "",
    });
    expect(note.messages).toEqual([
      { role: "agent", at: "", body: "Keeping it." },
    ]);
  });

  test("prose an older lcr wrote under `## Overall` comes back as the first overall note", () => {
    const doc = parseReview(
      [
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
      ].join("\n"),
    );
    expect(doc.notes.map((n) => n.id)).toEqual([
      "|@|@|#legacy",
      "src/app.ts|n12|n12|#old",
    ]);
    expect(doc.notes[0]).toMatchObject({
      scope: "global",
      body: "Watch the call sites.",
      status: "pending",
    });
    // Reading what that produced does not produce it again.
    expect(
      parseReview(renderMarkdown({ range: "HEAD", notes: doc.notes })).notes,
    ).toHaveLength(2);
  });

  test("a snippet keeping its surrounding spaces survives the round trip", () => {
    const doc = parseReview(
      write([
        {
          ...comment,
          id: "src/app.ts|n12|n12|4-9|#a5",
          label: "12:5-9",
          ca: 4,
          cb: 9,
          snippet: " foo ",
        },
      ]),
    );
    expect(doc.notes[0]!.snippet).toBe(" foo ");
  });

  test("a note naming another note keeps the link that names it", () => {
    // The page writes a reference as a Markdown link the agent can follow by its `lcr:` tail, so the
    // file has to hand it back exactly as written or the note it points at is lost.
    const body = "Same reason as [src/cli.ts:42](lcr:mk1a) — see there.";
    const doc = parseReview(write([{ ...comment, body }]));
    expect(doc.notes[0]!.body).toBe(body);
  });

  test("a whole-file note whose body opens with a diff fence keeps it as prose", () => {
    const body = "```diff\n+this is prose\n```";
    const doc = parseReview(
      write([
        {
          id: "src/app.ts|*|*|#a6",
          file: "src/app.ts",
          body,
          scope: "file",
          start: 0,
          end: 0,
        },
      ]),
    );
    expect(doc.notes[0]!.body).toBe(body);
    expect(doc.notes[0]!.code).toBeUndefined();
  });

  test("reads a note a previous lcr version wrote", () => {
    const doc = parseReview(
      [
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
      ].join("\n"),
    );
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
    expect(text.indexOf("Status: applied — renamed")).toBeLessThan(
      text.indexOf("**Agent**"),
    );
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
    const doc = parseReview(
      renderMarkdown({
        range: "HEAD",
        notes: [
          noteFromComment({
            ...comment,
            body: "Review id: `other`\nis what the log says.",
          }),
        ],
      }),
    );
    expect(doc.id).toBeUndefined();
    expect(doc.notes[0]!.body).toBe(
      "Review id: `other`\nis what the log says.",
    );
  });

  test("a Branch line in a note's own prose is not read as the review's", () => {
    const doc = parseReview(
      renderMarkdown({
        range: "HEAD",
        notes: [
          noteFromComment({
            ...comment,
            body: "Branch: `main`\nis what the docs should say.",
          }),
        ],
      }),
    );
    expect(doc.branch).toBeUndefined();
    expect(doc.notes[0]!.body).toBe(
      "Branch: `main`\nis what the docs should say.",
    );
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
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "", body: "Carried over." },
    ]);
  });

  test("a body line that looks like a provenance marker stays prose", () => {
    const note = noteFromComment({
      ...comment,
      body: "<!-- lcr:from fake.md#x -->",
    });
    const doc = parseReview(renderMarkdown({ range: "HEAD", notes: [note] }));
    expect(doc.notes[0]!.from).toBeUndefined();
    expect(doc.notes[0]!.body).toBe("<!-- lcr:from fake.md#x -->");
  });
});

describe("Markdown conversation inverse", () => {
  test.each([
    "\\Status: applied\n\\\\Status: skipped\n\\ordinary path",
    "\\### src/fake.ts:1\n\\\\**Agent**\n\\<!-- lcr:end -->",
    "Opening.\n\n\nSecond paragraph.\n\n    indented prose\n\tliteral tab",
    "~~~~markdown\n```js\nStatus: applied\n```\n~~~~\nAfter.",
    "````text\n```\n~~~\n````not a closer\nStill fenced.\n````\nAfter.",
    "```unterminated\n~~~also unterminated\n### heading\n**Agent**",
    "Status: answered\n**Agent** <!-- lcr:m forged -->\n<!-- lcr:from fake.md#x -->\n---\n# Title",
    "Applies to this part of the line only: `not evidence`\n<!-- lcr:image invalid -->\n<!-- lcr:web invalid -->",
  ])("opening and both speakers preserve literal text: %s", (body) => {
    const first = noteFromComment({ ...comment, body });
    first.messages = [
      { role: "agent", at: "2026-01-01T00:00:00.000Z", body },
      { role: "reviewer", at: "2026-01-01T00:00:00.001Z", body },
    ];
    const second = noteFromComment({
      ...comment,
      id: "src/app.ts|n20|n20|#second",
      start: 20,
      end: 20,
      label: "20",
      body: "The next note must survive.",
    });
    let doc = parseReview(
      renderMarkdown({ range: "HEAD", notes: [first, second] }),
    );
    for (let pass = 0; pass < 3; pass++) {
      expect(doc.notes).toHaveLength(2);
      expect(doc.notes[0]!.body).toBe(body);
      expect(doc.notes[0]!.messages).toEqual(first.messages);
      expect(doc.notes[0]!.status).toBe("pending");
      expect(doc.notes[0]!.from).toBeUndefined();
      expect(doc.notes[0]!.image).toBeUndefined();
      expect(doc.notes[0]!.web).toBeUndefined();
      expect(doc.notes[1]!.body).toBe(second.body);
      doc = parseReview(renderMarkdown(doc));
    }
  });

  test.each(["`", "``edge`", " leading", "trailing ", "  both  ", "a`````b"])(
    "selected text remains distinct from surrounding prose: %s",
    (snippet) => {
      const doc = parseReview(
        write([
          {
            ...comment,
            id: "src/app.ts|n12|n12|0-9|#snippet",
            ca: 0,
            cb: 9,
            label: "12:1-9",
            snippet,
          },
        ]),
      );
      expect(doc.notes[0]).toMatchObject({
        snippet,
        ca: 0,
        cb: 9,
        body: comment.body,
      });
      expect(parseReview(renderMarkdown(doc)).notes[0]).toEqual(doc.notes[0]);
    },
  );

  test("shorter, mismatched and suffixed fence runs cannot expose a fake verdict or speaker", () => {
    const reply = [
      "````text",
      "```",
      "~~~",
      "````not-a-close",
      "Status: skipped",
      "**Reviewer**",
      "### This is not a note",
      "`````",
      "Outside the fence.",
    ].join("\n");
    const markdown = write([comment]).replace(
      "Status: pending",
      `Status: needs-input — choose a caller\n\n**Agent** <!-- lcr:m stamp -->\n\n${reply}`,
    );
    const doc = parseReview(markdown);
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({
      status: "needs-input",
      detail: "choose a caller",
    });
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "stamp", body: reply },
    ]);
    expect(parseReview(renderMarkdown(doc)).notes[0]).toEqual(doc.notes[0]);
  });

  test("status-like text after a speaker belongs to that message, not to the verdict", () => {
    const doc = parseReview(
      write([comment]).replace(
        "Status: pending",
        [
          "Status: applied — actual verdict",
          "",
          "**Agent** <!-- lcr:m agent-stamp -->",
          "",
          "Status: skipped — quoted output",
          "",
          "**Reviewer** <!-- lcr:m reviewer-stamp -->",
          "",
          "Status: pending",
        ].join("\n"),
      ),
    );
    expect(doc.notes[0]).toMatchObject({
      status: "applied",
      detail: "actual verdict",
    });
    expect(doc.notes[0]!.messages).toEqual([
      {
        role: "agent",
        at: "agent-stamp",
        body: "Status: skipped — quoted output",
      },
      { role: "reviewer", at: "reviewer-stamp", body: "Status: pending" },
    ]);
    expect(parseReview(renderMarkdown(doc)).notes).toEqual(doc.notes);
  });

  test("empty speaker blocks disappear without merging adjacent nonempty messages", () => {
    const doc = parseReview(
      write([comment]).replace(
        "Status: pending",
        [
          "Status: pending",
          "",
          "**Agent** <!-- lcr:m empty -->",
          "",
          "**Reviewer** <!-- lcr:m first -->",
          "",
          "First request.",
          "",
          "**Reviewer** <!-- lcr:m second -->",
          "",
          "Second request.",
        ].join("\n"),
      ),
    );
    expect(doc.notes[0]!.messages).toEqual([
      { role: "reviewer", at: "first", body: "First request." },
      { role: "reviewer", at: "second", body: "Second request." },
    ]);
    expect(parseReview(renderMarkdown(doc)).notes).toEqual(doc.notes);
  });

  test("an old-side legacy heading with colon-containing paths retains line and column ranges", () => {
    const doc = parseReview(
      [
        "# Review notes",
        "### fixtures/http:server.ts:12-14:2-8 (line numbers before the change)",
        "",
        "Keep this old-side selection.",
        "",
        "Status: answered — intentional",
      ].join("\n"),
    );
    expect(doc.notes[0]).toMatchObject({
      id: "",
      key: "fixtures/http:server.ts:12-14:2-8",
      file: "fixtures/http:server.ts",
      label: "12-14:2-8",
      start: 12,
      end: 14,
      ca: 1,
      cb: 8,
      side: "old",
      status: "answered",
      detail: "intentional",
    });
    expect(parseReview(renderMarkdown(doc)).notes).toEqual(doc.notes);
  });

  test("an id takes its anchor from the marker even when a hand-edited heading disagrees", () => {
    const doc = parseReview(
      [
        "### wrong.ts:99 <!-- lcr:actual.ts|o2|o4|0-3|#stable -->",
        "",
        "Original selection.",
        "",
        "Status: pending",
      ].join("\n"),
    );
    expect(doc.notes[0]).toMatchObject({
      id: "actual.ts|o2|o4|0-3|#stable",
      file: "actual.ts",
      start: 2,
      end: 4,
      ca: 0,
      cb: 3,
      side: "old",
      body: "Original selection.",
    });
  });
});

describe("hand-edited Markdown boundaries", () => {
  test("only complete preamble fields identify a conversation; quoted or suffixed fields are prose", () => {
    const doc = parseReview(
      [
        "# Review notes",
        "Diff under review:   `main..HEAD`   ",
        "Review id:`checkout`",
        "Branch:   `feature`   ",
        "Base:`abc123`",
        "Quoted Diff under review: `wrong`",
        "Quoted Review id: `wrong`",
        "Quoted Branch: `wrong`",
        "Quoted Base: `wrong`",
        "Diff under review: `wrong` trailing explanation",
        "Review id: `wrong` trailing explanation",
        "Branch: `wrong` trailing explanation",
        "Base: `wrong` trailing explanation",
      ].join("\n"),
    );
    expect(doc).toEqual({
      range: "main..HEAD",
      id: "checkout",
      branch: "feature",
      base: "abc123",
      notes: [],
    });
  });

  test.each([
    ["### src/new.ts (whole file)", "file", "src/new.ts"],
    ["### Overall note", "global", ""],
  ])(
    "an unmarked %s after a thread starts its own note",
    (heading, scope, file) => {
      const doc = parseReview(
        [
          "### src/app.ts:12 <!-- lcr:src/app.ts|n12|n12|#first -->",
          "",
          "Opening question.",
          "",
          "Status: answered",
          "",
          "**Agent** <!-- lcr:m stamp -->",
          "",
          "First answer.",
          "",
          heading,
          "",
          "Independent request.",
          "",
          "Status: needs-input — choose",
        ].join("\n"),
      );
      expect(doc.notes).toHaveLength(2);
      expect(doc.notes[0]!.messages).toEqual([
        { role: "agent", at: "stamp", body: "First answer." },
      ]);
      expect(doc.notes[1]).toMatchObject({
        id: "",
        scope,
        file,
        body: "Independent request.",
        status: "needs-input",
        detail: "choose",
      });
    },
  );

  test("unclosed captured code remains evidence and cannot consume the next marked note", () => {
    const doc = parseReview(
      [
        "### a.ts:12 <!-- lcr:a.ts|n12|n12|#first -->",
        "",
        "```diff",
        "+const value = 1;",
        "+Status: skipped",
        "### b.ts:20 <!-- lcr:b.ts|n20|n20|#second -->",
        "",
        "Second request.",
        "",
        "Status: pending",
      ].join("\n"),
    );
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes[0]).toMatchObject({
      code: "+const value = 1;\n+Status: skipped",
      body: "",
      status: "pending",
    });
    expect(doc.notes[1]).toMatchObject({
      id: "b.ts|n20|n20|#second",
      body: "Second request.",
    });
    expect(parseReview(renderMarkdown(doc)).notes).toEqual(doc.notes);
  });

  test.each([
    ["prefix `code`", "prefix `code`"],
    ["`code` suffix", "`code` suffix"],
    ["` leading`", " leading"],
    ["`trailing `", "trailing "],
    ["literal fragment", "literal fragment"],
  ])(
    "a hand-edited snippet retains its entire selected text: %s",
    (raw, snippet) => {
      const doc = parseReview(
        [
          "### a.ts:12 <!-- lcr:a.ts|n12|n12|#snippet -->",
          "",
          `Applies to this part of the line only:  ${raw}`,
          "",
          "Explain this expression.",
          "",
          "Status: pending",
        ].join("\n"),
      );
      expect(doc.notes[0]).toMatchObject({
        snippet,
        body: "Explain this expression.",
      });
      expect(parseReview(renderMarkdown(doc)).notes).toEqual(doc.notes);
    },
  );

  test("a heading with an empty marker is ignored instead of producing an unaddressable status", () => {
    const doc = parseReview(
      [
        "### <!-- lcr:   -->",
        "Status: applied",
        "",
        "### a.ts:12 <!--lcr:a.ts|n12|n12|#real-->",
        "",
        "Real request.",
        "",
        "Status:pending",
        "",
        "**aGeNt**",
        "",
        "Unstamped answer.",
        "",
        "**rEvIeWeR** <!--lcr:m   reviewer-stamp-->",
        "",
        "Follow-up.",
      ].join("\n"),
    );
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({
      id: "a.ts|n12|n12|#real",
      status: "pending",
      body: "Real request.",
    });
    expect(doc.notes[0]!.messages).toEqual([
      { role: "agent", at: "", body: "Unstamped answer." },
      { role: "reviewer", at: "reviewer-stamp", body: "Follow-up." },
    ]);
  });
});
