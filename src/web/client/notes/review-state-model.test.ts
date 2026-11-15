import { describe, expect, test } from "bun:test";
import type {
  ReviewMessage,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { canResolve } from "./review-state.tsx";
import {
  isResolved,
  reviewRevision,
  unreadAgentMessages,
} from "./review-state-model.ts";

const pending: ReviewNote = {
  id: "src/example.ts|7|7|#abc123",
  key: "src/example.ts:7",
  file: "src/example.ts",
  label: "7",
  start: 7,
  end: 7,
  body: "Please simplify this condition.",
  status: "pending",
  detail: "",
  messages: [],
};

test("triage changes never invalidate manual reviewer acknowledgement", () => {
  const acknowledgement = reviewRevision(pending);
  for (const triage of [
    "blocker",
    "bug",
    "suggestion",
    "question",
    undefined,
  ] as const)
    expect(isResolved({ ...pending, triage }, acknowledgement)).toBe(true);
});
const reviewer: ReviewMessage = {
  role: "reviewer",
  at: "2026-11-15T10:00:00Z",
  body: "More context.",
};
const agent: ReviewMessage = {
  role: "agent",
  at: "2026-11-15T10:01:00Z",
  body: "Updated.",
};

describe("incoming conversation unread state", () => {
  test("reviewer replies never create unread messages", () => {
    expect(unreadAgentMessages(pending)).toBe(0);
    expect(
      unreadAgentMessages({ ...pending, messages: [reviewer, reviewer] }),
    ).toBe(0);
  });

  test("seen indices retain their meaning in mixed-role conversations", () => {
    const note = { ...pending, messages: [reviewer, agent, reviewer, agent] };
    expect(unreadAgentMessages(note)).toBe(2);
    expect(unreadAgentMessages(note, 1)).toBe(2);
    expect(unreadAgentMessages(note, 2)).toBe(1);
    expect(unreadAgentMessages(note, 3)).toBe(1);
    expect(unreadAgentMessages(note, note.messages.length)).toBe(0);
  });

  test("only an incoming agent reply becomes unread after reading", () => {
    const read = { ...pending, messages: [reviewer, agent] };
    const ownReply = { ...read, messages: [...read.messages, reviewer] };
    expect(unreadAgentMessages(ownReply, read.messages.length)).toBe(0);
    const incoming = { ...ownReply, messages: [...ownReply.messages, agent] };
    expect(unreadAgentMessages(incoming, read.messages.length)).toBe(1);
    expect(unreadAgentMessages(incoming, incoming.messages.length)).toBe(0);
  });

  test("removed conversation messages cannot produce negative unread", () => {
    expect(unreadAgentMessages({ ...pending, messages: [agent] }, 4)).toBe(0);
  });
});

describe("browser-local reviewer acknowledgement", () => {
  test("a manual pending note can resolve and reopen without agent work", () => {
    expect(canResolve(pending)).toBe(true);
    expect(isResolved(pending)).toBe(false);
    expect(isResolved(pending, reviewRevision(pending))).toBe(true);
    expect(isResolved(pending, "")).toBe(false);
  });

  test("every saved agent outcome can be acknowledged", () => {
    for (const status of [
      "pending",
      "unknown",
      "needs-input",
      "answered",
      "applied",
      "skipped",
    ] as const) {
      expect(canResolve({ ...pending, status })).toBe(true);
    }
  });

  test("existing acknowledgement revision values stay compatible", () => {
    const previous = JSON.stringify([
      pending.body,
      pending.messages,
      pending.status,
      pending.detail,
    ]);
    expect(isResolved(pending, previous)).toBe(true);
  });

  test("an incoming reply reopens an acknowledged note", () => {
    expect(
      isResolved({ ...pending, messages: [agent] }, reviewRevision(pending)),
    ).toBe(false);
  });

  test("body, outcome, detail and conversation revisions invalidate acknowledgement", () => {
    const saved = reviewRevision(pending);
    for (const change of [
      { body: "Revised request" },
      { status: "answered" as const },
      { detail: "An agent outcome" },
      { messages: [reviewer] },
    ]) {
      expect(isResolved({ ...pending, ...change }, saved)).toBe(false);
    }
    const conversation = { ...pending, messages: [agent] };
    expect(
      isResolved(
        { ...conversation, messages: [{ ...agent, body: "Revised answer" }] },
        reviewRevision(conversation),
      ),
    ).toBe(false);
  });
});
