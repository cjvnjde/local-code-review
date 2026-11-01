import type { AgentTask, WorkState } from "../../../agent/agent-queue.ts";
import { pathHtml } from "../components/path.ts";
import { el, esc, state } from "./state.ts";

export const noteSaveLabel = () => "Save note";

type TaskActivity = Pick<AgentTask, "state" | "detail">;
interface Activity {
  state: string;
  label: string;
}
interface QueueActivitySnapshot {
  tasks: TaskActivity[];
  permissions?: readonly unknown[];
  activity?: string;
  paused?: boolean;
}

const taskLabels: Record<WorkState, string> = {
  queued: "Queued",
  running: "Working",
  approval: "Waiting for approval",
  uncertain: "Execution uncertain — inspect before resuming",
  completed: "Turn completed",
  "needs-input": "Needs your input",
  blocked: "Blocked",
  error: "Error",
  cancelled: "Cancelled",
};

function taskActivity(task: TaskActivity): Activity {
  if (
    task.state === "running" &&
    state.connection &&
    state.connection.state !== "ready"
  )
    return {
      state: "uncertain",
      label: "Connection unavailable — execution unconfirmed",
    };
  return {
    state: task.state,
    label:
      task.detail === "Cancellation requested." && task.state === "running"
        ? "Stopping — awaiting confirmation"
        : taskLabels[task.state] || String(task.state),
  };
}

/** Decorative motion is paired with explicit text; execution is not a note verdict. */
export function queueTaskStatusHtml(task: TaskActivity) {
  const activity = taskActivity(task);
  return (
    '<span class="stat agent-activity" data-agent-state="' +
    esc(activity.state) +
    '" title="' +
    esc(
      task.detail || "Managed execution state, separate from the note verdict",
    ) +
    '">' +
    esc(activity.label) +
    "</span>"
  );
}

function queueActivity(queue: QueueActivitySnapshot): Activity {
  const tasks = queue.tasks || [];
  const queued = tasks.filter((task) => task.state === "queued").length;
  const approval = tasks.find((task) => task.state === "approval");
  const running = tasks.find((task) => task.state === "running");
  let activity: Activity;
  if (approval || queue.permissions?.length)
    activity = { state: "approval", label: "Waiting for approval" };
  else if (running) {
    activity = taskActivity(running);
    if (
      activity.state === "running" &&
      queue.activity &&
      queue.activity !== "Working" &&
      running.detail !== "Cancellation requested."
    )
      activity.label += " · " + queue.activity;
  } else {
    const uncertain = tasks.find((task) => task.state === "uncertain");
    const latest = tasks.at(-1);
    activity = uncertain
      ? taskActivity(uncertain)
      : queued
        ? { state: "queued", label: "Queued" }
        : latest
          ? taskActivity(latest)
          : { state: "idle", label: "Idle" };
  }
  if (queued) activity.label += " · " + queued + " queued";
  if (queue.paused) activity.label += " · queue paused";
  return activity;
}

function paintActivity(element: HTMLElement, activity: Activity) {
  element.classList.add("agent-activity");
  element.dataset.agentState = activity.state;
  if (element.textContent !== activity.label)
    element.textContent = activity.label;
}

/** A configured ACP queue accepts durable work even while disconnected. */
export function adoptAgent(data: any) {
  const connection = data.connection || null;
  const label = connection?.agent || data.agent || "";
  const queue = data.queue ?? null;
  const changed =
    state.agent !== label ||
    JSON.stringify(state.connection) !== JSON.stringify(connection) ||
    JSON.stringify(state.agentQueue) !== JSON.stringify(queue);
  state.agentQueue = queue;
  state.agent = label;
  state.connection = connection;
  const indicator = el("agentState");
  if (indicator) {
    const name = connection?.agent || "";
    const activity = queue ? queueActivity(queue) : null;
    paintActivity(indicator, {
      state: activity?.state || connection?.state || "unavailable",
      label:
        (name ? name + " " + connection.state : "No agent connected") +
        (activity ? " · " + activity.label : ""),
    });
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.setAttribute("aria-atomic", "true");
    indicator.title =
      connection?.detail ||
      "Notes are saved locally; no automatic agent delivery is confirmed.";
  }
  drawQueue();
  document.querySelectorAll("[data-save-note]").forEach((button: any) => {
    if (!button.disabled) button.textContent = noteSaveLabel();
  });
  document
    .querySelectorAll<HTMLElement>("[data-ask-note]")
    .forEach((button) => {
      button.hidden = !label;
    });
  return changed;
}

/** Read-only connection checks do not create model turns. */
export function startAgentStatus(repaint: () => void) {
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch("/api/agent");
      if (response.ok && adoptAgent(await response.json())) repaint();
    } catch {
      if (
        adoptAgent({
          queue: state.agentQueue,
          connection: {
            ...state.connection,
            agent: state.connection?.agent || "",
            state: "unavailable",
            detail: "The review server cannot be reached.",
          },
        })
      )
        repaint();
    } finally {
      checking = false;
    }
  };
  void check();
  setInterval(check, 5000);
}

/** Execution state is independent of the Markdown verdict. Tasks stay scoped to their review. */
export function managedNoteTask(id: string) {
  const tasks = (state.agentQueue?.tasks || []).filter(
    (task: Pick<AgentTask, "noteId" | "review">) =>
      task.noteId === id && task.review === state.agentQueue.review,
  );
  // A follow-up waiting behind this note must not hide its active execution.
  return (
    tasks.find((task: TaskActivity) =>
      ["running", "approval", "uncertain"].includes(task.state),
    ) || tasks.at(-1)
  );
}
function drawQueue() {
  const toggle = el("queueToggle"),
    panel = el("agentQueue");
  if (!toggle || !panel) return;
  const queue = state.agentQueue;
  toggle.hidden = !queue;
  if (!queue) {
    panel.hidden = true;
    return;
  }
  const pending = queue.tasks.filter((task: any) =>
    ["queued", "running", "approval", "uncertain"].includes(task.state),
  );
  const activity = queueActivity(queue);
  paintActivity(toggle, {
    state: activity.state,
    label: "Queue " + pending.length + " · " + activity.label,
  });
  toggle.setAttribute("aria-controls", "agentQueue");
  toggle.setAttribute("aria-expanded", String(!panel.hidden));
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
  };
  // Preserve focus on permission buttons while polling an unchanged queue.
  const signature = JSON.stringify([
    queue,
    state.connection?.state,
    state.connection?.detail,
  ]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  const button = (label: string, action: string, id = "", option = "") =>
    '<button type="button" data-action="' +
    action +
    '" data-id="' +
    esc(id) +
    '" data-option="' +
    esc(option) +
    '">' +
    esc(label) +
    "</button>";
  panel.innerHTML =
    "<h4>Agent work queue</h4><p>" +
    esc(state.connection?.detail || "") +
    '</p><p class="agent-activity" data-agent-state="' +
    esc(activity.state) +
    '">' +
    esc(activity.label) +
    "</p>" +
    button(
      queue.paused ? "Resume queue" : "Pause queue",
      queue.paused ? "resume" : "pause",
    ) +
    '<p class="note">Pause stops the next task. Cancel requests a stop and waits for confirmation. Completed means the turn ended; the note’s verdict is separate.</p>' +
    queue.permissions
      .map(
        (permission: any) =>
          '<div class="queue-task"><strong>Approval required</strong><pre>' +
          esc(JSON.stringify(permission.toolCall, null, 2)) +
          "</pre>" +
          permission.options
            .map((option: any) =>
              button(option.name, "permission", permission.id, option.optionId),
            )
            .join("") +
          "</div>",
      )
      .join("") +
    [...queue.tasks]
      .reverse()
      .map(
        (task: any) =>
          '<div class="queue-task">' +
          queueTaskStatusHtml(task) +
          pathHtml(task.review, { title: task.review }) +
          "<code>" +
          esc(task.noteId) +
          "</code><p>" +
          esc(task.detail || "") +
          "</p>" +
          (["queued", "running", "approval"].includes(task.state)
            ? button("Cancel", "cancel", task.id)
            : "") +
          (task.state === "uncertain"
            ? button(
                "I inspected this work; do not replay",
                "acknowledge",
                task.id,
              )
            : "") +
          (task.state === "error"
            ? button(
                "Use a new session for later tasks",
                "new-session",
                task.id,
              )
            : "") +
          "</div>",
      )
      .join("");
  panel.querySelectorAll("[data-action]").forEach(
    (control: any) =>
      (control.onclick = async () => {
        control.disabled = true;
        try {
          const response = await fetch("/api/agent/queue", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: control.dataset.action,
              id: control.dataset.id || undefined,
              option: control.dataset.option || undefined,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Queue action failed.");
          adoptAgent(data);
        } catch (error) {
          const message = panel.querySelector("[data-queue-error]");
          if (message) message.textContent = String(error);
        } finally {
          control.disabled = false;
        }
      }),
  );
  const error = document.createElement("p");
  error.dataset.queueError = "";
  error.setAttribute("role", "alert");
  panel.appendChild(error);
}
