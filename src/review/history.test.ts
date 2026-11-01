import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { collectGhosts, describeReviews } from "./history.ts";
import { renderMarkdown } from "./render.ts";
import { noteFromComment } from "./thread.ts";
import type { ReviewNote } from "./thread.ts";
import type { ReviewComment } from "../shared/review-types.ts";

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

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const workspace = async (files: Record<string, string>) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-history-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(dir, name), text, "utf8");
  return dir;
};

const settle = (note: ReviewNote): ReviewNote =>
  Object.assign(note, { status: "applied" as const });

describe("describeReviews", () => {
  test("each file is described by its context and how much of it is still open", async () => {
    const dir = await workspace({
      "review-2026-01-01T00-00-00.md": renderMarkdown({
        range: "main..HEAD",
        id: "auth-rework",
        branch: "feat",
        base: "abc123",
        notes: [
          settle(noteFromComment(line("a|n12|n12|#1"))),
          noteFromComment(line("a|n20|n20|#2")),
        ],
      }),
      "review-2026-01-02T00-00-00.md": renderMarkdown({
        range: "HEAD",
        notes: [],
      }),
      "notes.md": "not ours",
    });

    const infos = await describeReviews(dir, ".");
    expect(infos).toEqual([
      {
        file: "review-2026-01-01T00-00-00.md",
        range: "main..HEAD",
        id: "auth-rework",
        branch: "feat",
        base: "abc123",
        notes: 2,
        open: 1,
      },
      {
        file: "review-2026-01-02T00-00-00.md",
        range: "HEAD",
        id: "",
        branch: "",
        base: "",
        notes: 0,
        open: 0,
      },
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
        noteFromComment({
          id: "src/app.ts|*|*|#f1",
          file: "src/app.ts",
          body: "Split it.",
          scope: "file",
          start: 0,
          end: 0,
        }),
        noteFromComment({
          id: "|@|@|#o1",
          file: "",
          body: "Two things at once.",
          scope: "global",
          start: 0,
          end: 0,
        }),
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
    expect(ghosts[0]!.notes.map((note) => note.id)).toEqual([
      "a|n12|n12|#g1",
      "a|n20|n20|#g2",
    ]);
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
    const ghosts = await collectGhosts(dir, ".", {
      except: "",
      branch: "",
      taken: new Set(),
    });
    expect(ghosts).toHaveLength(4);
  });
});

describe("history retention boundaries", () => {
  test("both history consumers read only the newest twenty reviews, oldest first", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 23 }, (_, index) => {
        const stamp = String(index + 1).padStart(2, "0");
        return [
          `review-2026-01-${stamp}T00-00-00.md`,
          renderMarkdown({
            range: `HEAD~${index + 1}`,
            branch: "feat",
            notes: [noteFromComment(line(`src/app.ts|n12|n12|#${index + 1}`))],
          }),
        ];
      }),
    );
    const dir = await workspace(files);
    const expected = Object.keys(files).slice(3);
    expect((await describeReviews(dir, ".")).map((info) => info.file)).toEqual(
      expected,
    );
    const ghosts = await collectGhosts(dir, ".", {
      except: "",
      branch: "feat",
      taken: new Set(),
    });
    expect(ghosts.map((group) => group.file)).toEqual(expected);
    expect(ghosts[0]!.notes[0]!.id).toBe("src/app.ts|n12|n12|#4");
    expect(ghosts.at(-1)!.notes[0]!.id).toBe("src/app.ts|n12|n12|#23");
  });

  test("open counts include questions and unrecognized verdicts but exclude all terminal outcomes", async () => {
    const statuses = [
      "pending",
      "needs-input",
      "unknown",
      "applied",
      "answered",
      "skipped",
    ] as const;
    const notes = statuses.map((status, index) => {
      const note = noteFromComment(line(`src/app.ts|n12|n12|#${index}`));
      note.status = status;
      note.detail = status === "unknown" ? "waiting for staging" : "";
      return note;
    });
    const dir = await workspace({
      "review-1.md": renderMarkdown({ range: "HEAD", notes }),
    });
    expect(await describeReviews(dir, ".")).toEqual([
      {
        file: "review-1.md",
        range: "HEAD",
        id: "",
        branch: "",
        base: "",
        notes: 6,
        open: 3,
      },
    ]);
  });

  test("empty and unreadable review entries do not hide readable neighbors", async () => {
    const dir = await workspace({
      "review-1.md": "",
      "review-3.md": renderMarkdown({
        range: "HEAD",
        notes: [noteFromComment(line("a|n12|n12|#one"))],
      }),
    });
    await mkdir(path.join(dir, "review-2.md"));
    expect((await describeReviews(dir, ".")).map((info) => info.file)).toEqual([
      "review-3.md",
    ]);
    expect(
      (
        await collectGhosts(dir, ".", {
          except: "",
          branch: "",
          taken: new Set(),
        })
      ).map((group) => group.file),
    ).toEqual(["review-3.md"]);
  });

  test("taking every note removes an empty ghost group and provenance is scoped to its source file", async () => {
    const id = "src/app.ts|n12|n12|#shared";
    const text = renderMarkdown({
      range: "HEAD",
      notes: [noteFromComment(line(id))],
    });
    const dir = await workspace({ "review-1.md": text, "review-2.md": text });
    const ghosts = await collectGhosts(dir, ".", {
      except: "",
      branch: "feat",
      taken: new Set([`review-1.md#${id}`]),
    });
    expect(ghosts.map((group) => group.file)).toEqual(["review-2.md"]);
    expect(ghosts[0]!.notes.map((entry) => entry.id)).toEqual([id]);
    expect(
      await collectGhosts(dir, ".", {
        except: "review-2.md",
        branch: "",
        taken: new Set([`review-1.md#${id}`]),
      }),
    ).toEqual([]);
  });
});

test("ghost groups preserve known source branches while legacy groups remain branch-agnostic", async () => {
  const dir = await workspace({
    "review-1.md": renderMarkdown({
      range: "HEAD",
      branch: "feature/source",
      notes: [noteFromComment(line("src/app.ts|n12|n12|#known"))],
    }),
    "review-2.md": renderMarkdown({
      range: "HEAD~2",
      notes: [noteFromComment(line("src/app.ts|n12|n12|#legacy"))],
    }),
  });
  const groups = await collectGhosts(dir, ".", {
    except: "",
    branch: "",
    taken: new Set(),
  });
  expect(groups.map(({ file, branch }) => ({ file, branch }))).toEqual([
    { file: "review-1.md", branch: "feature/source" },
    { file: "review-2.md", branch: "" },
  ]);
});
