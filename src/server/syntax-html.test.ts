import { expect, test } from "bun:test";
import { parseSyntaxHtml } from "./syntax-html.ts";

test("extracts nested captures and multiline text, preserving Unicode and escaped source", () => {
  const source = "/* 🚀\n * <script>&\"' */\nconst value = `text ${call()}`;\n";
  const lines = parseSyntaxHtml(
    `<head><style>ignored</style></head><body><pre><code><span class='comment'>/* 🚀\n * &lt;script&gt;&amp;&quot;&#39; */</span>\n<span class='keyword'>const</span> value = <span class='string'>\u0060text <span class='embedded'>\u0024{<span class='function builtin'>call</span>()}</span>\u0060</span>;</code></pre></body>`,
    source,
  )!;
  expect(
    lines.map((line) => line.map((token) => token.text).join("")).join("\n"),
  ).toBe(source.slice(0, -1));
  expect(lines[1]).toEqual([{ kind: "comment", text: " * <script>&\"' */" }]);
  expect(lines[2]).toContainEqual({ kind: "function", text: "call" });
  expect(lines[2]).toContainEqual({ kind: "plain", text: "${" });
});

test("supports legacy line tables without including line numbers or losing blank lines", () => {
  const lines = parseSyntaxHtml(
    `<table>
    <tr><td class=line-number>1</td><td class=line><span class='comment'>one</span>\n</td></tr>
    <tr><td class=line-number>2</td><td class=line>\n</td></tr>
    <tr><td class=line-number>3</td><td class=line><span class='string'>three</span>\n</td></tr>
  </table>`,
    "one\n\nthree",
  );
  expect(lines?.slice(0, 3)).toEqual([
    [{ text: "one", kind: "comment" }],
    [],
    [{ text: "three", kind: "string" }],
  ]);
});

test("falls back on text changes or active markup and never trusts arbitrary attributes", () => {
  for (const html of [
    "",
    "<pre>same</pre>",
    "<code>different</code>",
    "<code><img src=x>same</code>",
    "<code><script>same</script></code>",
  ])
    expect(parseSyntaxHtml(html, "same")).toBeNull();
  expect(
    parseSyntaxHtml(
      '<code><span class="bogus" style="color:red" onclick="bad()">same</span></code>',
      "same",
    ),
  ).toEqual([[{ text: "same", kind: "plain" }]]);
  expect(
    parseSyntaxHtml('<code><span class="__proto__">same</span></code>', "same"),
  ).toEqual([[{ text: "same", kind: "plain" }]]);
});

test("keeps CRLF, empty lines, and either final-newline convention", () => {
  for (const source of ["", "\n", "a\n\n", "a\r\nb\r\n", "a\nlast"])
    expect(
      parseSyntaxHtml(`<code>${source}</code>`, source)
        ?.map((line) => line.map((token) => token.text).join(""))
        .join("\n"),
    ).toBe(source);
  expect(parseSyntaxHtml("<code>a</code>", "a\n")).not.toBeNull();
  expect(parseSyntaxHtml("<code>a\n</code>", "a")).not.toBeNull();
  expect(parseSyntaxHtml("<code>a</code>", "a\n\n")).toBeNull();
  expect(
    parseSyntaxHtml(
      "<code><span class='comment'>/* a</span>\n\n<span class='comment'> b */</span></code>",
      "/* a\r\n\r\n b */\r\n",
    ),
  ).toEqual([
    [{ text: "/* a\r", kind: "comment" }],
    [{ text: "\r", kind: "plain" }],
    [{ text: " b */\r", kind: "comment" }],
  ]);
});
