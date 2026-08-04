import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./review.ts";
import { collectStatuses, parseStatuses } from "./status.ts";
import { fileNoteId, noteKey } from "./web/client/state.ts";

const review = (...sections: string[]) => ["# Review notes", "", ...sections].join("\n");

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
    ));
    expect(parsed.map((entry) => [entry.key, entry.status, entry.detail])).toEqual([
      ["b.ts:1", "applied", ""],
      ["c.ts:1", "skipped", ""],
      ["d.ts:1", "unknown", "half way there"],
    ]);
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
    const markdown = renderMarkdown({
      general: "",
      comments: [{
        id: "src/app.ts|n2|n2|8-16",
        file: "src/app.ts",
        body: "Rename it.",
        start: 2,
        end: 2,
        label: "2:9-16",
        snippet: "tmpValue",
      }],
    }, "HEAD");

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
      id: fileNoteId("src/app.ts"),
      file: "src/app.ts",
      body: "Split this module.",
      a: "*",
      b: "*",
      scope: "file" as const,
      start: 0,
      end: 0,
    };
    const markdown = renderMarkdown({ general: "", comments: [note] }, "HEAD")
      .replace("Status: pending", "Status: applied — split into two modules");

    expect(parseStatuses(markdown)).toEqual([{
      id: "src/app.ts|*|*",
      key: noteKey(note),
      status: "applied",
      detail: "split into two modules",
      source: "",
    }]);
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
