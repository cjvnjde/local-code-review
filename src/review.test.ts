import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./review.ts";

describe("renderMarkdown", () => {
  test("renders overall and anchored old-line feedback", () => {
    const markdown = renderMarkdown({
      general: "Check all call sites.",
      comments: [{
        file: "src/example.ts",
        body: "Keep compatibility.",
        start: 4,
        end: 5,
        side: "old",
        code: "-oldCall()",
      }],
    }, "HEAD~1");

    expect(markdown).toContain("Diff under review: `HEAD~1`");
    expect(markdown).toContain("## Overall\n\nCheck all call sites.");
    expect(markdown).toContain("### src/example.ts:4-5 (line numbers before the change)");
    expect(markdown).toContain("```diff\n-oldCall()\n```");
    expect(markdown).toContain("Keep compatibility.");
  });

  test("renders a note anchored to part of a line", () => {
    const markdown = renderMarkdown({
      general: "",
      comments: [{
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
      }],
    }, "HEAD");

    expect(markdown).toContain("### src/example.ts:12:7-14");
    expect(markdown).toContain("Applies to this part of the line only: `tmpValue`");
    expect(markdown).toContain("Rename this variable.");
  });

  test("heads a whole-file note without lines and puts it before the line notes", () => {
    const markdown = renderMarkdown({
      general: "",
      comments: [
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
      ],
    }, "HEAD");

    expect(markdown).toContain("### src/example.ts (whole file) <!-- lcr:src/example.ts|*|* -->");
    expect(markdown).not.toContain("src/example.ts:0");
    expect(markdown.indexOf("(whole file)")).toBeLessThan(markdown.indexOf("### src/example.ts:9"));
    expect(markdown).toContain("This module does two unrelated jobs. Split it.\n\nStatus: pending");
  });

  test("fences a selected fragment that contains backticks", () => {
    const markdown = renderMarkdown({
      general: "",
      comments: [{
        file: "src/example.ts",
        body: "Drop the template literal.",
        start: 3,
        end: 3,
        label: "3:1-8",
        snippet: "`a${b}`",
      }],
    }, "HEAD");

    expect(markdown).toContain("only: `` `a${b}` ``");
  });
});
