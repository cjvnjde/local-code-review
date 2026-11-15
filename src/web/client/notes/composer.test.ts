import { expect, test } from "bun:test";
import { draftChanged, withBody, type Draft } from "./composer.tsx";

const draft: Draft = {
  kind: "note",
  editing: true,
  original: "Keep this behavior.",
  originalTriage: "bug",
  comment: {
    id: "src/a.ts|n1|n1|#draft",
    file: "src/a.ts",
    start: 1,
    end: 1,
    body: "Keep this behavior.",
    triage: "bug",
  },
};

test("classification-only edits and clearing protect the draft from navigation and Escape", () => {
  expect(draftChanged(draft)).toBe(false);
  expect(
    draftChanged({
      ...draft,
      comment: { ...draft.comment, triage: "blocker" },
    }),
  ).toBe(true);
  expect(
    draftChanged({
      ...draft,
      comment: { ...draft.comment, triage: undefined },
    }),
  ).toBe(true);
  expect(draftChanged(withBody(draft, "A revised question."))).toBe(true);
});

test("typing preserves classification while reply drafts have only a body dirty state", () => {
  const edited = withBody(draft, "More detail.");
  expect(edited.kind === "note" && edited.comment.triage).toBe("bug");
  const reply: Draft = {
    kind: "reply",
    id: "note",
    body: "",
    label: "1",
    file: "src/a.ts",
  };
  expect(draftChanged(reply)).toBe(false);
  expect(draftChanged(withBody(reply, "Follow-up"))).toBe(true);
});
