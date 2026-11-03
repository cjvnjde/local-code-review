import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveAttachment } from "./attach.ts";
import { readContextPart } from "./context.ts";
import { createSession } from "./session.ts";
import { noteFromComment, parseReview } from "./thread.ts";
import { renderMarkdown } from "./render.ts";
import {
  hydrateWebContexts,
  preserveWebContexts,
  saveWebContext,
} from "./web-context.ts";
import {
  compactWebReview,
  setWebAnnotation,
  webReviewLines,
  webSelectionKey,
  type WebCapture,
} from "../shared/web-review.ts";
import { contextLink } from "../shared/context.ts";
import { reviewerRevision, AgentQueue } from "../agent/agent-queue.ts";
import { managedPrompt } from "../agent/managed-agent.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-web-context-"));
  roots.push(root);
  const image = await saveAttachment(
    root,
    ".review",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gXcAAAAASUVORK5CYII=",
      "base64",
    ),
    "image/png",
  );
  const raw: WebCapture = {
    url: "http://localhost:3000/settings",
    title: "Settings",
    at: "2026-11-03T12:00:00.000Z",
    mode: "element",
    rect: { x: 10, y: 20, width: 100, height: 30 },
    viewport: { width: 800, height: 600, dpr: 1 },
    scroll: { x: 0, y: 0 },
    page: `images/${image}`,
    area: `images/${image}`,
    selector: "#historical-save",
    element: {
      tag: "button",
      text: "Historical Save",
      attributes: { id: "historical-save" },
      styles: { padding: "13px" },
    },
    components: [{ framework: "React", name: "HistoricalSettings" }],
  };
  const capture = await saveWebContext(root, ".review", raw, [
    {
      name: "selected-html",
      label: "Selected HTML",
      type: "text/plain",
      data: "<button>Historical Save</button>",
    },
    {
      name: "full-page",
      label: "Full page",
      type: "image/png",
      status: "excluded",
      detail: "Not enabled",
    },
  ]);
  const comment = {
    id: "|@|@|#context",
    file: "",
    scope: "global" as const,
    start: 0,
    end: 0,
    body: "Align the save button.",
    web: { before: capture, after: [] },
  };
  return { root, raw, capture, comment };
}

test("compact review roundtrips and a restarted session restores the historical evidence", async () => {
  const f = await fixture();
  const session = createSession(f.root, ".review", "HEAD");
  const saved = await session.save({ comments: [f.comment] });
  const markdown = await readFile(path.join(f.root, saved.file), "utf8");
  expect(markdown).not.toContain("historical-save");
  expect(markdown).not.toContain("13px");
  const parsed = parseReview(markdown);
  expect(parsed.notes[0]!.web).toEqual(compactWebReview(f.comment.web));
  expect(renderMarkdown(parsed)).toBe(markdown);
  f.raw.selector = "#changed-after-capture";
  const restarted = createSession(f.root, ".review", "HEAD");
  await restarted.adoptMatching();
  const note = (await restarted.read()).notes[0]!;
  expect(note.web!.before.selector).toBe("#historical-save");
  expect(note.web!.before.element!.styles.padding).toBe("13px");
  expect(reviewerRevision(note)).toBe(reviewerRevision(parsed.notes[0]!));
  const html = await readContextPart(
    f.root,
    ".review",
    f.capture.context!.id,
    "selected-html",
  );
  expect(new TextDecoder().decode(html!.bytes)).toBe(
    "<button>Historical Save</button>",
  );
});

test("a reply retains its exact context after later captures and original note deletion", async () => {
  const f = await fixture();
  const session = createSession(f.root, ".review", "HEAD");
  await session.save({ comments: [f.comment] });
  const reply =
    "This is the state I mean.\n\n" +
    webReviewLines(f.comment.web).slice(2).join("\n");
  await session.reply(f.comment.id, reply);
  await saveWebContext(f.root, ".review", {
    ...f.raw,
    selector: "#new-state",
    at: "2026-11-03T13:00:00.000Z",
  });
  const note = (await session.read()).notes[0]!;
  expect(note.messages[0]!.body).toContain(contextLink(f.capture.context!));
  expect(note.messages[0]!.body).not.toContain("historical-save");
  await session.remove(f.comment.id);
  const historical = await readContextPart(
    f.root,
    ".review",
    f.capture.context!.id,
    "capture",
  );
  expect(JSON.parse(new TextDecoder().decode(historical!.bytes)).selector).toBe(
    "#historical-save",
  );
});

test("annotation changes publish new context without replacing optional evidence or old marks", async () => {
  const f = await fixture();
  const annotation = {
    image: f.capture.area,
    width: 1,
    height: 1,
    padding: 0,
    marks: [
      {
        tool: "text" as const,
        color: "#ffffff",
        at: { x: 0, y: 0 },
        text: "Move left",
        size: 12,
      },
    ],
  };
  const edited = setWebAnnotation(
    f.comment.web,
    {
      kind: "selection",
      index: 0,
      key: webSelectionKey(f.capture),
      expected: "",
    },
    annotation,
  );
  const next = await preserveWebContexts(f.root, ".review", edited);
  expect(next.before.context!.id).not.toBe(f.capture.context!.id);
  expect(
    (await readContextPart(
      f.root,
      ".review",
      next.before.context!.id,
      "selected-html",
    ))!.part.sha256,
  ).toBe(
    (await readContextPart(
      f.root,
      ".review",
      f.capture.context!.id,
      "selected-html",
    ))!.part.sha256,
  );
  const original = await hydrateWebContexts(
    f.root,
    ".review",
    compactWebReview(f.comment.web),
  );
  expect(original.before.annotation).toBeUndefined();
  const hydrated = await hydrateWebContexts(
    f.root,
    ".review",
    compactWebReview(next),
  );
  expect(hydrated.before.annotation).toEqual(annotation);
  const rendered = renderMarkdown({
    range: "HEAD",
    notes: [noteFromComment({ ...f.comment, web: next })],
  });
  expect(rendered).not.toContain("Move left");
  const parsed = parseReview(rendered).notes[0]!;
  expect(parsed.web!.before.proposal).toBe(annotation.image);
  expect(reviewerRevision(parsed)).toBe(
    reviewerRevision(noteFromComment({ ...f.comment, web: next })),
  );
});

test("missing bundles preserve the subject and references instead of manufacturing evidence", async () => {
  const f = await fixture();
  const session = createSession(f.root, ".review", "HEAD");
  await session.save({ comments: [f.comment] });
  await rm(path.join(f.root, ".review", "context", f.capture.context!.id), {
    recursive: true,
  });
  const note = (await session.read()).notes[0]!;
  expect(note.web!.before.context).toEqual(f.capture.context!);
  expect(note.web!.before.selector).toBeUndefined();
  expect(note.web!.before.area).toBe(f.capture.area);
  await session.save({
    comments: [{ ...f.comment, body: "Clarified request." }],
  });
  expect((await session.read()).notes[0]!.web!.before.context).toEqual(
    f.capture.context!,
  );
});

test("hydration refuses to attach a bundle to a different captured subject", async () => {
  const f = await fixture();
  const web = compactWebReview(f.comment.web);
  web.before.rect = { ...web.before.rect, x: 50 };
  const hydrated = await hydrateWebContexts(f.root, ".review", web);
  expect(hydrated.before.rect.x).toBe(50);
  expect(hydrated.before.selector).toBeUndefined();
});

test("queued compact delivery survives restart and stays bound to the submitted context", async () => {
  const f = await fixture();
  const note = noteFromComment(f.comment);
  const directory = path.join(f.root, "managed");
  const queue = new AgentQueue(directory);
  queue.accept(
    path.join(f.root, ".review", "review.md"),
    [note],
    "adapter",
    true,
  );
  queue.close();
  const restarted = new AgentQueue(directory);
  try {
    const task = restarted.data.tasks[0]!;
    const later = await saveWebContext(f.root, ".review", {
      ...f.raw,
      selector: "#later",
      at: "2026-11-03T13:00:00.000Z",
    });
    note.web!.before = later;
    const prompt = managedPrompt(task, task.submitted);
    const delivered = JSON.parse(prompt.split("\n\n").at(-1)!);
    expect(delivered.body).toBe(f.comment.body);
    expect(delivered.web.before.context.id).toBe(f.capture.context!.id);
    expect(delivered.web.before.selector).toBeUndefined();
    expect(prompt).not.toContain(later.context!.id);
    const expanded = JSON.parse(
      managedPrompt(task, task.submitted, { saving: false })
        .split("\n\n")
        .at(-1)!,
    );
    expect(expanded.web.before.selector).toBe("#historical-save");
  } finally {
    restarted.close();
  }
});
