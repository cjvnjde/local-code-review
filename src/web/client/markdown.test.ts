import { describe, expect, test } from "bun:test";
import { mdHtml } from "./markdown.ts";

describe("mdHtml blocks", () => {
  test("prose is a paragraph and a typed line break stays one", () => {
    expect(mdHtml("first line\nsecond line")).toBe("<p>first line<br>second line</p>");
    expect(mdHtml("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
    expect(mdHtml("")).toBe("");
  });

  test("headings read as headings", () => {
    expect(mdHtml("## Why this breaks")).toBe("<h2>Why this breaks</h2>");
    expect(mdHtml("###### deep\n\ntext")).toBe("<h6>deep</h6><p>text</p>");
    expect(mdHtml("#not a heading")).toBe("<p>#not a heading</p>");
  });

  test("a fence is code, coloured by the language it names", () => {
    const html = mdHtml("```ts\nconst a = 1;\n```");
    expect(html.startsWith('<pre class="c mdb"><code>')).toBe(true);
    expect(html).toContain('<span class="k">const</span>');
    expect(html.endsWith("</code></pre>")).toBe(true);
  });

  test("a fence with no language named is read as the file the note is on", () => {
    expect(mdHtml("```\nconst a = 1;\n```", "src/app.ts")).toContain('<span class="k">const</span>');
  });

  test("a fence keeps its blank lines and outlives a missing closer", () => {
    expect(mdHtml("```\na\n\nb\n```")).toBe('<pre class="c mdb"><code>a\n\nb</code></pre>');
    expect(mdHtml("```\nunclosed")).toBe('<pre class="c mdb"><code>unclosed</code></pre>');
  });

  test("a longer fence carries the backticks inside it", () => {
    // the body is tokenised like any code, so read it back through the spans the highlighter adds
    expect(mdHtml("````\n```\n````").replace(/<\/?span[^>]*>/g, ""))
      .toBe('<pre class="c mdb"><code>```</code></pre>');
  });

  test("markup inside a fence is shown, not run", () => {
    expect(mdHtml("```\n<b>x</b>\n```")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  test("a tight list keeps no paragraphs and a loose one does", () => {
    expect(mdHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(mdHtml("- one\n\n- two")).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
  });

  test("an ordered list keeps the number it started at", () => {
    expect(mdHtml("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(mdHtml("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  });

  test("a list nests on indentation", () => {
    expect(mdHtml("- one\n  - deep\n- two"))
      .toBe("<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>");
  });

  test("a checklist keeps its boxes, and they are not clickable", () => {
    expect(mdHtml("- [x] done\n- [ ] not yet")).toBe(
      '<ul><li class="task"><input type="checkbox" disabled checked>done</li>' +
        '<li class="task"><input type="checkbox" disabled>not yet</li></ul>',
    );
    expect(mdHtml("- [z] not a box")).toBe("<ul><li>[z] not a box</li></ul>");
  });

  test("a change of marker starts another list", () => {
    expect(mdHtml("- one\n1. two")).toBe("<ul><li>one</li></ul><ol><li>two</li></ol>");
  });

  test("a paragraph after a list is not swallowed by it, and does not loosen it", () => {
    expect(mdHtml("- one\n\nafter")).toBe("<ul><li>one</li></ul><p>after</p>");
    expect(mdHtml("- one\nrunning on\n- two"))
      .toBe("<ul><li>one<br>running on</li><li>two</li></ul>");
  });

  test("a fence inside an item stays inside it", () => {
    expect(mdHtml("- fix it:\n\n  ```\n  x\n  ```"))
      .toBe('<ul><li><p>fix it:</p><pre class="c mdb"><code>x</code></pre></li></ul>');
  });

  test("quotes nest their own blocks and take prose that runs on", () => {
    expect(mdHtml("> quoted\n> - a")).toBe("<blockquote><p>quoted</p><ul><li>a</li></ul></blockquote>");
    expect(mdHtml("> quoted\nrunning on")).toBe("<blockquote><p>quoted<br>running on</p></blockquote>");
  });

  test("a rule is a rule and a list item is not", () => {
    expect(mdHtml("---")).toBe("<hr>");
    expect(mdHtml("***")).toBe("<hr>");
    expect(mdHtml("- - -")).toBe("<hr>");
    expect(mdHtml("- item")).toBe("<ul><li>item</li></ul>");
  });

  test("a table is a table, aligned as its delimiter row says", () => {
    expect(mdHtml("| a | b |\n| :- | -: |\n| 1 | 2 |")).toBe(
      '<div class="mdt"><table><thead><tr><th style="text-align:left">a</th>' +
        '<th style="text-align:right">b</th></tr></thead>' +
        '<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr>' +
        "</tbody></table></div>",
    );
  });

  test("the header decides the column count", () => {
    expect(mdHtml("a | b\n- | -\n1 |")).toContain("<td>1</td><td></td>");
    expect(mdHtml("a | b\n- | -\n1 | 2 | 3")).toContain("<td>1</td><td>2</td></tr>");
  });

  test("a table ends at the first line that is not a row", () => {
    expect(mdHtml("| a |\n| - |\n| 1 |\n\nafter")).toContain("</table></div><p>after</p>");
    expect(mdHtml("| a |\n| - |\nafter")).toContain("</table></div><p>after</p>");
  });
});

describe("mdHtml inline", () => {
  test("a code span is code and holds its own markup", () => {
    expect(mdHtml("call `run(a, b)` first")).toBe("<p>call <code>run(a, b)</code> first</p>");
    expect(mdHtml("`**not bold**`")).toBe("<p><code>**not bold**</code></p>");
    expect(mdHtml("`` a ` b ``")).toBe("<p><code>a ` b</code></p>");
    expect(mdHtml("an unmatched ` tick")).toBe("<p>an unmatched ` tick</p>");
  });

  test("emphasis in all the forms a review writes it", () => {
    expect(mdHtml("**bold** and *thin*")).toBe("<p><strong>bold</strong> and <em>thin</em></p>");
    expect(mdHtml("__bold__ and _thin_")).toBe("<p><strong>bold</strong> and <em>thin</em></p>");
    expect(mdHtml("***both***")).toBe("<p><strong><em>both</em></strong></p>");
    expect(mdHtml("~~gone~~")).toBe("<p><del>gone</del></p>");
    expect(mdHtml("nested **bold with `code`**"))
      .toBe("<p>nested <strong>bold with <code>code</code></strong></p>");
  });

  test("a name with underscores is a name", () => {
    expect(mdHtml("read_status_of and file_a_b")).toBe("<p>read_status_of and file_a_b</p>");
  });

  test("a lone delimiter is the character it was typed as", () => {
    expect(mdHtml("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
    expect(mdHtml("a ** b")).toBe("<p>a ** b</p>");
  });

  test("a backslash escapes the punctuation after it", () => {
    expect(mdHtml("\\*not emphasis\\*")).toBe("<p>*not emphasis*</p>");
    expect(mdHtml("\\d in a regex")).toBe("<p>\\d in a regex</p>");
  });

  test("links open away from the page and images are shown as links", () => {
    expect(mdHtml("[docs](https://example.com/x)")).toBe(
      '<p><a href="https://example.com/x" target="_blank" rel="noreferrer noopener">docs</a></p>',
    );
    expect(mdHtml("see https://example.com.")).toBe(
      '<p>see <a href="https://example.com" target="_blank" rel="noreferrer noopener">https://example.com</a>.</p>',
    );
    expect(mdHtml("<https://example.com>")).toContain('href="https://example.com"');
    expect(mdHtml("![shot](https://example.com/a.png)")).toContain(">shot</a>");
  });

  test("a relative link keeps working and a script one does not", () => {
    expect(mdHtml("[file](./src/app.ts)")).toContain('href="./src/app.ts"');
    expect(mdHtml("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
    expect(mdHtml("[x](data:text/html;base64,aa)")).toContain("[x](data:text/html");
  });

  test("markup in prose is shown rather than run", () => {
    expect(mdHtml('<img src=x onerror="alert(1)">')).toBe(
      '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>',
    );
    expect(mdHtml("<b>bold?</b>")).toBe("<p>&lt;b&gt;bold?&lt;/b&gt;</p>");
    expect(mdHtml("a < b && c > d")).toBe("<p>a &lt; b &amp;&amp; c &gt; d</p>");
  });

  test("a heading and a table cell are inline-rendered too", () => {
    expect(mdHtml("## `run()` is **wrong**")).toBe("<h2><code>run()</code> is <strong>wrong</strong></h2>");
    expect(mdHtml("| a |\n| - |\n| `x` |")).toContain("<td><code>x</code></td>");
  });
});
