import { describe, expect, test } from "bun:test";
import { fuzzyScore, rankReferenceNotes } from "./ref-search.ts";

const note = (id: string, file: string, body: string) => ({ id, file, body });

describe("fuzzyScore", () => {
  test("matches ordered characters without requiring a literal substring", () => {
    expect(fuzzyScore("pnltx", "Panel.tsx")).toBeNumber();
    expect(fuzzyScore("xyz", "Panel.tsx")).toBeNull();
  });

  test("ranks a literal match above a scattered one", () => {
    expect(fuzzyScore("panel", "Panel.tsx")!).toBeGreaterThan(
      fuzzyScore("pnltx", "Panel.tsx")!,
    );
  });
});

describe("rankReferenceNotes", () => {
  test("searches the file name and all of the comment body", () => {
    const notes = [
      note(
        "body",
        "src/other.ts",
        "First line.\nThe resource handle leaks down here.",
      ),
      note("file", "src/resource-handler.ts", "Unrelated wording."),
      note("gone", "src/view.ts", "Nothing relevant."),
    ];
    expect(rankReferenceNotes(notes, "handle").map((n) => n.id)).toEqual([
      "file",
      "body",
    ]);
  });

  test("a fuzzy file-name match outranks an exact body-only match", () => {
    const notes = [
      note("body", "src/view.ts", "Panel rendering is broken."),
      note("file", "src/PanelRenderer.tsx", "The layout is broken."),
    ];
    expect(rankReferenceNotes(notes, "pnl").map((n) => n.id)).toEqual([
      "file",
      "body",
    ]);
    expect(rankReferenceNotes(notes, "panel").map((n) => n.id)).toEqual([
      "file",
      "body",
    ]);
  });

  test("query words may match across the file name and comment", () => {
    const notes = [
      note("mixed", "src/Panel.tsx", "The cleanup path leaks a listener."),
      note("partial", "src/Panel.tsx", "Use the shared colour token."),
    ];
    expect(rankReferenceNotes(notes, "pnl listener").map((n) => n.id)).toEqual([
      "mixed",
    ]);
  });

  test("an empty query keeps review order and a miss returns nothing", () => {
    const notes = [note("a", "a.ts", "Alpha"), note("b", "b.ts", "Beta")];
    expect(rankReferenceNotes(notes, " ")).toEqual(notes);
    expect(rankReferenceNotes(notes, "zqx")).toEqual([]);
  });
});

describe("reference ranking boundaries", () => {
  test("ordered characters cannot be reused and over-dispersed matches are rejected", () => {
    expect(fuzzyScore("aa", "a")).toBeNull();
    expect(fuzzyScore("ba", "ab")).toBeNull();
    expect(fuzzyScore("ab", "a" + ".".repeat(8) + "b")).not.toBeNull();
    expect(fuzzyScore("ab", "a" + ".".repeat(9) + "b")).toBeNull();
    expect(fuzzyScore("ab", "ab")).toBeGreaterThan(fuzzyScore("ab", "a_b")!);
    expect(fuzzyScore("token", " token")!).toBeGreaterThan(
      fuzzyScore("token", "xtoken")!,
    );
  });

  test("directory-only matches cannot impersonate file-name matches", () => {
    const notes = [
      note("directory", "panel/other.ts", "Nothing relevant"),
      note("body", "other.ts", "Panel needs cleanup"),
    ];
    expect(rankReferenceNotes(notes, "panel").map((n) => n.id)).toEqual([
      "body",
    ]);
  });

  test("matching all words and resolving ties preserve the review's objects and input order", () => {
    const notes = [
      note("first", "View.ts", "listener cleanup"),
      note("second", "View.ts", "listener cleanup"),
      note("partial", "View.ts", "listener"),
      note("missing", "Other.ts", "cleanup"),
    ];
    const original = [...notes];
    const ranked = rankReferenceNotes(notes, "  VIEW\tcleanup\nlistener ");
    expect(ranked.map((n) => n.id)).toEqual(["first", "second"]);
    expect(ranked[0]).toBe(notes[0]);
    expect(notes).toEqual(original);
    expect(rankReferenceNotes(notes, "view listener missing")).toEqual([]);
  });

  test("more file-name word matches outrank body matches even when query terms span fields", () => {
    const notes = [
      note("body", "view.ts", "panel listener"),
      note("mixed", "panel.ts", "listener"),
      note("file", "panel-listener.ts", "unrelated"),
    ];
    expect(
      rankReferenceNotes(notes, "panel listener").map((n) => n.id),
    ).toEqual(["file", "mixed", "body"]);
  });

  test("ranking prefers early exact occurrences and compact fuzzy paths within the same field", () => {
    const exact = [
      note("late", "other.ts", "prefix target"),
      note("early", "other.ts", "target suffix"),
    ];
    expect(rankReferenceNotes(exact, "target").map((n) => n.id)).toEqual([
      "early",
      "late",
    ]);
    const fuzzy = [
      note("scattered", "a__b__c.ts", ""),
      note("adjacent", "ab___c.ts", ""),
      note("late", "zzab___c.ts", ""),
    ];
    expect(rankReferenceNotes(fuzzy, "abc").map((n) => n.id)).toEqual([
      "adjacent",
      "late",
      "scattered",
    ]);
    expect(fuzzyScore("abc", "ab_c")!).toBeGreaterThan(
      fuzzyScore("abc", "a_b_c")!,
    );
    expect(fuzzyScore("abc", "ab_c")!).toBeGreaterThan(
      fuzzyScore("abc", "zab_c")!,
    );
    expect(fuzzyScore("abc", "a_b_c")!).toBeGreaterThan(
      fuzzyScore("abc", "a__b__c")!,
    );
  });

  test("fuzzy dispersion budget scales with the query rather than using only its minimum", () => {
    expect(fuzzyScore("abcd", "a....b....c....d")).not.toBeNull();
    expect(fuzzyScore("abcd", "a.....b....c....d")).toBeNull();
    expect(fuzzyScore("", null)).toBe(0);
    expect(fuzzyScore("null", null)).toBeNull();
    expect(fuzzyScore("undefined", undefined)).toBeNull();
    expect(fuzzyScore("é", "Éclair")).not.toBeNull();
  });

  test("relevance ordering applies to body-only matches as well as file matches", () => {
    const notes = [
      note("late", "unrelated.ts", "prefix target"),
      note("fuzzy", "unrelated.ts", "t_a_r_g_e_t"),
      note("first", "unrelated.ts", "target"),
      note("second", "unrelated.ts", "target"),
    ];
    expect(rankReferenceNotes(notes, "target").map((n) => n.id)).toEqual([
      "first",
      "second",
      "late",
      "fuzzy",
    ]);
    expect(
      rankReferenceNotes([{ body: "target" }, { body: "missing" }], "target"),
    ).toEqual([{ body: "target" }]);
  });
});
