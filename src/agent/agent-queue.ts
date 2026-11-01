import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ReviewNote } from "../review/thread.ts";

export type WorkState =
  | "queued"
  | "running"
  | "approval"
  | "completed"
  | "needs-input"
  | "blocked"
  | "error"
  | "uncertain"
  | "cancelled";
export interface AgentTask {
  id: string;
  review: string;
  noteId: string;
  revision: string;
  submitted: ReviewNote;
  target: string;
  sessionKey: string;
  session: string;
  state: WorkState;
  created: string;
  started?: string;
  finished?: string;
  executedRevision?: string;
  detail?: string;
  response?: string;
}
export interface QueueData {
  version: 1;
  paused: boolean;
  tasks: AgentTask[];
  sessions: Record<string, string>;
}
export const reviewerRevision = (note: ReviewNote) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        note.body,
        note.file,
        note.label,
        note.start,
        note.end,
        note.code,
        note.scope,
        note.side,
        note.ca,
        note.cb,
        note.snippet,
        note.image,
        note.web,
        note.messages.filter((message) => message.role === "reviewer"),
      ]),
    )
    .digest("hex");
export const activeWork = (task: AgentTask) =>
  task.state === "running" || task.state === "approval";

const WORK_STATES: WorkState[] = [
  "queued",
  "running",
  "approval",
  "completed",
  "needs-input",
  "blocked",
  "error",
  "uncertain",
  "cancelled",
];
function validQueue(value: any): value is QueueData {
  return (
    value?.version === 1 &&
    typeof value.paused === "boolean" &&
    Array.isArray(value.tasks) &&
    value.sessions &&
    typeof value.sessions === "object" &&
    !Array.isArray(value.sessions) &&
    Object.values(value.sessions).every(
      (session) => typeof session === "string",
    ) &&
    value.tasks.every(
      (task: any) =>
        task &&
        typeof task.id === "string" &&
        task.id &&
        typeof task.review === "string" &&
        path.isAbsolute(task.review) &&
        typeof task.noteId === "string" &&
        task.noteId &&
        typeof task.revision === "string" &&
        /^[a-f0-9]{64}$/.test(task.revision) &&
        typeof task.target === "string" &&
        typeof task.sessionKey === "string" &&
        typeof task.session === "string" &&
        task.submitted?.id === task.noteId &&
        typeof task.submitted.body === "string" &&
        Array.isArray(task.submitted.messages) &&
        WORK_STATES.includes(task.state),
    )
  );
}

/** One writer for the entire working tree, across ports, review names and output directories. */
export class AgentQueue {
  data: QueueData;
  private lock: number;
  private closed = false;
  healthy = true;
  readonly file: string;
  readonly lockFile: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "queue.json");
    this.lockFile = path.join(directory, "owner.lock");
    try {
      this.lock = openSync(this.lockFile, "wx", 0o600);
    } catch {
      throw new Error(
        `Managed work already has an owner, or a previous owner crashed. Check ${this.lockFile}; only remove it after verifying that lcr and its agent have stopped.`,
      );
    }
    try {
      writeFileSync(
        this.lock,
        JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
      );
      this.data = existsSync(this.file)
        ? JSON.parse(readFileSync(this.file, "utf8"))
        : { version: 1, paused: false, tasks: [], sessions: {} };
      if (!validQueue(this.data))
        throw new Error("Invalid managed queue; preserve it for inspection.");
      for (const task of this.data.tasks)
        if (activeWork(task)) {
          task.state = "uncertain";
          task.detail =
            "lcr stopped during execution. Inspect the code and agent before acknowledging; this task will not be replayed.";
          this.data.paused = true;
        }
      this.save();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  /** Flush before dispatch or acknowledgement. A failed write must never start an agent. */
  save() {
    if (this.closed) throw new Error("Managed queue is closed.");
    if (!this.healthy)
      throw new Error(
        "Managed queue storage failed; restart after repairing storage. Dispatch is stopped.",
      );
    try {
      const temp = this.file + "." + randomUUID() + ".tmp";
      const fd = openSync(temp, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(this.data, null, 2) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, this.file);
      // Windows does not expose a portable directory fsync; the file itself is still flushed.
      if (process.platform !== "win32") {
        const dir = openSync(path.dirname(this.file), "r");
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      }
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }
  accept(review: string, notes: ReviewNote[], target: string): number {
    let count = 0;
    for (const note of notes) {
      const revision = reviewerRevision(note);
      const matching = this.data.tasks.filter(
        (task) =>
          task.review === review &&
          task.noteId === note.id &&
          task.target === target,
      );
      const pending = matching.find((task) => task.state === "queued");
      if (pending) {
        pending.revision = revision;
        pending.submitted = structuredClone(note);
        count++;
        continue;
      }
      const latest = matching.at(-1);
      if (
        latest?.revision === revision &&
        latest.state !== "cancelled" &&
        latest.state !== "error"
      )
        continue;
      this.data.tasks.push({
        id: randomUUID(),
        review,
        noteId: note.id,
        revision,
        submitted: structuredClone(note),
        target,
        sessionKey: JSON.stringify([target, review]),
        session: this.data.sessions[JSON.stringify([target, review])] ?? "",
        state: "queued",
        created: new Date().toISOString(),
      });
      count++;
    }
    this.save();
    return count;
  }
  cancelPending(review: string, ids?: string[]) {
    for (const task of this.data.tasks)
      if (
        task.review === review &&
        (!ids || ids.includes(task.noteId)) &&
        task.state === "queued"
      ) {
        task.state = "cancelled";
        task.detail = "Withdrawn before execution.";
      }
    this.save();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.lock);
    unlinkSync(this.lockFile);
  }
}
