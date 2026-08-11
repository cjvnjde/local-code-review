import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { collectGhosts, describeReviews } from "./history.ts";
import { renderMarkdown } from "./review.ts";
import { noteFromComment } from "./thread.ts";
import type { ReviewNote } from "./thread.ts";
import type { ReviewComment } from "./types.ts";

const line = (id: string, body = "Rename this."): ReviewComment => ({
  id,
  file: "src/app.ts",
  body,
  start: 12,
  end: 12,
  label: "12",
  side: "new",
  code: "+  const tmpValue = load();",
});

const workspace = async (files: Record<string, string>) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-history-"));
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text, "utf8");
  return dir;
};

const settle = (note: ReviewNote): ReviewNote => Object.assign(note, { status: "applied" as const });

describe("describeReviews", () => {
  test("each file is described by its context and how much of it is still open", async () => {
    const dir = await workspace({
      "review-2026-01-01T00-00-00.md": renderMarkdown({
        range: "main..HEAD",
        branch: "feat",
        base: "abc123",
        notes: [settle(noteFromComment(line("a|n12|n12|#1"))), noteFromComment(line("a|n20|n20|#2"))],
      }),
      "review-2026-01-02T00-00-00.md": renderMarkdown({ range: "HEAD", notes: [] }),
      "notes.md": "not ours",
    });

    const infos = await describeReviews(dir, ".");
    expect(infos).toEqual([
      {
        file: "review-2026-01-01T00-00-00.md",
        range: "main..HEAD",
        branch: "feat",
        base: "abc123",
        notes: 2,
        open: 1,
      },
      { file: "review-2026-01-02T00-00-00.md", range: "HEAD", branch: "", base: "", notes: 0, open: 0 },
    ]);
  });
});

describe("collectGhosts", () => {
  const files = () => ({
    // The session's own file: its notes are on the page already, not ghosts of anything.
    "review-2026-01-01T00-00-00.md": renderMarkdown({
      range: "HEAD",
      branch: "feat",
      notes: [noteFromComment(line("a|n12|n12|#own"))],
    }),
    "review-2026-01-02T00-00-00.md": renderMarkdown({
      range: "main..HEAD",
      branch: "feat",
      notes: [
        noteFromComment(line("a|n12|n12|#g1")),
        noteFromComment(line("a|n20|n20|#g2", "And this.")),
        // No line to be marked on: a whole-file note and an overall note stay in their own file.
        noteFromComment({ id: "src/app.ts|*|*|#f1", file: "src/app.ts", body: "Split it.", scope: "file", start: 0, end: 0 }),
        noteFromComment({ id: "|@|@|#o1", file: "", body: "Two things at once.", scope: "global", start: 0, end: 0 }),
      ],
    }),
    "review-2026-01-03T00-00-00.md": renderMarkdown({
      range: "main..HEAD",
      branch: "other",
      notes: [noteFromComment(line("a|n12|n12|#g3"))],
    }),
    // From before the branch field: offered rather than hidden.
    "review-2026-01-04T00-00-00.md": renderMarkdown({
      range: "HEAD~3",
      notes: [noteFromComment(line("a|n12|n12|#g4"))],
    }),
  });

  test("offers line notes from this branch's other reviews, and nothing from foreign branches", async () => {
    const dir = await workspace(files());
    const ghosts = await collectGhosts(dir, ".", {
      except: "review-2026-01-01T00-00-00.md",
      branch: "feat",
      taken: new Set(),
    });

    expect(ghosts.map((group) => group.file)).toEqual([
      "review-2026-01-02T00-00-00.md",
      "review-2026-01-04T00-00-00.md",
    ]);
    expect(ghosts[0]!.range).toBe("main..HEAD");
    expect(ghosts[0]!.notes.map((note) => note.id)).toEqual(["a|n12|n12|#g1", "a|n20|n20|#g2"]);
  });

  test("a note some current note already continues stays home", async () => {
    const dir = await workspace(files());
    const ghosts = await collectGhosts(dir, ".", {
      except: "review-2026-01-01T00-00-00.md",
      branch: "feat",
      taken: new Set(["review-2026-01-02T00-00-00.md#a|n12|n12|#g1"]),
    });

    expect(ghosts[0]!.notes.map((note) => note.id)).toEqual(["a|n20|n20|#g2"]);
  });

  test("an unknown branch offers every review rather than none", async () => {
    const dir = await workspace(files());
    const ghosts = await collectGhosts(dir, ".", { except: "", branch: "", taken: new Set() });
    expect(ghosts).toHaveLength(4);
  });
});
