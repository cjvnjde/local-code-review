import type { AgentState } from "./api.ts";

type Queue = NonNullable<AgentState["queue"]>;
type Task = Queue["tasks"][number];

export interface AgentActivityStatus {
  state: string;
  label: string;
  detail?: string;
  active: boolean;
  blocksAsk: boolean;
  spinning: boolean;
  tone: "muted" | "working" | "warning" | "success" | "error";
  taskId?: string;
}

function taskActivity(task: Task, queue: Queue): AgentActivityStatus {
  const status: AgentActivityStatus = {
    state: task.state,
    label: task.state,
    detail: task.detail,
    active: ["queued", "running", "approval"].includes(task.state),
    blocksAsk: ["queued", "running", "approval", "uncertain"].includes(
      task.state,
    ),
    spinning: task.state === "running",
    tone: "muted",
    taskId: task.id,
  };
  switch (task.state) {
    case "queued":
      status.label = queue.paused ? "Queued · paused" : "Queued";
      status.tone = queue.paused ? "warning" : "working";
      status.detail ||= queue.paused
        ? "The agent queue is paused. Resume it in the agent panel."
        : "Waiting in the agent queue.";
      break;
    case "running":
      status.label = "Running";
      status.tone = "working";
      status.detail =
        task.detail || queue.activity || "Agent is running this task.";
      break;
    case "approval":
      status.label = "Permission needed";
      status.tone = "warning";
      status.detail =
        task.detail ||
        queue.permissions[0]?.toolCall?.title ||
        "Choose a permission option in the agent panel.";
      break;
    case "uncertain":
      status.label = "Needs inspection";
      status.tone = "warning";
      status.detail ||=
        "Execution was interrupted. Inspect the working tree before acknowledging this task.";
      break;
    case "completed":
      status.label = "Completed";
      status.tone = "success";
      break;
    case "needs-input":
      status.label = "Needs input";
      status.tone = "warning";
      break;
    case "blocked":
      status.label = "Blocked";
      status.tone = "warning";
      break;
    case "error":
      status.label = "Failed";
      status.tone = "error";
      break;
    case "cancelled":
      status.label = "Cancelled";
      break;
  }
  return status;
}

// Queue paths are repo-relative, including external output directories. Preserve
// their leading ".." segments and case; matching only basenames crosses reviews.
function reviewKey(file: string): string {
  const path = file.replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return `${path.startsWith("/") ? "/" : ""}${parts.join("/")}`;
}

export function noteAgentActivity(
  agent: AgentState,
  noteId: string,
): AgentActivityStatus | null {
  if (!agent.queue?.review) return null;
  const review = reviewKey(agent.queue.review);
  for (let i = agent.queue.tasks.length - 1; i >= 0; i--) {
    const task = agent.queue.tasks[i]!;
    if (task.noteId === noteId && reviewKey(task.review) === review)
      return taskActivity(task, agent.queue);
  }
  return null;
}

export function agentActivity(agent: AgentState): AgentActivityStatus {
  const queue = agent.queue;
  if (queue) {
    const executing =
      queue.tasks.find((task) => task.state === "approval") ||
      queue.tasks.find((task) => task.state === "running");
    if (executing) return taskActivity(executing, queue);
    const uncertain = queue.tasks.find((task) => task.state === "uncertain");
    if (uncertain) return taskActivity(uncertain, queue);
    const queued = queue.tasks.filter((task) => task.state === "queued");
    if (queued.length) {
      const status = taskActivity(queued[0]!, queue);
      status.label = `${queued.length} queued${queue.paused ? " · paused" : ""}`;
      return status;
    }
    const latest = queue.tasks.at(-1);
    if (latest) {
      const status = taskActivity(latest, queue);
      if (queue.paused) {
        status.label += " · queue paused";
        status.tone = "warning";
      }
      return status;
    }
    if (queue.paused)
      return {
        state: "paused",
        label: "Queue paused",
        active: false,
        blocksAsk: false,
        spinning: false,
        tone: "warning",
        detail: agent.connection?.detail,
      };
  }
  const state = agent.connection?.state || "idle";
  return {
    state,
    label:
      state === "ready"
        ? "Agent ready"
        : state === "checking"
          ? "Connecting"
          : state === "unavailable"
            ? "Agent unavailable"
            : "Agent",
    detail: agent.connection?.detail,
    active: false,
    blocksAsk: false,
    spinning: false,
    tone: state === "unavailable" ? "warning" : "muted",
  };
}
