import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentQueue, reviewerRevision } from "./agent-queue.ts";
import { noteFromComment } from "../review/thread.ts";
const roots: string[] = [];
const queues: AgentQueue[] = [];
afterEach(() => {
  for (const queue of queues.splice(0)) queue.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const root = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lcr-queue-"));
  roots.push(dir);
  return dir;
};
const open = (dir = root()) => {
  const queue = new AgentQueue(dir);
  queues.push(queue);
  return queue;
};
const note = (id = "a|n1|n1|#one", body = "First") =>
  noteFromComment({ id, file: "a", start: 1, end: 1, body });

test("accepted work is durable before dispatch, FIFO, and pending edits keep its place", () => {
  const queue = open();
  const a = note();
  const b = note("b|n1|n1|#two");
  queue.accept("/review-a.md", [a, b], "target");
  const first = queue.data.tasks[0]!.id;
  expect(
    queue.accept("/review-a.md", [{ ...a, body: "Edited pending" }], "target"),
  ).toBe(1);
  const disk = JSON.parse(readFileSync(queue.file, "utf8"));
  expect(disk.tasks.map((task: any) => task.noteId)).toEqual([a.id, b.id]);
  expect(disk.tasks[0].id).toBe(first);
  expect(disk.tasks[0].submitted.body).toBe("Edited pending");
  expect(disk.tasks[0].state).toBe("queued");
});
test("follow-ups to running work become a subsequent task; agent replies never change the revision", () => {
  const queue = open();
  const a = note();
  queue.accept("/a.md", [a], "target");
  queue.data.tasks[0]!.state = "running";
  expect(
    queue.accept(
      "/a.md",
      [{ ...a, messages: [{ role: "agent", at: "", body: "Answer" }] }],
      "target",
    ),
  ).toBe(0);
  const edited = { ...a, body: "Later wording" };
  queue.accept("/a.md", [edited], "target");
  expect(queue.data.tasks.map((task) => task.state)).toEqual([
    "running",
    "queued",
  ]);
  expect(queue.data.tasks[0]!.submitted.body).toBe("First");
  expect(queue.data.tasks[1]!.revision).toBe(reviewerRevision(edited));
});
test("deletion cancels pending work in exactly the named review", () => {
  const queue = open();
  const a = note();
  queue.accept("/a.md", [a], "target");
  queue.accept("/b.md", [a], "target");
  queue.cancelPending("/a.md", [a.id]);
  expect(queue.data.tasks.map((task) => task.state)).toEqual([
    "cancelled",
    "queued",
  ]);
});
test("restart retains queued work and converts running and approval to uncertain without replay", () => {
  const dir = root();
  let queue = open(dir);
  queue.accept("/a.md", [note(), note("b"), note("c")], "target");
  queue.data.tasks[0]!.state = "running";
  queue.data.tasks[1]!.state = "approval";
  queue.save();
  queue.close();
  queue = open(dir);
  expect(queue.data.tasks.map((task) => task.state)).toEqual([
    "uncertain",
    "uncertain",
    "queued",
  ]);
  expect(queue.data.paused).toBe(true);
});
test("a second lcr owner cannot acquire the same working-tree queue", () => {
  const dir = root();
  open(dir);
  expect(() => new AgentQueue(dir)).toThrow("already has an owner");
});

test("storage failure latches a dispatch stop and preserves the previous durable state", () => {
  const queue = open();
  queue.accept("/a.md", [note()], "target");
  const durable = readFileSync(queue.file, "utf8");
  // An atomic-rename failure is deterministic even when the tests run as an admin.
  const original = queue.file;
  Object.defineProperty(queue, "file", {
    value: path.join(original, "impossible-child"),
  });
  expect(() => queue.accept("/a.md", [note("b")], "target")).toThrow();
  expect(queue.healthy).toBe(false);
  Object.defineProperty(queue, "file", { value: original });
  expect(() => queue.save()).toThrow("storage failed");
  expect(readFileSync(original, "utf8")).toBe(durable);
});

test("queued submissions own deep snapshots and target/review identities cannot coalesce", () => {
  const queue = open();
  const submitted = {
    ...note(),
    messages: [
      {
        role: "reviewer" as const,
        at: "2026-01-01",
        body: "Original follow-up",
      },
    ],
  };
  expect(queue.accept("/a.md", [submitted], "agent-a")).toBe(1);
  submitted.body = "Mutated by caller";
  submitted.messages[0]!.body = "Mutated follow-up";
  expect(queue.data.tasks[0]!.submitted.body).toBe("First");
  expect(queue.data.tasks[0]!.submitted.messages[0]!.body).toBe(
    "Original follow-up",
  );
  queue.accept("/a.md", [note()], "agent-b");
  queue.accept("/b.md", [note()], "agent-a");
  expect(queue.data.tasks).toHaveLength(3);
  expect(new Set(queue.data.tasks.map((task) => task.sessionKey)).size).toBe(3);
});

test.each(["completed", "needs-input", "blocked", "uncertain"] as const)(
  "identical %s work is not silently replayed but reviewer revisions can enqueue a follow-up",
  (state) => {
    const queue = open();
    const original = note();
    queue.accept("/a.md", [original], "target");
    queue.data.tasks[0]!.state = state;
    expect(queue.accept("/a.md", [original], "target")).toBe(0);
    expect(queue.data.tasks).toHaveLength(1);
    const revised = { ...original, body: "A distinct reviewer request" };
    expect(queue.accept("/a.md", [revised], "target")).toBe(1);
    expect(queue.data.tasks.map((task) => task.state)).toEqual([
      state,
      "queued",
    ]);
    expect(queue.data.tasks[1]!.revision).toBe(reviewerRevision(revised));
  },
);

test.each(["error", "cancelled"] as const)(
  "%s work can be explicitly resubmitted without erasing its durable history",
  (state) => {
    const queue = open();
    queue.accept("/a.md", [note()], "target");
    const first = queue.data.tasks[0]!;
    first.state = state;
    expect(queue.accept("/a.md", [note()], "target")).toBe(1);
    expect(queue.data.tasks).toHaveLength(2);
    expect(queue.data.tasks[0]!.state).toBe(state);
    expect(queue.data.tasks[1]!.id).not.toBe(first.id);
    expect(queue.data.tasks[1]!.state).toBe("queued");
  },
);

test("saved session identities and terminal task states survive reopen while interrupted states are durably quarantined", () => {
  const dir = root();
  const queue = open(dir);
  queue.accept("/a.md", [note("a"), note("b"), note("c")], "target");
  const key = queue.data.tasks[0]!.sessionKey;
  queue.data.sessions[key] = "restorable-session";
  queue.data.tasks[0]!.state = "completed";
  queue.data.tasks[1]!.state = "approval";
  queue.save();
  queue.close();
  const reopened = open(dir);
  expect(reopened.data.sessions[key]).toBe("restorable-session");
  expect(reopened.data.tasks.map((task) => task.state)).toEqual([
    "completed",
    "uncertain",
    "queued",
  ]);
  expect(JSON.parse(readFileSync(reopened.file, "utf8"))).toMatchObject({
    paused: true,
    tasks: [
      { state: "completed" },
      { state: "uncertain" },
      { state: "queued" },
    ],
  });
  reopened.accept("/a.md", [note("d")], "target");
  expect(reopened.data.tasks[3]!.session).toBe("restorable-session");
  reopened.close();
  const again = open(dir);
  expect(again.data.tasks[1]!.state).toBe("uncertain");
  expect(again.data.paused).toBe(true);
});

test("corrupt queue data is preserved for inspection and failed initialization releases ownership", () => {
  const dir = root();
  const queue = open(dir);
  queue.accept("/a.md", [note()], "target");
  const valid = readFileSync(queue.file, "utf8");
  const original = structuredClone(queue.data);
  queue.close();
  const invalid = [
    "{not json",
    JSON.stringify({ ...original, version: 2 }),
    JSON.stringify({ ...original, sessions: { saved: 7 } }),
    JSON.stringify({ ...original, paused: "false" }),
    JSON.stringify({ ...original, sessions: "not-a-session-map" }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], id: "" }],
    }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], id: 7 }],
    }),
    JSON.stringify({
      ...original,
      tasks: [
        {
          ...original.tasks[0],
          noteId: 7,
          submitted: { ...original.tasks[0]!.submitted, id: 7 },
        },
      ],
    }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], target: 7 }],
    }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], sessionKey: null }],
    }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], session: 7 }],
    }),
    JSON.stringify({
      ...original,
      tasks: [
        {
          ...original.tasks[0],
          submitted: { ...original.tasks[0]!.submitted, body: ["not prose"] },
        },
      ],
    }),
    ...["prefix", "suffix"].map((side) =>
      JSON.stringify({
        ...original,
        tasks: [
          {
            ...original.tasks[0],
            revision:
              side === "prefix"
                ? "x" + original.tasks[0]!.revision
                : original.tasks[0]!.revision + "x",
          },
        ],
      }),
    ),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], state: "invented" }],
    }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], review: "relative.md" }],
    }),
    JSON.stringify({
      ...original,
      tasks: [{ ...original.tasks[0], revision: "not-a-revision" }],
    }),
    JSON.stringify({
      ...original,
      tasks: [
        {
          ...original.tasks[0],
          submitted: { ...original.tasks[0]!.submitted, id: "another-note" },
        },
      ],
    }),
  ];
  for (const contents of invalid) {
    writeFileSync(queue.file, contents);
    expect(() => new AgentQueue(dir)).toThrow();
    expect(readFileSync(queue.file, "utf8")).toBe(contents);
    expect(existsSync(queue.lockFile)).toBe(false);
  }
  writeFileSync(queue.file, valid);
  expect(open(dir).data.tasks).toHaveLength(1);
});

test("withdrawing a whole review cancels only queued tasks and closed queues cannot persist", () => {
  const queue = open();
  queue.accept("/a.md", [note("a"), note("b"), note("c")], "target");
  queue.accept("/b.md", [note("d")], "target");
  queue.data.tasks[0]!.state = "running";
  queue.data.tasks[1]!.state = "completed";
  queue.cancelPending("/a.md");
  expect(queue.data.tasks.map((task) => task.state)).toEqual([
    "running",
    "completed",
    "cancelled",
    "queued",
  ]);
  const durable = readFileSync(queue.file, "utf8");
  queue.close();
  queue.close();
  expect(() => queue.save()).toThrow("closed");
  expect(readFileSync(queue.file, "utf8")).toBe(durable);
});

test("all persisted terminal outcomes reopen without being rejected or reclassified", () => {
  const dir = root();
  const queue = open(dir);
  const states = [
    "completed",
    "needs-input",
    "blocked",
    "error",
    "uncertain",
    "cancelled",
  ] as const;
  queue.accept(
    "/a.md",
    states.map((state) => note(state)),
    "target",
  );
  for (const [index, state] of states.entries())
    queue.data.tasks[index]!.state = state;
  queue.data.paused = true;
  queue.save();
  queue.close();
  const reopened = open(dir);
  expect(reopened.data.tasks.map((task) => task.state)).toEqual([...states]);
  expect(reopened.data.tasks.map((task) => task.noteId)).toEqual([...states]);
  expect(reopened.data.paused).toBe(true);
});

test("selective withdrawal is durable and cannot cancel unselected notes in the same review", () => {
  const dir = root();
  const queue = open(dir);
  queue.accept(
    "/a.md",
    [note("active"), note("withdraw"), note("keep")],
    "target",
  );
  queue.accept("/b.md", [note("withdraw")], "target");
  queue.data.tasks[0]!.state = "running";
  queue.save();
  queue.cancelPending("/a.md", []);
  expect(queue.data.tasks.map((task) => task.state)).toEqual([
    "running",
    "queued",
    "queued",
    "queued",
  ]);
  queue.cancelPending("/a.md", ["active", "withdraw", "not-found"]);
  expect(queue.data.tasks.map((task) => task.state)).toEqual([
    "running",
    "cancelled",
    "queued",
    "queued",
  ]);
  // Inspect durability through a new queue owner, not the mutated in-memory object.
  queue.close();
  const reopened = open(dir);
  expect(reopened.data.tasks.map((task) => task.state)).toEqual([
    "uncertain",
    "cancelled",
    "queued",
    "queued",
  ]);
});
