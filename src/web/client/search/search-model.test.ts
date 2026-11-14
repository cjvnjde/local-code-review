import { describe, expect, test } from "bun:test";
import {
  matchRanges,
  searchDocuments,
  searchExcerpt,
  searchHtml,
  searchReview,
  searchSegments,
} from "./search-model.ts";

const files = [
  {
    path: "src/cache.ts",
    from: "src/old-cache.ts",
    rows: [
      { t: "hunk", text: "@@ heading not searchable @@" },
      { t: "ctx", n: 10, o: 10, text: "// nearby explanation" },
      { t: "del", o: 11, text: "return staleValue;" },
      { t: "add", n: 11, text: "return freshValue;" },
      { t: "hunk", text: "@@ distant hunk @@" },
      { t: "ctx", n: 500, o: 500, text: "distantContext" },
    ],
  },
];
const note = {
  id: "n",
  file: "src/cache.ts",
  body: "Why keep the stale value?",
  code: "-return staleValue;",
};
const docs = () =>
  searchDocuments(
    files,
    [note, { id: "g", file: "", body: "Overall concern" }],
    new Map([
      [
        "n",
        [
          { role: "agent", body: "Cache invalidation fixed." },
          { role: "reviewer", body: "Thanks for the explanation." },
        ],
      ],
    ]),
    new Map([["n", { status: "applied", detail: "Removed stale data" }]]),
  );

describe("review search", () => {
  test("finds code on both sides and surrounding context without hunk headers", () => {
    expect(searchReview(docs(), "freshValue").map((r) => r.kind)).toEqual([
      "code",
    ]);
    expect(searchReview(docs(), "staleValue").map((r) => r.kind)).toEqual([
      "code",
      "note",
      "note", // Fuzzy match of “stale value”, after the two literal hits.
    ]);
    expect(searchReview(docs(), "nearby")[0].row).toBe("n10");
    expect(searchReview(docs(), "heading not searchable")).toEqual([]);
    expect(searchReview(docs(), "freshValue")[0].context).not.toContain(
      "distantContext",
    );
    expect(searchReview(docs(), "not in the diff")).toEqual([]);
  });
  test("finds filenames, rename sources, global notes, status and both speakers", () => {
    expect(searchReview(docs(), "old-cache")[0].kind).toBe("file");
    expect(searchReview(docs(), "cache.ts").map((r) => r.kind)).toEqual([
      "file",
    ]);
    expect(searchReview(docs(), "OVERALL")[0].noteId).toBe("g");
    expect(searchReview(docs(), "applied")[0].label).toBe("Status");
    expect(searchReview(docs(), "invalidation")[0]).toMatchObject({
      kind: "reply",
      noteId: "n",
      message: 0,
      label: "Agent answer",
    });
    expect(searchReview(docs(), "thanks")[0]).toMatchObject({
      message: 1,
      label: "Reviewer reply",
    });
  });
  test("combines filename and content terms; whitespace is not a query", () => {
    expect(
      searchReview(docs(), "cache.ts FRESHVALUE").map((r) => r.kind),
    ).toEqual(["code"]);
    expect(searchReview(docs(), "other.ts freshValue")).toEqual([]);
    expect(searchReview(docs(), "  ")).toEqual([]);
  });
  test("rebuilding reflects replies, deletion and revealed context without changing the source", () => {
    const messages = new Map([
      ["n", [{ role: "agent", body: "First answer" }]],
    ]);
    const original = JSON.stringify(files);
    expect(
      searchReview(
        searchDocuments(files, [note], messages, new Map()),
        "First answer",
      ),
    ).toHaveLength(1);
    messages.set("n", [{ role: "agent", body: "Replacement answer" }]);
    expect(
      searchReview(
        searchDocuments(files, [note], messages, new Map()),
        "First answer",
      ),
    ).toHaveLength(0);
    expect(
      searchReview(
        searchDocuments(files, [], messages, new Map()),
        "Replacement",
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(files)).toBe(original);
  });
  test("uses literal matching and escapes markup around every highlight", () => {
    expect(matchRanges("a.b [x] a+b", "a.b")).toEqual([[0, 3]]);
    expect(searchHtml("<script>[x] & a+b</script>", "[x] a+b")).toBe(
      "&lt;script&gt;<mark>[x]</mark> &amp; <mark>a+b</mark>&lt;/script&gt;",
    );
    expect(matchRanges("a.b ab", ".*")).toEqual([]);
    expect(searchHtml("cache cached", "cache cached")).toBe(
      "<mark>cache</mark> <mark>cached</mark>",
    );
  });
  test("shows a late match in a long answer", () => {
    const excerpt = searchExcerpt(
      "x".repeat(1000) + "target" + "y".repeat(1000),
      "target",
      90,
    );
    expect(excerpt).toContain("target");
    expect(excerpt.length).toBeLessThanOrEqual(92);
  });
  test("maps a match across syntax spans without rewriting or losing offsets", () => {
    expect(
      searchSegments(["return ", "fresh", "Value", ";"], "freshValue"),
    ).toEqual([{ start: { part: 1, offset: 0 }, end: { part: 2, offset: 5 } }]);
    expect(searchSegments(["", "abc", "", "def", ""], "abcdef")).toEqual([
      { start: { part: 1, offset: 0 }, end: { part: 3, offset: 3 } },
    ]);
    expect(searchSegments([], "abc")).toEqual([]);
    expect(searchSegments(["abc"], "")).toEqual([]);
  });

  test("literal queries deduplicate terms, prefer longest overlaps and preserve original offsets", () => {
    expect(matchRanges("aaaa AA", "aa aaa AA")).toEqual([
      [0, 3],
      [5, 7],
    ]);
    expect(
      matchRanges("a+b (x) [y] $z ^end? \\", "a+b (x) [y] $z ^end? \\"),
    ).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
      [12, 14],
      [15, 20],
      [21, 22],
    ]);
    expect(matchRanges("İ i I", "i")).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });

  test("matching never borrows required terms from another document", () => {
    const documents = [
      {
        kind: "code" as const,
        path: "src/a.ts",
        text: "alpha",
        label: "Added",
      },
      {
        kind: "reply" as const,
        path: "src/a.ts",
        text: "beta",
        label: "Agent answer",
      },
      {
        kind: "code" as const,
        path: "beta.ts",
        text: "alpha",
        label: "Context",
      },
    ];
    expect(searchReview(documents, "alpha beta").map((r) => r.path)).toEqual([
      "beta.ts",
    ]);
    expect(searchReview(documents, "src/a.ts").map((r) => r.kind)).toEqual([]);
    expect(documents.every((d) => !("ranges" in d))).toBe(true);
  });

  test("code traversal includes only two neighbours per side and stops at hunk boundaries", () => {
    const rows = [
      { t: "hunk", text: "@@ first @@" },
      ...Array.from({ length: 7 }, (_, i) => ({
        t: "ctx",
        n: i + 1,
        o: i + 1,
        text: "line" + i,
      })),
      { t: "hunk", text: "@@ second @@" },
      { t: "del", o: 100, text: "last" },
    ];
    const documents = searchDocuments(
      [{ path: "a.ts", rows }],
      [],
      new Map(),
      new Map(),
    );
    expect(
      documents.filter((d) => d.kind === "code").map((d) => d.row),
    ).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "o100"]);
    expect(documents.find((d) => d.text === "line3")?.context).toBe(
      " line1\n line2\n line3\n line4\n line5",
    );
    expect(documents.find((d) => d.text === "line0")?.context).toBe(
      " line0\n line1\n line2",
    );
    expect(documents.find((d) => d.text === "last")?.context).toBe("-last");
  });

  test("note traversal retains range labels and reply positions when some bodies are empty", () => {
    const documents = searchDocuments(
      [],
      [
        { id: "file", file: "a.ts", scope: "file", body: "whole" },
        { id: "range", file: "a.ts", start: 4, end: 8, body: "range" },
        { id: "single", file: "a.ts", start: 3, end: 3, body: "one" },
        {
          id: "label",
          file: "a.ts",
          label: "old 2",
          start: 2,
          end: 2,
          body: "label",
        },
      ],
      new Map([
        ["range", [{ role: "agent" }, { role: "reviewer", body: "reply" }]],
      ]),
      new Map(),
    );
    expect(
      documents.filter((d) => d.kind === "note").map((d) => d.location),
    ).toEqual(["whole file", "4–8", "3", "old 2"]);
    expect(searchReview(documents, "reply")[0]).toMatchObject({
      noteId: "range",
      message: 1,
      location: "4–8",
    });
  });

  test("span mapping uses the preceding span for an end at a boundary and skips empty starts", () => {
    expect(searchSegments(["ab", "", "cd", "ef"], "ab cd ef")).toEqual([
      { start: { part: 0, offset: 0 }, end: { part: 0, offset: 2 } },
      { start: { part: 2, offset: 0 }, end: { part: 2, offset: 2 } },
      { start: { part: 3, offset: 0 }, end: { part: 3, offset: 2 } },
    ]);
    expect(searchSegments(["", "", ""], "x")).toEqual([]);
  });

  test("excerpts distinguish beginning, middle, tail and absent matches", () => {
    expect(searchExcerpt("target rest", "target", 6)).toBe("target…");
    expect(searchExcerpt("0123456789target", "target", 9)).toBe("…789target");
    expect(searchExcerpt("0123456789", "missing", 4)).toBe("0123…");
    expect(searchExcerpt("short", "short", 20)).toBe("short");
    expect(searchHtml('<&>"', "missing")).toBe("&lt;&amp;&gt;&quot;");
  });

  test("UI capture metadata is searchable and results still identify the owning global note", () => {
    const ui = {
      id: "ui",
      scope: "global",
      body: "Please adjust this",
      web: {
        before: {
          url: "http://localhost:3000/checkout",
          title: "Checkout",
          selector: '[data-testid="purchase"]',
          components: [
            {
              framework: "React",
              name: "PurchaseForm",
              file: "src/PurchaseForm.tsx",
            },
          ],
          element: {
            tag: "button",
            text: "Buy now",
            attributes: { "aria-label": "Confirm purchase" },
            styles: { color: "red" },
          },
        },
      },
    };
    const documents = searchDocuments([], [ui], new Map(), new Map());
    for (const query of [
      "localhost",
      "Checkout",
      "data-testid",
      "PurchaseForm",
      "Buy now",
      "aria-label",
      "color",
    ]) {
      const hits = searchReview(documents, query);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        kind: "note",
        noteId: "ui",
        path: "",
        location: "",
      });
    }
    expect(searchReview(documents, "undefined")).toEqual([]);
    expect(searchReview(documents, "Please")[0]).toMatchObject({
      noteId: "ui",
      path: "",
    });
  });

  test("files without a rename source and unchanged rename paths index only their real path", () => {
    const documents = searchDocuments(
      [
        { path: "plain.ts", rows: [] },
        { path: "same.ts", from: "same.ts", rows: [] },
        { path: "renamed.ts", from: "original.ts", rows: [] },
      ],
      [],
      new Map(),
      new Map(),
    );
    expect(documents[0]?.text).toBe("plain.ts");
    expect(documents[1]?.text).toBe("same.ts");
    expect(searchReview(documents, "undefined")).toEqual([]);
    expect(searchReview(documents, "original.ts")[0]).toMatchObject({
      kind: "file",
      path: "renamed.ts",
    });
    expect(searchReview(documents, "renamed.ts")[0]).toMatchObject({
      kind: "file",
      path: "renamed.ts",
    });
  });

  test("search keeps row side and coordinates when additions and removals share a number", () => {
    const documents = searchDocuments(
      [
        {
          path: "both.ts",
          rows: [
            { t: "del", o: 7, text: "old target" },
            { t: "add", n: 7, text: "new target" },
            { t: "ctx", o: 8, n: 9, text: "context target" },
          ],
        },
      ],
      [],
      new Map(),
      new Map(),
    );
    const hits = searchReview(documents, "target");
    expect(hits.map((r) => r.row)).toEqual(["o7", "n7", "n9"]);
    expect(hits[0]?.context).toBe("-old target\n+new target\n context target");
    expect(hits.every((r) => r.path === "both.ts")).toBe(true);
  });

  test("fuzzy code and conversation hits retain navigation and matching excerpts", () => {
    const documents = searchDocuments(
      [
        {
          path: "src/renderer.ts",
          rows: [
            { t: "add", n: 42, text: "const renderer = createRenderer();" },
          ],
        },
      ],
      [
        {
          id: "n",
          file: "src/renderer.ts",
          body: "Keep the renderer responsive.",
        },
      ],
      new Map([
        ["n", [{ role: "agent", body: "x".repeat(400) + " renderer fixed" }]],
      ]),
      new Map(),
    );
    const hits = searchReview(documents, "rendrer");
    expect(hits.find((hit) => hit.kind === "code")).toMatchObject({
      path: "src/renderer.ts",
      row: "n42",
    });
    expect(hits.find((hit) => hit.label === "Note")?.noteId).toBe("n");
    const reply = hits.find((hit) => hit.kind === "reply")!;
    expect(reply).toMatchObject({ noteId: "n", message: 0 });
    expect(searchExcerpt(reply.text, "rendrer", 90, reply.ranges)).toContain(
      "renderer fixed",
    );
  });

  test("literal matches keep source order ahead of fuzzy hits", () => {
    const documents = [
      { kind: "note" as const, path: "", text: "renderar", label: "Fuzzy" },
      { kind: "code" as const, path: "a.ts", text: "renderer", label: "First" },
      {
        kind: "reply" as const,
        path: "a.ts",
        text: "renderer",
        label: "Second",
      },
    ];
    expect(searchReview(documents, "renderer").map((hit) => hit.label)).toEqual(
      ["First", "Second", "Fuzzy"],
    );
  });

  test("a fuzzy filename does not return every row and still combines with code terms", () => {
    const documents = searchDocuments(
      [
        {
          path: "src/renderer.ts",
          rows: [
            { t: "ctx", n: 1, o: 1, text: "const unrelated = true;" },
            { t: "add", n: 2, text: "const output = responsiveLayout();" },
          ],
        },
      ],
      [],
      new Map(),
      new Map(),
    );
    expect(
      searchReview(documents, "rendrer.ts").map((hit) => hit.kind),
    ).toEqual(["file"]);
    expect(searchReview(documents, "rendrer.ts responiveLayout")).toMatchObject(
      [{ kind: "code", row: "n2", path: "src/renderer.ts" }],
    );
    expect(searchReview(documents, "zz")).toEqual([]);
  });
});
