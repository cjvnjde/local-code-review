import { describe, expect, test } from "bun:test";
import {
  historyChanges,
  historyMatches,
  historyScope,
  historyScopeLabel,
  historySnapshot,
  historySummary,
  historyText,
} from "./history-model.ts";
import { historyRevision } from "./history-store.ts";

const note = {
  id: "src/a.ts|n1|n1|#a",
  file: "src/a.ts",
  label: "1",
  start: 1,
  end: 1,
  body: "Why is this needed?",
};
const snapshot = (notes: any[], file = "review.md") =>
  historySnapshot(file, notes);
const revision = (
  before: any[],
  after: any[],
  source: "page" | "file" = "page",
) =>
  historyRevision(
    { scope: "r", source, snapshot: snapshot(after), at: 42 },
    snapshot(before),
  )!;

describe("review history revisions", () => {
  test("keeps screenshot coordinates and captures detached and records region changes", () => {
    const image = {
      side: "new",
      x: 0,
      y: 300,
      width: 20,
      height: 40,
      imageWidth: 100,
      imageHeight: 2000,
      source: "abc",
      capture: "images/area.png",
    };
    const saved = snapshot([{ ...note, image }]);
    image.y = 400;
    expect(saved.notes[0]!.image?.y).toBe(300);
    const changes = historyChanges(
      saved.notes,
      snapshot([{ ...note, image }]).notes,
    );
    expect(changes[0]!.kinds).toEqual(["Location or captured code changed"]);
  });
  test("keeps a detached copy of questions, captured code, anchors and conversations", () => {
    const input = {
      ...note,
      ca: 2,
      cb: 5,
      snippet: "foo",
      code: "const foo=1;",
      status: "answered",
      detail: "Because.",
      messages: [{ role: "agent", at: "now", body: "It protects the save." }],
    };
    const saved = snapshot([input]);
    input.body = "Changed";
    input.messages[0]!.body = "Removed answer";
    expect(saved.notes[0]).toMatchObject({
      body: note.body,
      ca: 2,
      cb: 5,
      snippet: "foo",
      code: "const foo=1;",
      status: "answered",
      detail: "Because.",
      messages: [{ role: "agent", at: "now", body: "It protects the save." }],
    });
  });
  test("a removed question and answer survive in the before version", () => {
    const before = {
      ...note,
      messages: [{ role: "agent", body: "Original answer" }],
    };
    const entry = revision([before], []);
    expect(entry.changes[0]!.kinds).toEqual(["Note removed"]);
    expect(entry.changes[0]!.before?.messages[0]?.body).toBe("Original answer");
    expect(entry.snapshot.notes).toEqual([]);
    expect(historyMatches(entry, "original answer")).toBe(true);
  });
  test("question edits, status changes and AI answers are described separately", () => {
    const entry = revision(
      [note],
      [
        {
          ...note,
          body: "Please explain",
          status: "answered",
          messages: [{ role: "agent", body: "Here is why." }],
        },
      ],
    );
    expect(entry.changes[0]!.kinds).toEqual([
      "Question edited",
      "Status changed",
      "AI answered",
    ]);
    expect(entry.changes[0]!.before?.body).toBe(note.body);
    expect(entry.changes[0]!.after?.body).toBe("Please explain");
  });
  test("editing and removing either side of a conversation leaves the old text available", () => {
    const before = {
      ...note,
      messages: [
        { role: "agent", at: "a", body: "Answer" },
        { role: "reviewer", at: "b", body: "Follow-up" },
      ],
    };
    const removed = { ...before, messages: [before.messages[1]] };
    expect(revision([before], [removed], "file").changes[0]!.kinds).toEqual([
      "Answer removed",
    ]);
    const edited = {
      ...before,
      messages: [
        before.messages[0],
        { role: "reviewer", at: "b", body: "Corrected follow-up" },
      ],
    };
    const entry = revision([before], [edited]);
    expect(entry.changes[0]!.kinds).toEqual(["Conversation edited"]);
    expect(historyMatches(entry, "Follow-up", note.id)).toBe(true);
    expect(historyMatches(entry, "Follow-up", "other-note")).toBe(false);
  });
  test("no-op reloads, note ordering, submission stamps and reading marks make no revision", () => {
    const other = { ...note, id: "other", body: "Other" };
    const first = snapshot([note, other]);
    const next = snapshot([
      { ...other, seen: 7 },
      { ...note, sentAt: 123, unread: 4, delivery: "queued" },
    ]);
    expect(next).toEqual(first);
    expect(
      historyRevision({ scope: "r", source: "page", snapshot: next }, first),
    ).toBeNull();
  });
  test("closing or deleting a review retains the full preceding conversation", () => {
    const before = snapshot([
      { ...note, messages: [{ role: "agent", body: "Keep this." }] },
    ]);
    const entry = historyRevision(
      { scope: "r", source: "file", snapshot: snapshot([], "") },
      before,
    )!;
    expect(entry.reason).toContain("removed or closed");
    expect(entry.beforeFile).toBe("review.md");
    expect(entry.changes[0]!.before?.messages[0]?.body).toBe("Keep this.");
  });
  test("a new review gets a boundary without changing any previous snapshot", () => {
    const before = snapshot([note], "first.md");
    const entry = historyRevision(
      { scope: "r", source: "page", snapshot: snapshot([note], "second.md") },
      before,
    )!;
    expect(entry.changes).toEqual([]);
    expect(entry.beforeFile).toBe("first.md");
    expect(entry.snapshot.file).toBe("second.md");
    expect(before.file).toBe("first.md");
  });
  test("repository and named review scopes cannot collide with ranges", () => {
    expect(historyScope("repo-a", "HEAD", "")).not.toBe(
      historyScope("repo-b", "HEAD", ""),
    );
    expect(historyScope("repo-a", "HEAD", "review")).toBe(
      historyScope("repo-a", "main..HEAD", "review"),
    );
    expect(historyScope("a:b", "c", "")).not.toBe(historyScope("a", "b:c", ""));
  });
  test("new notes on a previously deleted anchor are additions by their minted ids", () => {
    const before = snapshot([note]),
      after = snapshot([{ ...note, id: "src/a.ts|n1|n1|#b" }]);
    expect(
      historyChanges(before.notes, after.notes).map((c) => c.kinds[0]),
    ).toEqual(["Note removed", "Note added"]);
  });
});

describe("history filtering and exports", () => {
  test.each([
    ['["repo","main..HEAD"]', "main..HEAD"],
    ['["repo","#named review"]', "#named review"],
    ["legacy:scope", "legacy:scope"],
    ['{"range":"HEAD"}', '{"range":"HEAD"}'],
  ])(
    "labels persisted scope %s without losing legacy records",
    (scope, label) => {
      expect(historyScopeLabel(scope)).toBe(label);
    },
  );

  test("a verdict detail edit is a status change even when its kind stays the same", () => {
    const entry = revision(
      [{ ...note, status: "needs-input", detail: "Which branch?" }],
      [{ ...note, status: "needs-input", detail: "Which base commit?" }],
    );
    expect(entry.changes[0]!.kinds).toEqual(["Status changed"]);
    expect(historyMatches(entry, " WHICH BRANCH? ")).toBe(true);
    expect(historyMatches(entry, "base commit")).toBe(true);
    expect(historyMatches(entry, "not in the conversation")).toBe(false);
  });

  test.each([
    ["reviewer", [], [{ role: "reviewer", body: "Follow-up" }], "Reply added"],
    [
      "reviewer",
      [{ role: "reviewer", body: "Follow-up" }],
      [],
      "Reply removed",
    ],
    ["agent", [], [{ role: "agent", body: "Answer" }], "AI answered"],
    ["agent", [{ role: "agent", body: "Answer" }], [], "Answer removed"],
  ])(
    "classifies %s conversation transitions independently of note edits",
    (_role, before, after, kind) => {
      const entry = revision(
        [{ ...note, messages: before }],
        [{ ...note, messages: after }],
      );
      expect(entry.changes[0]!.kinds).toEqual([kind]);
    },
  );

  test("exports a deleted conversation from changes without restoring it into the snapshot", () => {
    const entry = revision(
      [
        {
          ...note,
          body: "Keep this question",
          status: "answered",
          detail: "No code change required",
          messages: [
            { role: "agent", body: "Original answer" },
            { role: "reviewer", body: "Clarification" },
          ],
        },
      ],
      [],
    );
    const exported = historyText(entry, "changes", note.id);
    expect(exported).toContain("Keep this question");
    expect(exported).toContain("No code change required");
    expect(exported).toContain("Original answer");
    expect(exported).toContain("Clarification");
    expect(historyText(entry, "snapshot", note.id)).toBe("");
    expect(historyText(entry, "changes", "another-note")).toBe("");
    expect(entry.snapshot.notes).toEqual([]);
  });

  test("snapshot exports select the current note, not its older wording or another note", () => {
    const entry = revision(
      [note],
      [
        { ...note, body: "Current wording" },
        { ...note, id: "other", body: "Unrelated question" },
      ],
    );
    const exported = historyText(entry, "snapshot", note.id);
    expect(exported).toContain("Current wording");
    expect(exported).not.toContain(note.body);
    expect(exported).not.toContain("Unrelated question");
    expect(historyText(entry, "snapshot")).toContain("Unrelated question");
    expect(historyMatches(entry, "", "missing")).toBe(false);
    expect(historyMatches(entry, "  ", note.id)).toBe(true);
  });

  test("summaries retain an explicit review boundary instead of replacing it with note changes", () => {
    const entry = revision([note], [{ ...note, body: "Reworded" }]);
    expect(
      historySummary({ ...entry, reason: "A different review opened" }),
    ).toBe("A different review opened");
    expect(
      historySummary({
        reason: "",
        changes: [
          ...entry.changes,
          ...entry.changes,
          { id: "another", kinds: ["Status changed"] },
        ],
      }),
    ).toBe("Question edited · Status changed");
  });
});

describe("history snapshot invariants", () => {
  test("a removed-side anchor and an added-side anchor remain distinct revisions", () => {
    const before = snapshot([{ ...note, side: "old", start: 4, end: 8 }]);
    const after = snapshot([{ ...note, side: "new", start: 14, end: 18 }]);
    expect(before.notes[0]).toMatchObject({ side: "old", start: 4, end: 8 });
    expect(after.notes[0]).toMatchObject({ side: "new", start: 14, end: 18 });
    expect(historyChanges(before.notes, after.notes)[0]!.kinds).toEqual([
      "Location or captured code changed",
    ]);
  });

  test("unidentified records do not become notes or prevent identified records from being recorded", () => {
    const saved = snapshot([null, undefined, {}, { id: 42 }, note]);
    expect(saved.notes.map((n) => n.id)).toEqual([note.id]);
  });

  test("mixed message additions and removals preserve the distinction between answers and follow-ups", () => {
    const original = { role: "reviewer", at: "first", body: "Question detail" };
    const agent = { role: "agent", at: "second", body: "Answer" };
    const followup = { role: "reviewer", at: "third", body: "Follow-up" };
    const added = revision(
      [{ ...note, messages: [original] }],
      [{ ...note, messages: [original, agent, followup] }],
    );
    expect(added.changes[0]!.kinds).toEqual(["AI answered"]);
    const removed = revision(
      [{ ...note, messages: [original, agent, followup] }],
      [{ ...note, messages: [original] }],
    );
    expect(removed.changes[0]!.kinds).toEqual(["Answer removed"]);
  });

  test("a note filter finds its own changes in a revision which also changed other notes", () => {
    const other = { ...note, id: "other", body: "Second question" };
    const entry = revision(
      [note, other],
      [
        { ...note, body: "First revised" },
        { ...other, body: "Second revised" },
      ],
    );
    expect(historyMatches(entry, "first revised", note.id)).toBe(true);
    const exported = historyText(entry, "changes", note.id);
    expect(exported).toContain(note.body);
    expect(exported).toContain("First revised");
    expect(exported).not.toContain("Second question");
    expect(exported).not.toContain("Second revised");
  });
});
