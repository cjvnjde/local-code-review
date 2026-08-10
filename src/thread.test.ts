import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./review.ts";
import { noteFromComment, parseReview, renderNote } from "./thread.ts";
import type { ReviewComment } from "./types.ts";

const write = (comments: ReviewComment[], general = "") =>
  renderMarkdown({ range: "HEAD", general, notes: comments.map(noteFromComment) });

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
    }], "Watch the call sites."));

    expect(doc.range).toBe("HEAD");
    expect(doc.general).toBe("Watch the call sites.");
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

  test("a balanced fence in the body keeps its content unescaped on disk", () => {
    const body = "look:\n```\n### fenced heading\n```";
    const text = write([{ ...comment, body }]);
    expect(text).toContain("### fenced heading");
    expect(text).not.toContain("\\### fenced heading");
    expect(parseReview(text).notes[0]!.body).toBe(body);
  });

  test("structure lines in the overall note stay in the overall note", () => {
    const general = "Fine overall.\n### src/app.ts:1\n---\ndone";
    const doc = parseReview(write([comment], general));
    expect(doc.general).toBe(general);
    expect(doc.notes).toHaveLength(1);
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
