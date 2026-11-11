import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown.tsx";
import { attachmentSrc } from "./attachments.ts";

const render = (body: string, captured?: string) =>
  renderToStaticMarkup(
    <Markdown body={body} captured={captured} file="code.ts" />,
  );
describe("library Markdown rendering", () => {
  test("renders GFM tables, checklists, links and highlighted fences", () => {
    const html = render(
      "# Heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] Done\n\n[Docs](https://example.com)\n\n```ts\nconst x = 1;\n```",
    );
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("hljs-keyword");
  });
  test("HTML stays inert, unsafe links have no target and external images never load", () => {
    const html = render(
      "<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![tracker](https://example.com/pixel.png)",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
    expect(html).not.toContain('src="https://');
    expect(render('```html\n<img onerror="bad()">\n```')).toContain("&lt;");
  });
  test("only local attachment names become images", () => {
    expect(attachmentSrc("assets/result.png")).toBe(
      "/api/attachment?ref=assets%2Fresult.png",
    );
    for (const invalid of [
      "../secret.png",
      "images/../secret.png",
      "//evil/a.png",
      "data:image/png;base64,x",
      "https://example.com/a.png",
    ])
      expect(attachmentSrc(invalid)).toBe("");
    expect(render("![Screenshot](images/test.png)")).toContain(
      'src="/api/attachment?ref=images%2Ftest.png"',
    );
  });
  test("suggestions display a diff while remaining ordinary Markdown at rest", () => {
    const html = render(
      "```suggestion\nconst next = 2;\n```",
      "+const old = 1;",
    );
    expect(html).toContain("Suggested change");
    expect(html).toContain("diff-add");
    expect(html).toContain("diff-del");
    expect(render("```suggestion\nreplacement\n```")).not.toContain("diff-del");
  });
});
