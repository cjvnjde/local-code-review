import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { submitNote, submitReview, withdrawNotes } from "../app/persistence.ts";
import { state } from "../app/state.ts";
import {
  adoptAgent,
  managedNoteTask,
  queueTaskStatusHtml,
  startAgentStatus,
} from "../app/agent.ts";

const originalFetch = globalThis.fetch;
const documentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const storageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const saved = {
  notes: state.notes,
  noteSending: state.noteSending,
  noteDelivery: state.noteDelivery,
  sessionFile: state.sessionFile,
  agent: state.agent,
  connection: state.connection,
  agentQueue: state.agentQueue,
  soloKeys: state.soloKeys,
};
const file = ".review/review-2026-10-28T12-00-00.md";
const first = {
  id: "a.ts|n1|n1|#first",
  file: "a.ts",
  body: "Why?",
  start: 1,
  end: 1,
  label: "1",
};
const second = {
  ...first,
  id: "a.ts|n2|n2|#second",
  start: 2,
  end: 2,
  label: "2",
  body: "Keep this draft local.",
};

beforeEach(() => {
  state.notes = new Map([
    [first.id, { ...first }],
    [second.id, { ...second }],
  ]);
  state.noteSending = new Map();
  state.noteDelivery = new Map();
  state.soloKeys = new Set();
  state.sessionFile = "";
  state.agent = "External ACP agent";
  state.connection = null;
  state.agentQueue = null;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => null, querySelectorAll: () => [] },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: () => {} },
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(state, saved);
  if (documentDescriptor)
    Object.defineProperty(globalThis, "document", documentDescriptor);
  else delete (globalThis as any).document;
  if (storageDescriptor)
    Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else delete (globalThis as any).localStorage;
});

describe("individual note sending", () => {
  test("posts only the saved note and stamps no other local note as submitted", async () => {
    let posted: any;
    globalThis.fetch = (async (url, init) => {
      expect(url).toBe("/api/note");
      posted = JSON.parse(init!.body as string);
      return Response.json({
        file,
        id: first.id,
        connection: {
          agent: "External ACP agent",
          state: "ready",
          detail: "Confirmed",
        },
        delivery: { state: "queued", count: 1 },
      });
    }) as any;
    await submitNote(state.notes.get(first.id));
    expect(posted.comment.id).toBe(first.id);
    expect(posted.comments).toBeUndefined();
    expect(state.notes.get(first.id).sentAt).toBeGreaterThan(0);
    expect(state.notes.get(second.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
  });

  test("a deletion waits for a pending save and does not restore the deleted browser note", async () => {
    let release: (response: Response) => void = () => {};
    let began: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const methods: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      methods.push(init!.method!);
      if (init!.method === "POST") {
        began();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return Response.json({ removed: true });
    }) as any;
    const sending = submitNote(state.notes.get(first.id));
    await started;
    state.notes.delete(first.id);
    const removing = withdrawNotes([first.id]);
    expect(methods).toEqual(["POST"]);
    release(Response.json({ file, id: first.id }));
    await Promise.all([sending, removing]);
    expect(methods).toEqual(["POST", "DELETE"]);
    expect(state.notes.has(first.id)).toBe(false);
  });

  test("a failed write leaves the text intact and clears the pending marker", async () => {
    globalThis.fetch = (async () =>
      Response.json({ error: "Disk full" }, { status: 500 })) as any;
    await expect(submitNote(state.notes.get(first.id))).rejects.toThrow(
      "Disk full",
    );
    expect(state.notes.get(first.id).body).toBe("Why?");
    expect(state.notes.get(first.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
  });

  test("connection changes reveal the separate ask action in an already open editor", () => {
    const button = { disabled: false, textContent: "" };
    const ask = { hidden: true };
    const status = {
      textContent: "",
      title: "",
      dataset: {},
      classList: { add: () => {} },
      setAttribute: () => {},
    };
    document.querySelectorAll = ((selector: string) =>
      selector === "[data-ask-note]"
        ? [ask]
        : [button]) as unknown as typeof document.querySelectorAll;
    // Minimal DOM stand-ins expose only the status node used by this test.
    document.getElementById = ((id: string) =>
      id === "agentState"
        ? status
        : null) as unknown as typeof document.getElementById;
    for (const phase of ["checking", "ready", "unavailable"]) {
      adoptAgent({
        connection: {
          agent: "External ACP agent",
          state: phase,
          detail: "Queue accepts saved work",
        },
      });
      expect(status.textContent).toBe("External ACP agent " + phase);
      expect(ask.hidden).toBe(false);
    }
    adoptAgent({});
    expect(status.textContent).toBe("No agent connected");
    expect(ask.hidden).toBe(true);
  });
});

describe("whole review saving", () => {
  test("queues behind single-note saves and before deletion, stamping only submitted notes", async () => {
    let release: (response: Response) => void = () => {};
    let began: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const requests: any[] = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({
        url,
        body: init!.body ? JSON.parse(init!.body as string) : null,
      });
      if (url === "/api/note") {
        began();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return Response.json({ file });
    }) as any;
    const sending = submitNote(state.notes.get(first.id));
    await started;
    const saving = submitReview();
    // A later edit must not alter the snapshot already requested for this save.
    state.notes.get(second.id).body = "Changed while waiting";
    const later = { ...first, id: "a.ts|n3|n3|#later" };
    state.notes.set(later.id, later);
    state.notes.delete(first.id);
    const deleting = withdrawNotes([first.id]);
    expect(requests).toHaveLength(1);
    expect(state.noteSending.has(second.id)).toBe(true);
    release(Response.json({ file }));
    await Promise.all([sending, saving, deleting]);
    expect(requests.map((r) => r.url.split("?")[0])).toEqual([
      "/api/note",
      "/api/submit",
      "/api/note",
    ]);
    expect(requests[1].body.comments).toEqual([second]);
    expect(state.notes.get(first.id)).toBeUndefined();
    expect(state.notes.get(second.id).sentAt).toBeGreaterThan(0);
    expect(state.notes.get(later.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
  });

  test("reports failed saves without stamping or losing local notes", async () => {
    globalThis.fetch = (async () =>
      Response.json({ error: "Disk full" }, { status: 500 })) as any;
    await expect(submitReview()).rejects.toThrow("Disk full");
    expect(state.notes.get(first.id).body).toBe(first.body);
    expect(state.notes.get(first.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
    globalThis.fetch = (async () => {
      throw new Error("Offline");
    }) as any;
    await expect(submitReview()).rejects.toThrow("Offline");
    expect(state.noteSending.size).toBe(0);
  });
});

test("a configured generic managed agent accepts work while unavailable and retains its own name", () => {
  adoptAgent({
    connection: {
      agent: "External ACP adapter",
      state: "unavailable",
      detail: "Queued locally",
    },
    queue: { paused: true, tasks: [], permissions: [] },
  });
  expect(state.agent).toBe("External ACP adapter");
});

test("queue badges match the exact review path even when two output directories reuse a filename", () => {
  state.agentQueue = {
    review: "second/review-same.md",
    tasks: [
      { noteId: first.id, review: "first/review-same.md", state: "running" },
      { noteId: first.id, review: "second/review-same.md", state: "queued" },
    ],
  };
  expect(managedNoteTask(first.id)?.state).toBe("queued");
});

test("a queued follow-up does not hide its note's active exact-review task", () => {
  for (const taskState of ["running", "approval", "uncertain"]) {
    state.agentQueue = {
      review: "review.md",
      tasks: [
        { noteId: first.id, review: "other/review.md", state: "running" },
        { noteId: first.id, review: "review.md", state: taskState },
        { noteId: first.id, review: "review.md", state: "queued" },
      ],
    };
    expect(managedNoteTask(first.id)?.state).toBe(taskState);
  }
});

test("task badges distinguish execution, approval and terminal states without claiming a fix", () => {
  state.connection = { agent: "ACP", state: "ready" };
  for (const taskState of [
    "queued",
    "running",
    "approval",
    "uncertain",
    "completed",
    "needs-input",
    "blocked",
    "error",
    "cancelled",
  ] as const) {
    const html = queueTaskStatusHtml({ state: taskState });
    expect(html).toContain('class="stat agent-activity"');
    expect(html).toContain('data-agent-state="' + taskState + '"');
    if (taskState === "approval") {
      expect(html).toContain("Waiting for approval");
      expect(html).not.toContain("Working");
    }
    if (taskState === "completed") {
      expect(html).toContain("Turn completed");
      expect(html).not.toContain("applied");
    }
  }
  expect(
    queueTaskStatusHtml({
      state: "running",
      detail: 'Running <script>alert("bad")</script>',
    }),
  ).not.toContain("<script>");
  state.connection.state = "unavailable";
  const disconnected = queueTaskStatusHtml({ state: "running" });
  expect(disconnected).toContain('data-agent-state="uncertain"');
  expect(disconnected).toContain("execution unconfirmed");
});

test("agent and queue show live activity before opening the queue, and approvals stop the spinner", () => {
  const node = () => ({
    textContent: "",
    title: "",
    hidden: true,
    innerHTML: "",
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    classList: { add: () => {} },
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    querySelectorAll: () => [],
    appendChild: () => {},
  });
  const status = node(),
    toggle = node(),
    panel = node();
  const nodes: Record<string, object> = {
    agentState: status,
    queueToggle: toggle,
    agentQueue: panel,
  };
  // DOM stand-ins deliberately implement only the methods used by queue rendering.
  document.getElementById = ((id: string) =>
    nodes[id] || null) as unknown as typeof document.getElementById;
  document.createElement = (() =>
    node()) as unknown as typeof document.createElement;
  const connection = { agent: "ACP", state: "ready", detail: "Connected" };
  const task = { state: "running", review: "review.md", noteId: first.id };
  const queue = {
    paused: false,
    activity: "Reading source",
    permissions: [],
    tasks: [task, { state: "queued", review: "review.md", noteId: second.id }],
  };
  adoptAgent({ connection, queue });
  expect(panel.hidden).toBe(true);
  expect(status.dataset.agentState).toBe("running");
  expect(status.textContent).toContain("Working · Reading source");
  expect(status.textContent).toContain("1 queued");
  expect(status.attributes.role).toBe("status");
  expect(status.attributes["aria-live"]).toBe("polite");
  expect(toggle.dataset.agentState).toBe("running");
  expect(toggle.attributes["aria-expanded"]).toBe("false");
  expect(panel.innerHTML).toContain('data-agent-state="running"');
  task.state = "approval";
  adoptAgent({ connection, queue });
  expect(status.dataset.agentState).toBe("approval");
  expect(status.textContent).toContain("Waiting for approval");
  expect(status.textContent).not.toContain("Reading source");
  expect(toggle.dataset.agentState).toBe("approval");
  task.state = "uncertain";
  queue.paused = true;
  adoptAgent({ connection, queue });
  expect(status.dataset.agentState).toBe("uncertain");
  expect(status.textContent).toContain("inspect before resuming");
});

test("status polling only reads the agent endpoint and repaints changed snapshots", async () => {
  const intervalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "setInterval",
  );
  let poll: (() => Promise<void>) | undefined;
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    value: (callback: () => Promise<void>) => {
      poll = callback;
      return 0;
    },
  });
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({
      connection: { agent: "ACP", state: "ready", detail: "Read-only status" },
    });
  }) as typeof originalFetch;
  let repaints = 0;
  try {
    const painted = Promise.withResolvers<void>();
    startAgentStatus(() => {
      repaints++;
      painted.resolve();
    });
    await painted.promise;
    expect(poll).toBeDefined();
    await poll!();
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        ({ url, init }) =>
          url === "/api/agent" &&
          (!init || !init.method || init.method === "GET"),
      ),
    ).toBe(true);
    expect(repaints).toBe(1);
  } finally {
    if (intervalDescriptor)
      Object.defineProperty(globalThis, "setInterval", intervalDescriptor);
  }
});
