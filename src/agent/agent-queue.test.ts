import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  queue.accept("/review-a.md", [{ ...a, body: "Edited pending" }], "target");
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
