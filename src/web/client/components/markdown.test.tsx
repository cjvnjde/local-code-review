import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown.tsx";
import { attachmentSrc } from "./attachments.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  test("arbitrary attachments render as downloads with useful original labels, not image or context widgets", () => {
    const html = render(
      "[report with spaces.bin](images/0123456789abcdef-report_with_spaces.bin)",
    );
    expect(html).toContain(
      'href="/api/attachment?ref=images%2F0123456789abcdef-report_with_spaces.bin&amp;download=1"',
    );
    expect(html).toContain('download="report with spaces.bin"');
    expect(html).toContain(">report with spaces.bin</a>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Inspect context");
    expect(render("[active.html](assets/active.html)")).toContain(
      "&amp;download=1",
    );
    expect(render("[image.svg](images/image.svg)")).toContain(
      "&amp;download=1",
    );
    expect(render("![image.svg](images/image.svg)")).toContain("<img");
    const escaped = render(
      "[report \\[final\\] \\_draft\\_ &amp;.bin](images/0123456789abcdef-report.bin)",
    );
    expect(escaped).toContain('download="report [final] _draft_ &amp;.bin"');
  });
  test("previously saved context references still render their inspection control", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Markdown
          body={`[Additional context: old details](context/${"a".repeat(64)}/manifest.json)`}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("old details");
    expect(html).toContain("Inspect context");
    expect(html).not.toContain("download=");
  });
});
