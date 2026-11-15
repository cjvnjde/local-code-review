import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiffFile } from "../../../shared/review-types.ts";
import { Markdown } from "../components/markdown.tsx";
import { fileRef } from "./note-ref.ts";
import { ReviewReferences } from "./references.tsx";

const render = (body: string, paths: string[]) =>
  renderToStaticMarkup(
    <ReviewReferences
      notes={[]}
      files={paths.map((path): DiffFile => ({
        path,
        rows: [],
        status: "modified",
        added: 0,
        removed: 0,
        hash: "",
      }))}
      follow={() => {}}
      followFile={() => {}}
    >
      <Markdown body={body} />
    </ReviewReferences>,
  );

describe("rendered file references", () => {
  test("persisted Markdown links navigate inside the review instead of opening a URL", () => {
    const path = "src/[draft]/a (b)#1.ts";
    const html = render(`See ${fileRef(path)} and #missingref123`, [path]);
    expect(html).toContain('aria-label="Go to file src/[draft]/a (b)#1.ts"');
    expect(html).toContain(">src/[draft]/a (b)#1.ts</button>");
    expect(html).not.toContain("href=");
    expect(html).toContain("#missingref123 (unavailable)");
  });

  test("unknown paths, traversal and external-looking paths cannot become file navigation", () => {
    for (const path of [
      "src/missing.ts",
      "../secrets",
      "https://example.com",
    ]) {
      const html = render(fileRef(path), ["src/app.ts"]);
      expect(html).toContain("This file is no longer in the review");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("href=");
    }
  });

  test("untrusted filenames remain escaped text and code never becomes a reference", () => {
    const path = 'src/<img onerror="evil">.ts';
    const html = render(fileRef(path), [path]);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    const code = render("`" + fileRef("src/app.ts") + "`", ["src/app.ts"]);
    expect(code).not.toContain("<button");
    expect(code).toContain("lcr-file:src%2Fapp.ts");
  });
});
