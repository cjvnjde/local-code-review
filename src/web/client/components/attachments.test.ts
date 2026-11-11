import { expect, test } from "bun:test";
import { imageTokens } from "./attachments.ts";

test("editable image tokens exclude code examples, escaped images and remote content", () => {
  const body = [
    "![Visible](images/first.png)",
    "`![example](images/inline.png)`",
    "\\![escaped](images/escaped.png)",
    "    ![indented](images/code.png)",
    "~~~md",
    "![fenced](images/fence.png)",
    "~~~",
    "![remote](https://example.com/tracker.png)",
    '![Second](<assets/second.png> "Title")',
  ].join("\n");
  const tokens = imageTokens(body);
  expect(tokens.map((token) => token.ref)).toEqual([
    "images/first.png",
    "assets/second.png",
  ]);
  for (const token of tokens)
    expect(body.slice(token.from, token.to)).toBe(token.ref);
  const token = tokens[1]!;
  expect(
    body.slice(0, token.from) + "images/edited.png" + body.slice(token.to),
  ).toContain('![Second](<images/edited.png> "Title")');
});
