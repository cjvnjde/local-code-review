import { describe, expect, test } from "bun:test";
import { codeHtml, langOf } from "./highlight.ts";

const plain = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("codeHtml", () => {
  test("keeps the rendered text identical to the row text", () => {
    // Character offsets taken from the DOM are only valid while this holds.
    const lines = [
      '  const tmpValue = fetchProfile(userId, { retries: 3 });',
      'if (a < b && c > "d") { /* note */ }',
      '\tlet x = `t${y}`;',
    ];
    for (const line of lines) {
      expect(plain(codeHtml(line, langOf("a.ts")))).toBe(line);
      expect(plain(codeHtml(line, langOf("a.ts"), [4, 9], [{ s: 2, e: 12, c: "cn" }]))).toBe(line);
    }
  });

  test("marks the requested character range and stacks with the word diff", () => {
    const html = codeHtml("const tmpValue = 1;", langOf("a.ts"), [6, 14], [{ s: 6, e: 14, c: "cs" }]);
    expect(html).toContain('<span class="w cs">tmpValue</span>');
    expect(plain(html)).toBe("const tmpValue = 1;");
  });

  test("splits a mark that starts inside a token", () => {
    const html = codeHtml("const tmpValue = 1;", langOf("a.ts"), null, [{ s: 9, e: 14, c: "cn" }]);
    expect(html).toContain('<span class="cn">Value</span>');
    expect(html).toContain("tmp");
  });

  test("ignores an empty mark", () => {
    expect(codeHtml("abc", "txt", null, [{ s: 1, e: 1, c: "cs" }])).not.toContain("cs");
  });
});
