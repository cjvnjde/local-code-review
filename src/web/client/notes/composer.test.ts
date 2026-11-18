import { expect, test } from "bun:test";
import {
  draftChanged,
  initializeDraft,
  withBody,
  type Draft,
} from "./composer.tsx";
import type { WebReview } from "../../../shared/web-review.ts";
import type { ReviewNote } from "../../../shared/review-types.ts";

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

test("classification changes and cleared text mark a draft as changed", () => {
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

const web: WebReview = {
  before: {
    url: "http://localhost:3000/",
    title: "Capture",
    at: "2026-01-01T00:00:00.000Z",
    mode: "point",
    rect: { x: 10, y: 10, width: 20, height: 20 },
    viewport: { width: 800, height: 600, dpr: 1 },
    scroll: { x: 0, y: 0 },
    components: [],
  },
  after: [],
};

test("capture-only notes and replies are protected before text is entered", () => {
  expect(
    draftChanged({
      kind: "note",
      comment: { file: "", start: 0, end: 0, body: "", web },
    }),
  ).toBe(true);
  expect(
    draftChanged({
      kind: "reply",
      id: "note",
      body: "",
      label: "1",
      file: "",
      web,
    }),
  ).toBe(true);
});

test("all editor hosts preserve the original note and reply when opening edits", () => {
  const note: ReviewNote = {
    id: "note",
    key: "UI note",
    file: "",
    label: "UI note",
    start: 0,
    end: 0,
    status: "pending",
    detail: "",
    body: "Original note",
    triage: "bug",
    web,
    messages: [{ role: "reviewer", at: "2026-01-01", body: "Original reply" }],
  };
  const review = { file: "/repo/.review/review.md", notes: [note] };
  const edit = initializeDraft(
    {
      kind: "note",
      comment: { ...note, start: 0, end: 0 },
    },
    review,
  );
  expect(edit.editing).toBe(true);
  expect(edit.review).toBe(review.file);
  expect(draftChanged(edit)).toBe(false);
  expect(
    draftChanged({
      ...edit,
      kind: "note",
      comment: { ...note, start: 0, end: 0, triage: "question" },
    }),
  ).toBe(true);
  const reply = initializeDraft(
    {
      kind: "reply",
      id: note.id,
      at: note.messages[0]!.at,
      body: "Original reply",
      file: "",
      label: "UI note",
    },
    review,
  );
  expect(draftChanged(reply)).toBe(false);
  expect(draftChanged(withBody(reply, ""))).toBe(true);
});
