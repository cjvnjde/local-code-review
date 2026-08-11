import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./review.ts";
import { noteFromComment } from "./thread.ts";
import type { ReviewComment } from "./types.ts";

const write = (comments: ReviewComment[], range = "HEAD") =>
  renderMarkdown({ range, notes: comments.map(noteFromComment) });

const overall = (id: string, body: string): ReviewComment => ({ id, file: "", body, scope: "global", start: 0, end: 0 });

describe("renderMarkdown", () => {
  test("renders overall and anchored old-line feedback", () => {
    const markdown = write([overall("|@|@|#g1", "Check all call sites."), {
      file: "src/example.ts",
      body: "Keep compatibility.",
      start: 4,
      end: 5,
      side: "old",
      code: "-oldCall()",
    }], "HEAD~1");

    expect(markdown).toContain("Diff under review: `HEAD~1`");
    expect(markdown).toContain("## Overall\n\n### Overall note <!-- lcr:|@|@|#g1 -->");
    expect(markdown).toContain("Check all call sites.\n\nStatus: pending");
    expect(markdown).toContain("### src/example.ts:4-5 (line numbers before the change)");
    expect(markdown).toContain("```diff\n-oldCall()\n```");
    expect(markdown).toContain("Keep compatibility.");
  });

  test("every overall note reads before the files, in the order they were written", () => {
    const markdown = write([
      { file: "src/example.ts", body: "Rename this.", start: 9, end: 9, code: "+function h() {}" },
      overall("|@|@|#g1", "The naming is inconsistent."),
      overall("|@|@|#g2", "No tests came with this."),
    ]);

    const first = markdown.indexOf("The naming is inconsistent.");
    const second = markdown.indexOf("No tests came with this.");
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(markdown.indexOf("## src/example.ts"));
    // No path and no line range: an overall note is about the review, not about a place in it.
    expect(markdown).not.toContain("### :0");
    expect(markdown).not.toContain("(line numbers before the change)");
  });

  test("renders a note anchored to part of a line", () => {
    const markdown = write([{
      file: "src/example.ts",
      body: "Rename this variable.",
      start: 12,
      end: 12,
      label: "12:7-14",
      side: "new",
      code: "+  const tmpValue = load();",
      ca: 6,
      cb: 14,
      snippet: "tmpValue",
    }]);

    expect(markdown).toContain("### src/example.ts:12:7-14");
    expect(markdown).toContain("Applies to this part of the line only: `tmpValue`");
    expect(markdown).toContain("Rename this variable.");
  });

  test("heads a whole-file note without lines and puts it before the line notes", () => {
    const markdown = write([
      {
        id: "src/example.ts|n9|n9",
        file: "src/example.ts",
        body: "Rename the helper.",
        start: 9,
        end: 9,
        code: "+function h() {}",
      },
      {
        id: "src/example.ts|*|*",
        file: "src/example.ts",
        body: "This module does two unrelated jobs. Split it.",
        scope: "file",
        start: 0,
        end: 0,
      },
    ]);

    expect(markdown).toContain("### src/example.ts (whole file) <!-- lcr:src/example.ts|*|* -->");
    expect(markdown).not.toContain("src/example.ts:0");
    expect(markdown.indexOf("(whole file)")).toBeLessThan(markdown.indexOf("### src/example.ts:9"));
    expect(markdown).toContain("This module does two unrelated jobs. Split it.\n\nStatus: pending");
  });

  test("fences a selected fragment that contains backticks", () => {
    const markdown = write([{
      file: "src/example.ts",
      body: "Drop the template literal.",
      start: 3,
      end: 3,
      label: "3:1-8",
      snippet: "`a${b}`",
    }]);

    expect(markdown).toContain("only: `` `a${b}` ``");
  });

  test("fences captured code that contains a fence of its own", () => {
    const markdown = write([{
      file: "docs/guide.md",
      body: "Drop this block.",
      start: 2,
      end: 3,
      code: "+```js\n+run()",
    }]);

    expect(markdown).toContain("````diff\n+```js\n+run()\n````");
  });

  test("tells the agent to answer in the file as it works", () => {
    const markdown = write([]);
    expect(markdown).toContain("**Agent** <!-- lcr:m -->");
    expect(markdown).toContain("one at a time");
  });
});
