import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./review.ts";
import { noteFromComment } from "./thread.ts";
import { collectStatuses, parseStatuses } from "./status.ts";
import type { ReviewComment } from "./types.ts";
import { mintNoteId, noteKey } from "./web/client/state.ts";

const review = (...sections: string[]) => ["# Review notes", "", ...sections].join("\n");
const write = (comments: ReviewComment[]) =>
  renderMarkdown({ range: "HEAD", notes: comments.map(noteFromComment) });

describe("parseStatuses", () => {
  test("reads the id marker, verdict, and detail of each note", () => {
    const parsed = parseStatuses(review(
      "### src/app.ts:2:9-16 <!-- lcr:src/app.ts|n2|n2|8-16 -->",
      "",
      "Rename this.",
      "",
      "Status: applied — renamed to profile",
      "",
      "### src/app.ts:9 <!-- lcr:src/app.ts|n9|n9 -->",
      "",
      "Status: skipped — the helper is already memoised",
      "",
      "### src/other.ts:4 (line numbers before the change)",
      "",
      "Status: needs-input: which callers still use it?",
      "",
    ), "review-1.md");

    expect(parsed).toEqual([
      {
        id: "src/app.ts|n2|n2|8-16",
        key: "src/app.ts:2:9-16",
        status: "applied",
        detail: "renamed to profile",
        source: "review-1.md",
      },
      {
        id: "src/app.ts|n9|n9",
        key: "src/app.ts:9",
        status: "skipped",
        detail: "the helper is already memoised",
        source: "review-1.md",
      },
      {
        id: "",
        key: "src/other.ts:4",
        status: "needs-input",
        detail: "which callers still use it?",
        source: "review-1.md",
      },
    ]);
  });

  test("drops untouched notes and accepts common synonyms", () => {
    const parsed = parseStatuses(review(
      "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->", "", "Status: pending", "",
      "### b.ts:1 <!-- lcr:b.ts|n1|n1 -->", "", "Status: Done", "",
      "### c.ts:1 <!-- lcr:c.ts|n1|n1 -->", "", "Status: rejected", "",
      "### d.ts:1 <!-- lcr:d.ts|n1|n1 -->", "", "Status: half way there", "",
      "### e.ts:1 <!-- lcr:e.ts|n1|n1 -->", "", "Status: by design", "",
    ));
    expect(parsed.map((entry) => [entry.key, entry.status, entry.detail])).toEqual([
      ["b.ts:1", "applied", ""],
      ["c.ts:1", "skipped", ""],
      ["d.ts:1", "unknown", "half way there"],
      ["e.ts:1", "answered", ""],
    ]);
  });

  test("reads an answer to a question-only note", () => {
    const parsed = parseStatuses(review(
      "### src/db.ts:12 <!-- lcr:src/db.ts|n12|n12 -->",
      "",
      "Why is this retry here?",
      "",
      "Status: answered — the driver throws on cold start, covered by db.test.ts",
      "",
    ), "review-1.md");

    expect(parsed).toEqual([{
      id: "src/db.ts|n12|n12",
      key: "src/db.ts:12",
      status: "answered",
      detail: "the driver throws on cold start, covered by db.test.ts",
      source: "review-1.md",
    }]);
  });

  test("takes the last status line so an appended verdict wins", () => {
    const parsed = parseStatuses(review(
      "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->", "", "Status: pending", "", "Status: applied — done later", "",
    ));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.status).toBe("applied");
  });

  test("ignores headings and status lines inside captured code", () => {
    const parsed = parseStatuses(review(
      "### docs/guide.md:8 <!-- lcr:docs/guide.md|n8|n8 -->",
      "",
      "```diff",
      "+### Not a note heading",
      "+Status: applied",
      "```",
      "",
      "Reword this section.",
      "",
      "Status: needs-input — which audience?",
      "",
    ));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ key: "docs/guide.md:8", status: "needs-input", detail: "which audience?" });
  });

  test("does not carry a status across a file heading", () => {
    expect(parseStatuses(review(
      "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->", "", "Talk about it.", "",
      "## b.ts", "", "Status: applied", "",
    ))).toEqual([]);
  });

  test("round-trips the ids that renderMarkdown writes", () => {
    const markdown = write([{
      id: "src/app.ts|n2|n2|8-16",
      file: "src/app.ts",
      body: "Rename it.",
      start: 2,
      end: 2,
      label: "2:9-16",
      snippet: "tmpValue",
    }]);

    expect(markdown).toContain("### src/app.ts:2:9-16 <!-- lcr:src/app.ts|n2|n2|8-16 -->");
    expect(markdown).toContain("Status: pending");
    const answered = markdown.replace("Status: pending", "Status: applied — renamed");
    expect(parseStatuses(answered)).toEqual([{
      id: "src/app.ts|n2|n2|8-16",
      key: "src/app.ts:2:9-16",
      status: "applied",
      detail: "renamed",
      source: "",
    }]);
  });

  test("round-trips a whole-file note by id and by heading key", () => {
    const note = {
      id: mintNoteId("src/app.ts", "*", "*"),
      file: "src/app.ts",
      body: "Split this module.",
      a: "*",
      b: "*",
      scope: "file" as const,
      start: 0,
      end: 0,
    };
    const markdown = write([note])
      .replace("Status: pending", "Status: applied — split into two modules");

    expect(parseStatuses(markdown)).toEqual([{
      id: note.id,
      key: noteKey(note),
      status: "applied",
      detail: "split into two modules",
      source: "",
    }]);
  });

  test("two notes on one line round-trip as separate headings with distinct ids", () => {
    const at = (body: string) => ({
      id: mintNoteId("src/app.ts", "n7", "n7"),
      file: "src/app.ts",
      body,
      a: "n7",
      b: "n7",
      start: 7,
      end: 7,
    });
    const first = at("Rename it."), second = at("And handle the null case.");
    const markdown = write([first, second])
      .replace("Status: pending", "Status: applied — renamed")
      .replace("Status: pending", "Status: skipped — cannot be null here");

    expect(first.id).not.toBe(second.id);
    expect(parseStatuses(markdown)).toEqual([
      { id: first.id, key: "src/app.ts:7", status: "applied", detail: "renamed", source: "" },
      { id: second.id, key: "src/app.ts:7", status: "skipped", detail: "cannot be null here", source: "" },
    ]);
  });
});

describe("collectStatuses", () => {
  test("merges review files oldest first and ignores other files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lcr-status-"));
    await writeFile(
      path.join(dir, "review-2026-01-01T00-00-00.md"),
      review("### a.ts:1 <!-- lcr:a.ts|n1|n1 -->", "", "Status: skipped — not yet", ""),
      "utf8",
    );
    await writeFile(
      path.join(dir, "review-2026-02-01T00-00-00.md"),
      review("### a.ts:1 <!-- lcr:a.ts|n1|n1 -->", "", "Status: applied — done now", ""),
      "utf8",
    );
    await writeFile(path.join(dir, "notes.md"), review("### a.ts:1", "", "Status: applied", ""), "utf8");

    const parsed = await collectStatuses(dir, ".");
    expect(parsed.map((entry) => [entry.source, entry.status])).toEqual([
      ["review-2026-01-01T00-00-00.md", "skipped"],
      ["review-2026-02-01T00-00-00.md", "applied"],
    ]);
  });

  test("returns nothing when the output directory is missing", async () => {
    expect(await collectStatuses(path.join(tmpdir(), "lcr-missing-dir"), "nope")).toEqual([]);
  });
});
