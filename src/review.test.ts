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
});
