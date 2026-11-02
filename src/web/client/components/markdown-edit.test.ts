import { expect, test } from "bun:test";
import { formatMarkdown } from "./markdown-edit.ts";

test("formatting a selection preserves surrounding prose and selects the formatted words", () => {
  const written = formatMarkdown("keep these words intact", 5, 16, "bold");
  expect(written.value).toBe("keep **these words** intact");
  expect(written.value.slice(written.from, written.to)).toBe("these words");
});

test("an empty selection inserts editable placeholder text at the caret", () => {
  const written = formatMarkdown("before after", 7, 7, "italic");
  expect(written.value).toBe("before *italic text*after");
  expect(written.value.slice(written.from, written.to)).toBe("italic text");
});

test("links escape label syntax and leave the URL selected", () => {
  const written = formatMarkdown("see [the] path", 4, 14, "link");
  expect(written.value).toBe("see [\\[the\\] path](https://)");
  expect(written.value.slice(written.from, written.to)).toBe("https://");
});

test("inline code containing backticks uses a longer delimiter and boundary padding", () => {
  const written = formatMarkdown("`name`", 0, 6, "code");
  expect(written.value).toBe("`` `name` ``");
  expect(written.value.slice(written.from, written.to)).toBe("`name`");
});

test("code blocks isolate a fragment from adjacent paragraphs and outgrow nested fences", () => {
  const written = formatMarkdown("before ```nested``` after", 7, 19, "block");
  expect(written.value).toBe("before \n\n````\n```nested```\n````\n\n after");
  expect(written.value.slice(written.from, written.to)).toBe("```nested```");
});

test("code blocks reuse existing blank-line boundaries without changing surrounding prose", () => {
  const written = formatMarkdown("before\n\ncode\n\nafter", 8, 12, "block");
  expect(written.value).toBe("before\n\n```\ncode\n```\n\nafter");
});
