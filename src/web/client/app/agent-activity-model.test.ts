import { describe, expect, test } from "bun:test";
import type { AgentState } from "./api.ts";
import { agentActivity, noteAgentActivity } from "./agent-activity-model.ts";

type Queue = NonNullable<AgentState["queue"]>;
const task = (
  state: string,
  review = ".review/current.md",
  id = state,
): Queue["tasks"][number] => ({
  id,
  state,
  review,
  noteId: "same-note",
  target: "agent",
});
const agent = (
  tasks: Queue["tasks"],
  extra: Partial<Queue> = {},
): AgentState => ({
  queue: {
    review: ".review/current.md",
    tasks,
    paused: false,
    permissions: [],
    ...extra,
  },
});

describe("agent activity", () => {
  test("uses the latest task for this exact review and note", () => {
    const state = agent([
      task("completed"),
      task("queued"),
      task("running", ".review/other.md"),
      { ...task("error"), noteId: "another-note" },
    ]);
    expect(noteAgentActivity(state, "same-note")).toMatchObject({
      state: "queued",
      label: "Queued",
      active: true,
      blocksAsk: true,
    });
    expect(noteAgentActivity(state, "missing")).toBeNull();
    expect(
      noteAgentActivity(agent([task("running")], { review: "" }), "same-note"),
    ).toBeNull();
  });

  test("normalizes separators and dot segments without discarding review directories or case", () => {
    const state = agent(
      [
        task("queued", "..\\reviews\\.\\current.md"),
        task("error", "reviews/current.md"),
        task("running", "../reviews/Current.md"),
      ],
      { review: "../reviews/sub/../current.md" },
    );
    expect(noteAgentActivity(state, "same-note")?.state).toBe("queued");
  });

  test("shows paused queued work without pretending it is running", () => {
    const state = agent([task("queued")], {
      paused: true,
      activity: "Old activity",
    });
    expect(noteAgentActivity(state, "same-note")).toMatchObject({
      label: "Queued · paused",
      blocksAsk: true,
      spinning: false,
    });
    expect(agentActivity(state).label).toBe("1 queued · paused");
  });

  test("keeps execution visible when pausing only stops subsequent tasks", () => {
    const state = agent([task("running"), task("queued")], {
      paused: true,
      activity: "Editing source.ts",
    });
    expect(agentActivity(state)).toMatchObject({
      state: "running",
      spinning: true,
      detail: "Editing source.ts",
    });
  });

  test("does not attach another note's live activity to queued work", () => {
    const state = agent(
      [{ ...task("running"), noteId: "other-note" }, task("queued")],
      { activity: "Editing another note" },
    );
    expect(noteAgentActivity(state, "same-note")?.detail).toBe(
      "Waiting in the agent queue.",
    );
  });

  test("exposes permission requests and interrupted work without a fake spinner", () => {
    const permission = agent([task("approval")], {
      permissions: [
        { id: "permission", toolCall: { title: "Run tests?" }, options: [] },
      ],
    });
    expect(noteAgentActivity(permission, "same-note")).toMatchObject({
      label: "Permission needed",
      detail: "Run tests?",
      blocksAsk: true,
      spinning: false,
    });
    const interrupted = agent(
      [task("uncertain"), { ...task("queued"), noteId: "other" }],
      { paused: true },
    );
    expect(agentActivity(interrupted)).toMatchObject({
      state: "uncertain",
      label: "Needs inspection",
      blocksAsk: true,
      spinning: false,
    });
  });

  test("reports terminal outcomes and allows a new ask", () => {
    for (const [state, label] of [
      ["completed", "Completed"],
      ["error", "Failed"],
      ["cancelled", "Cancelled"],
      ["needs-input", "Needs input"],
      ["blocked", "Blocked"],
    ]) {
      expect(
        noteAgentActivity(agent([task(state!)]), "same-note"),
      ).toMatchObject({
        label,
        active: false,
        blocksAsk: false,
        spinning: false,
      });
    }
  });
});
