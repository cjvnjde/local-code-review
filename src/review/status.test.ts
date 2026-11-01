import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render.ts";
import { noteFromComment } from "./thread.ts";
import { collectStatuses, parseStatuses } from "./status.ts";
import type { ReviewComment } from "../shared/review-types.ts";
import { mintNoteId, noteKey } from "../web/client/app/state.ts";

const roots: string[] = [];
const workspace = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-status-"));
  roots.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const review = (...sections: string[]) =>
  ["# Review notes", "", ...sections].join("\n");
const write = (comments: ReviewComment[]) =>
  renderMarkdown({ range: "HEAD", notes: comments.map(noteFromComment) });

describe("parseStatuses", () => {
  test("reads the id marker, verdict, and detail of each note", () => {
    const parsed = parseStatuses(
      review(
        "### src/app.ts:2:9-16 <!-- lcr:src/app.ts|n2|n2|8-16 -->",
        "",
        "Rename this.",
        "",
        "Status: applied — renamed to profile",
        "",
        "### src/app.ts:9 <!-- lcr:src/app.ts|n9|n9 -->",
        "",
        "Status: skipped — the helper is already memoised",
        "",
        "### src/other.ts:4 (line numbers before the change)",
        "",
        "Status: needs-input: which callers still use it?",
        "",
      ),
      "review-1.md",
    );

    expect(parsed).toEqual([
      {
        id: "src/app.ts|n2|n2|8-16",
        key: "src/app.ts:2:9-16",
        status: "applied",
        detail: "renamed to profile",
        source: "review-1.md",
      },
      {
        id: "src/app.ts|n9|n9",
        key: "src/app.ts:9",
        status: "skipped",
        detail: "the helper is already memoised",
        source: "review-1.md",
      },
      {
        id: "",
        key: "src/other.ts:4",
        status: "needs-input",
        detail: "which callers still use it?",
        source: "review-1.md",
      },
    ]);
  });

  test("drops untouched notes and accepts common synonyms", () => {
    const parsed = parseStatuses(
      review(
        "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->",
        "",
        "Status: pending",
        "",
        "### b.ts:1 <!-- lcr:b.ts|n1|n1 -->",
        "",
        "Status: Done",
        "",
        "### c.ts:1 <!-- lcr:c.ts|n1|n1 -->",
        "",
        "Status: rejected",
        "",
        "### d.ts:1 <!-- lcr:d.ts|n1|n1 -->",
        "",
        "Status: half way there",
        "",
        "### e.ts:1 <!-- lcr:e.ts|n1|n1 -->",
        "",
        "Status: by design",
        "",
      ),
    );
    expect(
      parsed.map((entry) => [entry.key, entry.status, entry.detail]),
    ).toEqual([
      ["b.ts:1", "applied", ""],
      ["c.ts:1", "skipped", ""],
      ["d.ts:1", "unknown", "half way there"],
      ["e.ts:1", "answered", ""],
    ]);
  });

  test("reads an answer to a question-only note", () => {
    const parsed = parseStatuses(
      review(
        "### src/db.ts:12 <!-- lcr:src/db.ts|n12|n12 -->",
        "",
        "Why is this retry here?",
        "",
        "Status: answered — the driver throws on cold start, covered by db.test.ts",
        "",
      ),
      "review-1.md",
    );

    expect(parsed).toEqual([
      {
        id: "src/db.ts|n12|n12",
        key: "src/db.ts:12",
        status: "answered",
        detail: "the driver throws on cold start, covered by db.test.ts",
        source: "review-1.md",
      },
    ]);
  });

  test("takes the last status line so an appended verdict wins", () => {
    const parsed = parseStatuses(
      review(
        "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->",
        "",
        "Status: pending",
        "",
        "Status: applied — done later",
        "",
      ),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.status).toBe("applied");
  });

  test("ignores headings and status lines inside captured code", () => {
    const parsed = parseStatuses(
      review(
        "### docs/guide.md:8 <!-- lcr:docs/guide.md|n8|n8 -->",
        "",
        "```diff",
        "+### Not a note heading",
        "+Status: applied",
        "```",
        "",
        "Reword this section.",
        "",
        "Status: needs-input — which audience?",
        "",
      ),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      key: "docs/guide.md:8",
      status: "needs-input",
      detail: "which audience?",
    });
  });

  test("does not carry a status across a file heading", () => {
    expect(
      parseStatuses(
        review(
          "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->",
          "",
          "Talk about it.",
          "",
          "## b.ts",
          "",
          "Status: applied",
          "",
        ),
      ),
    ).toEqual([]);
  });

  test("round-trips the ids that renderMarkdown writes", () => {
    const markdown = write([
      {
        id: "src/app.ts|n2|n2|8-16",
        file: "src/app.ts",
        body: "Rename it.",
        start: 2,
        end: 2,
        label: "2:9-16",
        snippet: "tmpValue",
      },
    ]);

    expect(markdown).toContain(
      "### src/app.ts:2:9-16 <!-- lcr:src/app.ts|n2|n2|8-16 -->",
    );
    expect(markdown).toContain("Status: pending");
    const answered = markdown.replace(
      "Status: pending",
      "Status: applied — renamed",
    );
    expect(parseStatuses(answered)).toEqual([
      {
        id: "src/app.ts|n2|n2|8-16",
        key: "src/app.ts:2:9-16",
        status: "applied",
        detail: "renamed",
        source: "",
      },
    ]);
  });

  test("round-trips a whole-file note by id and by heading key", () => {
    const note = {
      id: mintNoteId("src/app.ts", "*", "*"),
      file: "src/app.ts",
      body: "Split this module.",
      a: "*",
      b: "*",
      scope: "file" as const,
      start: 0,
      end: 0,
    };
    const markdown = write([note]).replace(
      "Status: pending",
      "Status: applied — split into two modules",
    );

    expect(parseStatuses(markdown)).toEqual([
      {
        id: note.id,
        key: noteKey(note),
        status: "applied",
        detail: "split into two modules",
        source: "",
      },
    ]);
  });

  test("two notes on one line round-trip as separate headings with distinct ids", () => {
    const at = (body: string) => ({
      id: mintNoteId("src/app.ts", "n7", "n7"),
      file: "src/app.ts",
      body,
      a: "n7",
      b: "n7",
      start: 7,
      end: 7,
    });
    const first = at("Rename it."),
      second = at("And handle the null case.");
    const markdown = write([first, second])
      .replace("Status: pending", "Status: applied — renamed")
      .replace("Status: pending", "Status: skipped — cannot be null here");

    expect(first.id).not.toBe(second.id);
    expect(parseStatuses(markdown)).toEqual([
      {
        id: first.id,
        key: "src/app.ts:7",
        status: "applied",
        detail: "renamed",
        source: "",
      },
      {
        id: second.id,
        key: "src/app.ts:7",
        status: "skipped",
        detail: "cannot be null here",
        source: "",
      },
    ]);
  });
});

describe("collectStatuses", () => {
  test("merges review files oldest first and ignores other files", async () => {
    const dir = await workspace();
    await writeFile(
      path.join(dir, "review-2026-01-01T00-00-00.md"),
      review(
        "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->",
        "",
        "Status: skipped — not yet",
        "",
      ),
      "utf8",
    );
    await writeFile(
      path.join(dir, "review-2026-02-01T00-00-00.md"),
      review(
        "### a.ts:1 <!-- lcr:a.ts|n1|n1 -->",
        "",
        "Status: applied — done now",
        "",
      ),
      "utf8",
    );
    await writeFile(
      path.join(dir, "notes.md"),
      review("### a.ts:1", "", "Status: applied", ""),
      "utf8",
    );

    const parsed = await collectStatuses(dir, ".");
    expect(parsed.map((entry) => [entry.source, entry.status])).toEqual([
      ["review-2026-01-01T00-00-00.md", "skipped"],
      ["review-2026-02-01T00-00-00.md", "applied"],
    ]);
  });

  test("returns nothing when the output directory is missing", async () => {
    expect(
      await collectStatuses(path.join(tmpdir(), "lcr-missing-dir"), "nope"),
    ).toEqual([]);
  });
});

describe("status interpretation boundaries", () => {
  test.each([
    [
      "FIXED. : renamed: all callers — including tests",
      "applied",
      "renamed: all callers — including tests",
    ],
    ["needs clarification – select one", "needs-input", "select one"],
    ["won't-fix -- outside scope", "skipped", "outside scope"],
    ["as designed - no change required", "answered", "no change required"],
    ["implemented — done", "applied", "done"],
    [
      "waiting: for staging — not final",
      "unknown",
      "waiting: for staging — not final",
    ],
    ["applied-ish", "unknown", "applied-ish"],
  ])(
    "interprets the verdict without losing detail: %s",
    (raw, status, detail) => {
      expect(
        parseStatuses(
          review(
            "### src/app.ts:12 <!-- lcr:src/app.ts|n12|n12|#status -->",
            "",
            `  sTaTuS : ${raw}`,
          ),
          "review-source.md",
        ),
      ).toEqual([
        {
          id: "src/app.ts|n12|n12|#status",
          key: "src/app.ts:12",
          status,
          detail,
          source: "review-source.md",
        },
      ]);
    },
  );

  test("an appended reopening verdict removes the previously settled status", () => {
    expect(
      parseStatuses(
        review(
          "### src/app.ts:12 <!-- lcr:src/app.ts|n12|n12|#status -->",
          "Status: applied — initial result",
          "",
          "Status: open",
        ),
      ),
    ).toEqual([]);
  });

  test("overall and legacy headings retain independent matching keys", () => {
    expect(
      parseStatuses(
        review(
          "## Overall",
          "### Overall note <!-- lcr:|@|@|#overall -->",
          "Status: answered — explained",
          "",
          "## src/app.ts",
          "### src/app.ts:12-14:2-8 (line numbers before the change)",
          "Status: skipped — historical",
        ),
        "review-legacy.md",
      ),
    ).toEqual([
      {
        id: "|@|@|#overall",
        key: "Overall note",
        status: "answered",
        detail: "explained",
        source: "review-legacy.md",
      },
      {
        id: "",
        key: "src/app.ts:12-14:2-8",
        status: "skipped",
        detail: "historical",
        source: "review-legacy.md",
      },
    ]);
  });

  test("status collection caps file reads, retaining chronological outcomes and source identity", async () => {
    const dir = await workspace();
    const names = Array.from(
      { length: 22 },
      (_, index) => `review-${String(index).padStart(2, "0")}.md`,
    );
    for (const [index, name] of names.entries()) {
      await writeFile(
        path.join(dir, name),
        review(
          "### src/app.ts:12 <!-- lcr:src/app.ts|n12|n12|#same -->",
          `Status: ${index % 2 ? "applied" : "skipped"} — turn ${index}`,
        ),
      );
    }
    const all = await collectStatuses(dir, ".");
    expect(all).toHaveLength(20);
    expect(all.map((entry) => entry.source)).toEqual(names.slice(2));
    expect(all[0]).toMatchObject({ status: "skipped", detail: "turn 2" });
    expect(all.at(-1)).toMatchObject({ status: "applied", detail: "turn 21" });
    expect(
      (await collectStatuses(dir, ".", 1)).map((entry) => entry.source),
    ).toEqual(names.slice(-1));
    expect(
      (await collectStatuses(dir, ".", 3)).map((entry) => entry.source),
    ).toEqual(names.slice(-3));
    expect(
      (await collectStatuses(dir, ".", 30)).map((entry) => entry.source),
    ).toEqual(names);
  });

  test("empty and unreadable files consume the recent-file window without resurrecting older statuses", async () => {
    const dir = await workspace();
    await writeFile(
      path.join(dir, "review-1.md"),
      review("### a.ts:1", "Status: applied"),
    );
    await writeFile(path.join(dir, "review-2.md"), "");
    await mkdir(path.join(dir, "review-3.md"));
    expect(await collectStatuses(dir, ".", 2)).toEqual([]);
    expect(await collectStatuses(dir, ".", 3)).toEqual([
      {
        id: "",
        key: "a.ts:1",
        status: "applied",
        detail: "",
        source: "review-1.md",
      },
    ]);
  });
});

test.each([
  "not-applied",
  "unanswered",
  "answered-later",
  "not-skipped",
  "skipped-later",
  "unblocked",
  "needs-input-later",
])(
  "a verdict containing but not equal to a recognized outcome stays unknown: %s",
  (raw) => {
    expect(
      parseStatuses(
        review(
          "### a.ts:12 <!-- lcr:a.ts|n12|n12|#status -->",
          `Status: ${raw}`,
        ),
      ),
    ).toEqual([
      {
        id: "a.ts|n12|n12|#status",
        key: "a.ts:12",
        status: "unknown",
        detail: raw,
        source: "",
      },
    ]);
  },
);
