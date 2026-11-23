import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Code } from "./code.tsx";

test("Tree-sitter tokens preserve source text and use the existing theme classes without interpreting HTML", () => {
  const source = '<img src=x onerror="bad()">&🚀';
  const html = renderToStaticMarkup(
    <Code value={source} tokens={[{ kind: "comment", text: source }]} />,
  );
  expect(html).toContain('class="hljs-comment"');
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(html).toContain("&amp;🚀");
});

test("absent tokens use highlight.js while a successful blank line stays blank", () => {
  expect(
    renderToStaticMarkup(<Code value="const x = 1;" language="javascript" />),
  ).toContain("hljs-keyword");
  expect(renderToStaticMarkup(<Code value="" tokens={[]} />)).toBe(
    "<code></code>",
  );
});

test("a hex literal across syntax tokens keeps its text and receives one swatch", () => {
  const html = renderToStaticMarkup(
    <Code
      value="color: #AABBCCDD"
      tokens={[
        { kind: "plain", text: "color: " },
        { kind: "meta", text: "#" },
        { kind: "number", text: "AABBCCDD" },
      ]}
      previewHexColors
    />,
  );
  expect(html.match(/background-color:#AABBCCDD/g)).toHaveLength(1);
  expect(html).toContain('class="hljs-number">AABBCCDD');
  expect(html.replace(/<[^>]*>/g, "")).toBe("color: #AABBCCDD");
});
