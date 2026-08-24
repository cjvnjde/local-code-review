import { beforeEach, describe, expect, test } from "bun:test";
import { isMinted, markSubmitted, mintNoteId, pathHtml, reindexNotes, reviewTime, state, statusOf } from "./state.ts";

const OLD = ".review/review-2026-01-01T10-00-00.md";
const NEW = ".review/review-2026-02-02T10-00-00.md";

const lineNote = (line: number, body: string) => ({
  id: mintNoteId("src/app.ts", "n" + line, "n" + line),
  file: "src/app.ts",
  body,
  a: "n" + line,
  b: "n" + line,
  start: line,
  end: line,
});
const applied = (id: string, key: string, source: string) =>
  ({ id, key, status: "applied", detail: "done", source });

const put = (...notes: any[]) => {
  state.notes = new Map(notes.map((n) => [n.id, n]));
  reindexNotes();
};

describe("mintNoteId", () => {
  test("two notes on the same line get different ids", () => {
    const a = mintNoteId("src/app.ts", "n7", "n7");
    const b = mintNoteId("src/app.ts", "n7", "n7");
    expect(a).not.toBe(b);
    expect(a.startsWith("src/app.ts|n7|n7|#")).toBe(true);
    expect(isMinted(a)).toBe(true);
    expect(isMinted("src/app.ts|n7|n7")).toBe(false);
  });

  test("a character range stays part of the location it was minted from", () => {
    expect(mintNoteId("src/app.ts", "n7", "n7", 4, 9).startsWith("src/app.ts|n7|n7|4-9|#")).toBe(true);
  });
});

describe("pathHtml", () => {
  test("the folders and the file name are separate boxes, so the cut lands between them", () => {
    expect(pathHtml("apps/web/components/Panel.tsx")).toBe(
      '<span class="dir">apps/web/components</span><span class="base">/Panel.tsx</span>',
    );
  });

  test("a path with no folder is the name alone", () => {
    expect(pathHtml("README.md")).toBe('<span class="base">README.md</span>');
  });

  test("the slash stays with the name, so a truncated path still reads as one", () => {
    expect(pathHtml("a/b.ts")).toContain('<span class="base">/b.ts</span>');
  });

  test("a path is escaped like anything else drawn into the page", () => {
    expect(pathHtml('src/<img>&"/x".ts')).toBe(
      '<span class="dir">src/&lt;img&gt;&amp;&quot;</span><span class="base">/x&quot;.ts</span>',
    );
  });
});

describe("reviewTime", () => {
  test("reads the stamp out of a review file name and shrugs at anything else", () => {
    expect(reviewTime(OLD)).toBe(Date.parse("2026-01-01T10:00:00Z"));
    expect(reviewTime("notes.md")).toBe(0);
    expect(reviewTime("")).toBe(0);
  });
});

describe("statusOf", () => {
  beforeEach(() => {
    state.status = new Map();
    state.statusByKey = new Map();
    put();
  });

  test("a verdict reaches the note whose id it names", () => {
    const note = lineNote(7, "Rename it.");
    put(note);
    state.status = new Map([[note.id, applied(note.id, "src/app.ts:7", OLD)]]);

    expect(statusOf(note)).toMatchObject({ status: "applied" });
  });

  test("a note written where a handled one stood reads as pending", () => {
    const handled = lineNote(7, "Rename it.");
    put(handled);
    markSubmitted(OLD);
    state.status = new Map([[handled.id, applied(handled.id, "src/app.ts:7", OLD)]]);
    state.statusByKey = new Map([["src/app.ts:7", applied(handled.id, "src/app.ts:7", OLD)]]);
    expect(statusOf(handled)).toMatchObject({ status: "applied" });

    // The notes were cleared and a new one written on the same line, then handed over in its own review.
    const fresh = lineNote(7, "Also handle the null case.");
    put(fresh);
    markSubmitted(NEW);

    expect(statusOf(fresh)).toBeNull();
  });

  test("the heading fallback needs a submitted note and an unambiguous heading", () => {
    const note = lineNote(7, "Rename it.");
    put(note);
    state.statusByKey = new Map([["src/app.ts:7", applied("lost-marker", "src/app.ts:7", NEW)]]);
    expect(statusOf(note)).toBeNull(); // never handed over, so nothing can have been reported

    markSubmitted(OLD);
    expect(statusOf(note)).toMatchObject({ status: "applied" });

    const second = lineNote(7, "And handle the null case.");
    put(note, second);
    markSubmitted(OLD);
    expect(statusOf(note)).toBeNull(); // the heading no longer says which of the two
    expect(statusOf(second)).toBeNull();
  });

  test("an id match still wins when the heading is shared", () => {
    const first = lineNote(7, "Rename it.");
    const second = lineNote(7, "And handle the null case.");
    put(first, second);
    markSubmitted(OLD);
    state.status = new Map([[second.id, applied(second.id, "src/app.ts:7", NEW)]]);

    expect(statusOf(first)).toBeNull();
    expect(statusOf(second)).toMatchObject({ status: "applied" });
  });

  test("a note is reportable from the review it was first handed over in", () => {
    const note = lineNote(7, "Rename it.");
    put(note);
    markSubmitted(OLD);
    markSubmitted(NEW); // still open in a later review; the first handover is what counts
    state.statusByKey = new Map([["src/app.ts:7", applied("lost-marker", "src/app.ts:7", OLD)]]);

    expect(statusOf(note)).toMatchObject({ status: "applied" });
  });
});
