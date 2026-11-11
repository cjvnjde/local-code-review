import { describe, expect, test } from "bun:test";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import {
  makeComment,
  orderFiles,
  placeNote,
  suggestionBlock,
} from "./model.ts";
import {
  noteFromComment,
  parseReview,
  renderNote,
} from "../../../review/thread.ts";

const file: DiffFile = {
  path: "src/app.ts",
  hash: "h",
  status: "modified",
  added: 1,
  removed: 1,
  rows: [
    { t: "hunk", text: "@@ -1,3 +1,3 @@" },
    { t: "ctx", text: "function run() {", n: 1, o: 1 },
    { t: "del", text: "  return 1;", o: 2 },
    { t: "add", text: "  return 2;", n: 2 },
    { t: "ctx", text: "}", n: 3, o: 3 },
  ],
};
describe("React review anchors", () => {
  test("line, range, file and overall notes round-trip through the existing review format", () => {
    for (const comment of [
      makeComment(file, 3),
      makeComment(file, 4, 1),
      makeComment(file),
      makeComment(),
    ]) {
      comment.body = "A comment with **Markdown**.";
      const note = noteFromComment(comment);
      const read = parseReview(
        `# Review notes\n\n## ${comment.file || "Overall"}\n\n${renderNote(note).join("\n")}\n\n<!-- lcr:end -->`,
      ).notes[0]!;
      expect(read.id).toBe(comment.id);
      expect(read.body).toBe(comment.body);
      expect(read.scope).toBe(comment.scope);
      expect(read.code || "").toBe(comment.code || "");
    }
  });
  test("new notes at the same anchor have distinct identities", () => {
    expect(makeComment(file, 3).id).not.toBe(makeComment(file, 3).id);
    expect(makeComment(file, 2)).toMatchObject({
      side: "old",
      start: 2,
      code: "-  return 1;",
    });
    expect(makeComment(file, 4, 1)).toMatchObject({
      side: "new",
      start: 1,
      end: 3,
    });
  });
  test("anchors follow captured code once and never choose between duplicates", () => {
    const note = noteFromComment({
      ...makeComment(file, 3),
      body: "Change this",
    });
    expect(placeNote(file, note)).toEqual({ from: 3, to: 3, kind: "exact" });
    const moved = {
      ...file,
      rows: [{ t: "add" as const, n: 12, text: "  return 2;" }],
    };
    expect(placeNote(moved, note)).toEqual({ from: 0, to: 0, kind: "moved" });
    expect(
      placeNote(
        {
          ...moved,
          rows: [...moved.rows, { t: "add", n: 20, text: "return 2;" }],
        },
        note,
      ),
    ).toBeNull();
    expect(
      placeNote(
        { ...moved, rows: [{ t: "add", n: 2, text: "unrelated" }] },
        note,
      ),
    ).toBeNull();
  });
  test("suggestions use replacement lines and outgrow literal backticks", () => {
    expect(suggestionBlock("-old\n+new\n kept")).toBe(
      "```suggestion\nnew\nkept\n```",
    );
    expect(suggestionBlock("+```inside")).toBe(
      "````suggestion\n```inside\n````",
    );
  });
  test("navigation puts directories before sibling files", () => {
    expect(
      orderFiles(
        ["src/index.ts", "README.md", "src/z/file.ts", "src/a.ts"].map(
          (path) => ({ ...file, path }),
        ),
      ).map((f) => f.path),
    ).toEqual(["src/z/file.ts", "src/a.ts", "src/index.ts", "README.md"]);
  });
});
