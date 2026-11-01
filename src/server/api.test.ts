import type { Server } from "bun";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { createHub } from "./events.ts";
import type { Hub } from "./events.ts";
import { createSession } from "../review/session.ts";
import { repoId, startServer } from "./http.ts";
import type { ServerOptions } from "./http.ts";
import { webSelectionKey, type WebCapture } from "../shared/web-review.ts";
import { createWebReview } from "../web-review/controller.ts";
import { saveAttachment } from "../review/attach.ts";
import type { WebAnnotation } from "../shared/web-annotation.ts";
import type {
  DiffFile,
  NoteStatus,
  ReviewComment,
} from "../shared/review-types.ts";

const originalLog = console.log;
const originalError = console.error;
const servers = new Set<Server>();

const status: NoteStatus = {
  id: "assets/logo.png|n1|n1|#note",
  key: "assets/logo.png:1",
  status: "pending",
  detail: "",
  source: ".review/review-1.md",
};

const comment: ReviewComment = {
  id: "assets/logo.png|n1|n1|#note",
  file: "assets/logo.png",
  body: "Check this line.",
  start: 1,
  end: 1,
  label: "1",
  side: "new",
  code: "+new line",
};

const diffFile = (overrides: Partial<DiffFile> = {}): DiffFile => ({
  path: "assets/logo.png",
  status: "modified",
  rows: [
    { t: "hunk", text: "@@ -1 +1 @@" },
    { t: "del", o: 1, text: "old line" },
    { t: "add", n: 1, text: "new line" },
  ],
  added: 1,
  removed: 1,
  hash: "file-hash",
  ...overrides,
});

const webCapture: WebCapture = {
  url: "http://localhost:3000/",
  title: "Local app",
  at: "2026-10-31T10:00:00.000Z",
  mode: "area",
  rect: { x: 10, y: 20, width: 100, height: 80 },
  viewport: { width: 1200, height: 800, dpr: 1 },
  scroll: { x: 0, y: 0 },
  components: [],
  page: "images/page.png",
  area: "images/area.png",
};

function webController(
  overrides: Partial<NonNullable<ServerOptions["web"]>> = {},
): NonNullable<ServerOptions["web"]> {
  return {
    status: () => ({
      url: webCapture.url,
      state: "closed",
      detail: "Open the review browser.",
    }),
    open: async () => {},
    review: async () => ({}),
    draft: () => undefined,
    removeSelection: async () => ({ web: null }),
    annotate: async () => ({ web: { before: webCapture, after: [] } }),
    captureAfter: async () => ({ capture: webCapture, preview: "" }),
    focus: async () => ({}),
    close: async () => {},
    ...overrides,
  };
}

async function startTestServer(overrides: Partial<ServerOptions> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-server-"));
  const session = createSession(root, ".review", "HEAD");
  const hub = createHub();
  const options: ServerOptions = {
    port: 0,
    repoRoot: root,
    outDir: ".review",
    range: "HEAD",
    reviewId: "",
    context: 3,
    getDiff: async () => [diffFile()],
    getContext: async () => [{ t: "ctx", o: 2, n: 2, text: "context" }],
    readBlob: async () => new TextEncoder().encode("picture"),
    saveAttachment: async () => "image-hash.png",
    readAttachment: async () => ({
      bytes: new TextEncoder().encode("attachment"),
      type: "image/png",
    }),
    openFile: async () => true,
    getStatuses: async () => [status],
    listReviews: async () => [],
    deleteReviews: async () => [],
    describeReviews: async () => [],
    getGhosts: async () => [],
    importNote: (from, imported) =>
      session.import(imported, [], `${from.file}#${from.id}`),
    session,
    hub,
    ...overrides,
  };
  const server = startServer(options);
  servers.add(server);

  return {
    base: `http://127.0.0.1:${server.port}`,
    hub,
    options,
    server,
  };
}

type StartedServer = {
  base: string;
  hub: Hub;
  options: ServerOptions;
  server: Server;
};

const request = (started: StartedServer, route: string, init?: RequestInit) =>
  fetch(`${started.base}${route}`, init);

beforeAll(() => {
  console.log = () => {};
  console.error = () => {};
});

afterEach(() => {
  for (const server of servers) {
    server.stop(true);
  }
  servers.clear();
});

afterAll(() => {
  console.log = originalLog;
  console.error = originalError;
});

describe("review settings handoff", () => {
  test("retains a run-local snapshot for new editors and announces changes to open editors", async () => {
    const started = await startTestServer();
    const initial = await request(started, "/api/settings");
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toEqual({ settings: null });
    const events: string[] = [];
    const detach = started.hub.add((chunk) => events.push(chunk));
    const settings = {
      enterSaves: true,
      single: true,
      editor: "code",
      disabledHide: ["dist/"],
    };
    const put = await request(started, "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: started.base },
      body: JSON.stringify(settings),
    });
    expect(put.status).toBe(200);
    expect(events).toEqual(['data: {"type":"settings"}\n\n']);
    expect(await (await request(started, "/api/settings")).json()).toEqual({
      settings,
    });
    detach();

    // Settings are browser preferences handed to this server, not a record shared with another run.
    const other = await startTestServer();
    expect(await (await request(other, "/api/settings")).json()).toEqual({
      settings: null,
    });
  });

  test("rejects foreign origins, malformed snapshots and unsupported methods without an event", async () => {
    const started = await startTestServer();
    const events: string[] = [];
    const detach = started.hub.add((chunk) => events.push(chunk));
    expect(
      (
        await request(started, "/api/settings", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            origin: "https://reviewed-app.example",
          },
          body: JSON.stringify({ enterSaves: true }),
        })
      ).status,
    ).toBe(403);
    for (const body of [
      "null",
      "[]",
      '"settings"',
      "true",
      "42",
      '{"enterSaves":{"value":true}}',
    ]) {
      expect(
        (
          await request(started, "/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (await request(started, "/api/settings", { method: "POST" })).status,
    ).toBe(405);
    expect(
      (await request(started, "/api/settings", { method: "PUT", body: "{}" }))
        .status,
    ).toBe(415);
    expect(await (await request(started, "/api/settings")).json()).toEqual({
      settings: null,
    });
    expect(events).toEqual([]);
    detach();
  });
});

describe("combined Git and live-page routes", () => {
  test("diff keeps Git files and its range alongside live-page status", async () => {
    const web = webController();
    const started = await startTestServer({ web, range: "main...HEAD" });
    const response = await request(started, "/api/diff");
    const result = await response.json();
    expect(result.range).toBe("main...HEAD");
    expect(result.files).toEqual([diffFile()]);
    expect(result.web).toEqual(web.status());
  });

  test("visual global notes and diff notes share ordinary save and reply APIs", async () => {
    const started = await startTestServer({ web: webController() });
    const visual: ReviewComment = {
      id: "|@|@|#visual",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "This button has the same problem as [the diff note](lcr:note).",
      web: { before: webCapture, after: [] },
    };
    for (const note of [comment, visual]) {
      const response = await request(started, "/api/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: note }),
      });
      expect(response.status).toBe(200);
    }
    const reply = await request(started, "/api/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: visual.id,
        body: "Keep this conversation in the existing review.",
      }),
    });
    expect(reply.status).toBe(200);
    const doc = await started.options.session.read();
    expect(doc.range).toBe("HEAD");
    expect(doc.notes).toHaveLength(2);
    expect(doc.notes.map((note) => note.id)).toEqual(
      expect.arrayContaining([comment.id, visual.id]),
    );
    const savedVisual = doc.notes.find((note) => note.id === visual.id)!;
    expect(savedVisual.web).toEqual(visual.web);
    expect(savedVisual.messages.at(-1)!.body).toBe(
      "Keep this conversation in the existing review.",
    );
  });

  test("review controller rejects unowned note ids before starting a browser", async () => {
    const started = await startTestServer();
    const web = createWebReview({
      url: webCapture.url,
      repoRoot: started.options.repoRoot,
      outDir: ".review",
      session: started.options.session,
      hub: started.hub,
      reviewUrl: () => started.base,
    });
    for (const id of [
      comment.id,
      "https://example.com/#note=note",
      "|@|@|#missing",
    ]) {
      await expect(web.review(id)).rejects.toThrow(
        "That note no longer exists.",
      );
    }
    expect(web.status().state).toBe("closed");
    expect(web.draft("../capture")).toBeUndefined();
  });

  test("draft lookup is bounded, read-only, and does not open a browser", async () => {
    const token = "c57a083d-1559-4e06-9da8-a56d34788c63";
    const lookups: string[] = [];
    let mutations = 0;
    const started = await startTestServer({
      web: webController({
        draft: (id) => {
          lookups.push(id);
          return id === token
            ? { before: webCapture, after: [], additional: [webCapture] }
            : undefined;
        },
        open: async () => {
          mutations++;
        },
        captureAfter: async () => {
          mutations++;
          return { capture: webCapture, preview: "" };
        },
      }),
    });
    for (let i = 0; i < 2; i++) {
      const response = await request(started, `/api/web/draft?id=${token}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        web: { before: webCapture, after: [], additional: [webCapture] },
      });
    }
    for (const id of ["", "../capture", "a".repeat(129), "unknown"]) {
      expect(
        (await request(started, `/api/web/draft?id=${encodeURIComponent(id)}`))
          .status,
      ).toBe(404);
    }
    expect(lookups).toEqual([token, token, "unknown"]);
    expect(
      (
        await request(started, "/api/web/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: comment.id }),
        })
      ).status,
    ).toBe(405);
    expect(mutations).toBe(0);
  });

  test("an empty but valid draft remains readable without opening the browser", async () => {
    const token = "c57a083d-1559-4e06-9da8-a56d34788c63";
    const started = await startTestServer({
      web: webController({
        draft: (id) => (id === token ? null : undefined),
        open: async () => {
          throw new Error("Draft reads must not open the browser.");
        },
      }),
    });
    const response = await request(started, `/api/web/draft?id=${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ web: null });
    expect((await request(started, "/api/web/draft?id=missing")).status).toBe(
      404,
    );
  });

  test("saved selections can be removed without --web, with comparison ownership and stale-write protection", async () => {
    const started = await startTestServer();
    const second = { ...webCapture, page: "images/second.png" };
    const third = { ...webCapture, page: "images/third.png" };
    const visual: ReviewComment = {
      id: "|@|@|#visual",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "Keep this wording.",
      web: {
        before: webCapture,
        after: [webCapture],
        additional: [second, third],
      },
    };
    await started.options.session.save({ comments: [visual, comment] });
    await started.options.session.answer(
      started.options.session.file,
      visual.id!,
      "Agent reply.",
      "applied",
    );
    const events: string[] = [],
      off = started.hub.add((event) => events.push(event));
    const remove = (index: number, key: string, id = visual.id!) =>
      request(started, "/api/web/selection", {
        method: "POST",
        headers: { "content-type": "application/json", origin: started.base },
        body: JSON.stringify({ id, index, key }),
      });
    const additional = await remove(1, webSelectionKey(second));
    expect(additional.status).toBe(200);
    expect(await additional.json()).toEqual({
      web: { before: webCapture, after: [webCapture], additional: [third] },
    });
    const stale = await remove(1, webSelectionKey(second));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("changed");
    const first = await remove(0, webSelectionKey(webCapture));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ web: { before: third, after: [] } });
    const last = await remove(0, webSelectionKey(third));
    expect(last.status).toBe(200);
    expect(await last.json()).toEqual({ web: null });
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.includes('"type":"review"'))).toBe(
      true,
    );
    const save = await request(started, "/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comment: { ...visual, body: "Stale editor wording." },
      }),
    });
    expect(save.status).toBe(200);
    const restart = createSession(started.options.repoRoot, ".review", "HEAD");
    await restart.adoptMatching();
    const note = (await restart.read()).notes.find(
      (note) => note.id === visual.id,
    )!;
    expect(note.web).toBeUndefined();
    expect(note.body).toBe("Stale editor wording.");
    expect(note.messages[0]!.body).toBe("Agent reply.");
    expect(note.status).toBe("applied");
    expect((await remove(0, webSelectionKey(third))).status).toBe(404);
    expect(
      (await remove(0, webSelectionKey(webCapture), comment.id!)).status,
    ).toBe(404);
    await started.options.session.remove(visual.id!);
    expect((await remove(0, webSelectionKey(third))).status).toBe(404);
    expect(
      (await started.options.session.read()).notes.map((note) => note.id),
    ).toEqual([comment.id]);
    off();
  });

  test("annotations persist independently for subject and after captures without --web or stale text clobbering", async () => {
    const started = await startTestServer();
    const second = { ...webCapture, area: "images/second.png" },
      after = { ...webCapture, area: "images/after.png" };
    const visual: ReviewComment = {
      id: "|@|@|#drawn",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "Keep original evidence.",
      web: { before: webCapture, after: [after], additional: [second] },
    };
    await started.options.session.save({ comments: [visual, comment] });
    await started.options.session.answer(
      started.options.session.file,
      visual.id!,
      "Agent conversation.",
      "applied",
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const image = await saveAttachment(
      started.options.repoRoot,
      ".review",
      png,
      "image/png",
    );
    for (const name of ["area.png", "second.png", "after.png"])
      await writeFile(
        path.join(started.options.repoRoot, ".review", "images", name),
        png,
      );
    const annotation: WebAnnotation = {
      image: "images/" + image,
      width: 1,
      height: 1,
      padding: 0,
      marks: [
        {
          tool: "arrow",
          color: "#ff0000",
          width: 3,
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
        },
      ],
    };
    const events: string[] = [],
      off = started.hub.add((event) => events.push(event));
    const annotate = (
      target: unknown,
      value: WebAnnotation | null = annotation,
      id = visual.id!,
    ) =>
      request(started, "/api/web/annotation", {
        method: "POST",
        headers: { "content-type": "application/json", origin: started.base },
        body: JSON.stringify({ id, target, annotation: value }),
      });
    const subject = {
      kind: "selection",
      index: 1,
      key: webSelectionKey(second),
      expected: "",
    };
    const comparison = {
      kind: "after",
      index: 0,
      key: webSelectionKey(after),
      expected: "",
    };
    const response = await annotate(subject);
    expect(response.status).toBe(200);
    expect((await response.json()).web).toEqual({
      before: webCapture,
      after: [after],
      additional: [{ ...second, annotation }],
    });
    expect((await annotate(subject)).status).toBe(409);
    expect((await annotate({ ...subject, key: "wrong" }, null)).status).toBe(
      409,
    );
    expect((await annotate(comparison)).status).toBe(200);
    expect((await annotate({ ...subject, index: 3 })).status).toBe(409);
    expect((await annotate(subject, annotation, "missing")).status).toBe(404);
    expect((await annotate(subject, annotation, comment.id!)).status).toBe(404);
    expect(
      (
        await annotate(
          {
            kind: "selection",
            index: 0,
            key: webSelectionKey(webCapture),
            expected: "",
          },
          { ...annotation, image: "images/missing.png" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(started, "/api/note", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            comment: { ...visual, body: "Edited in an older tab." },
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await annotate({ ...subject, expected: annotation.image }, null)).status,
    ).toBe(200);
    const restart = createSession(started.options.repoRoot, ".review", "HEAD");
    await restart.adoptMatching();
    const notes = (await restart.read()).notes,
      note = notes.find((note) => note.id === visual.id)!;
    expect(note.web!.before).toEqual(webCapture);
    expect(note.web!.additional![0]).toEqual(second);
    expect(note.web!.after[0]).toEqual({ ...after, annotation });
    expect(note.body).toBe("Edited in an older tab.");
    expect(note.status).toBe("applied");
    expect(note.messages[0]!.body).toBe("Agent conversation.");
    expect(notes.find((note) => note.id === comment.id)!.body).toBe(
      comment.body,
    );
    expect(
      events.filter((event) => event.includes('"type":"review"')),
    ).toHaveLength(4);
    off();
  });

  test("annotation requests enforce same-origin JSON, valid targets and safe existing PNG attachments", async () => {
    const started = await startTestServer();
    const annotation: WebAnnotation = {
      image: "images/proposal.png",
      width: 1,
      height: 1,
      padding: 0,
      marks: [
        {
          tool: "text",
          color: "#123456",
          at: { x: 0, y: 0 },
          text: "Proposal",
          size: 20,
        },
      ],
    };
    const target = {
      kind: "selection" as const,
      index: 0,
      key: webSelectionKey(webCapture),
      expected: "",
    };
    const post = (
      body: unknown,
      headers: Record<string, string> = { "content-type": "application/json" },
    ) =>
      request(started, "/api/web/annotation", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    expect((await request(started, "/api/web/annotation")).status).toBe(405);
    expect((await post({}, {})).status).toBe(415);
    expect(
      (
        await post(
          {},
          {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
        )
      ).status,
    ).toBe(403);
    for (const body of [
      null,
      [],
      {},
      { id: 42, target, annotation },
      { id: "", target, annotation },
      { id: comment.id, draftId: "draft", target, annotation },
      { target, annotation },
      { id: comment.id, target },
      ...[
        { kind: "page" },
        { index: -1 },
        { index: 1.5 },
        { index: 101 },
        { key: 42 },
        { expected: "../secret.png" },
      ].map((patch) => ({
        id: comment.id,
        target: { ...target, ...patch },
        annotation,
      })),
      ...[
        { image: "../secret.png" },
        { image: "images/proposal.svg" },
        { marks: [] },
        { width: 999999 },
      ].map((patch) => ({
        id: comment.id,
        target,
        annotation: { ...annotation, ...patch },
      })),
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(
      (await post({ draftId: "missing", target, annotation })).status,
    ).toBe(404);
    const web = createWebReview({
      url: webCapture.url,
      repoRoot: started.options.repoRoot,
      outDir: ".review",
      session: started.options.session,
      hub: started.hub,
      reviewUrl: () => started.base,
    });
    started.options.web = web;
    expect(
      (await post({ draftId: "missing", target, annotation })).status,
    ).toBe(404);
    await expect(
      web.annotate({ draftId: "missing", target, annotation }),
    ).rejects.toThrow("no longer exists");
    await expect(
      web.annotate({ id: comment.id, draftId: "missing", target, annotation }),
    ).rejects.toThrow("Choose");
    const visual: ReviewComment = {
      id: "|@|@|#secure",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "Original.",
      web: { before: webCapture, after: [] },
    };
    await started.options.session.save({ comments: [visual] });
    const outside = await mkdtemp(path.join(tmpdir(), "lcr-outside-"));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(path.join(outside, "proposal.png"), png);
    await mkdir(path.join(started.options.repoRoot, ".review", "images"), {
      recursive: true,
    });
    await writeFile(
      path.join(started.options.repoRoot, ".review", "images", "area.png"),
      png,
    );
    await symlink(
      path.join(outside, "proposal.png"),
      path.join(started.options.repoRoot, ".review", "images", "proposal.png"),
    );
    expect((await post({ id: visual.id, target, annotation })).status).toBe(
      400,
    );
    expect(
      (await started.options.session.read()).notes[0]!.web!.before.annotation,
    ).toBeUndefined();
    expect(web.status().state).toBe("closed");
    const image = await saveAttachment(
      started.options.repoRoot,
      ".review",
      png,
      "image/png",
    );
    const valid = { ...annotation, image: "images/" + image };
    const writes = await Promise.allSettled([
      web.annotate({ id: visual.id, target, annotation: valid }),
      web.annotate({ id: visual.id, target, annotation: valid }),
    ]);
    expect(writes.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      (await started.options.session.read()).notes[0]!.web!.before.annotation,
    ).toEqual(valid);
    await web.annotate({
      id: visual.id,
      target: { ...target, expected: valid.image },
      annotation: null,
    });
    expect(
      (await started.options.session.read()).notes[0]!.web!.before.annotation,
    ).toBeUndefined();
  });

  test("selection removal requires a bounded index, expected key and same-origin JSON POST", async () => {
    const started = await startTestServer();
    expect((await request(started, "/api/web/selection")).status).toBe(405);
    expect(
      (
        await request(started, "/api/web/selection", {
          method: "POST",
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await request(started, "/api/web/selection", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    for (const body of [
      null,
      {},
      { id: 42, index: 0, key: "key" },
      { id: comment.id, index: 0 },
      ...[-1, 1.5, 101, "0"].map((index) => ({
        id: comment.id,
        index,
        key: "key",
      })),
      { id: comment.id, index: 0, key: 42 },
      { id: comment.id, draftId: "draft", index: 0, key: "key" },
    ]) {
      expect(
        (
          await request(started, "/api/web/selection", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }
    expect(started.options.session.file).toBe("");
  });

  test("controller selection removal is serialized and rejects ambiguous targets without a browser", async () => {
    const started = await startTestServer();
    const visual: ReviewComment = {
      id: "|@|@|#visual",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "Keep note.",
      web: { before: webCapture, after: [webCapture] },
    };
    await started.options.session.save({ comments: [visual] });
    const web = createWebReview({
      url: webCapture.url,
      repoRoot: started.options.repoRoot,
      outDir: ".review",
      session: started.options.session,
      hub: started.hub,
      reviewUrl: () => started.base,
    });
    const selection = { index: 0, key: webSelectionKey(webCapture) };
    await expect(web.removeSelection(selection)).rejects.toThrow(
      "Choose either",
    );
    await expect(
      web.removeSelection({ ...selection, id: visual.id, draftId: "draft" }),
    ).rejects.toThrow("Choose either");
    await expect(
      web.removeSelection({ ...selection, draftId: "missing" }),
    ).rejects.toThrow("no longer exists");
    const results = await Promise.allSettled([
      web.removeSelection({ ...selection, id: visual.id }),
      web.removeSelection({ ...selection, id: visual.id }),
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: { web: null } });
    expect(results[1]!.status).toBe("rejected");
    expect(
      (await started.options.session.read()).notes[0]!.web,
    ).toBeUndefined();
    expect(web.status().state).toBe("closed");
  });

  test("review navigation accepts an optional note id and enforces same-origin JSON POST", async () => {
    const ids: (string | undefined)[] = [];
    const started = await startTestServer({
      web: webController({
        review: async (id) => {
          ids.push(id);
          return {};
        },
      }),
    });
    for (const body of [{}, { id: comment.id }]) {
      const response = await request(started, "/api/web/review", {
        method: "POST",
        headers: { "content-type": "application/json", origin: started.base },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect((await request(started, "/api/web/review")).status).toBe(405);
    expect(
      (
        await request(started, "/api/web/review", {
          method: "POST",
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await request(started, "/api/web/review", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(started, "/api/web/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"id":42}',
        })
      ).status,
    ).toBe(400);
    expect(ids).toEqual([undefined, comment.id]);
  });

  test("live-page routes remain unavailable without --web", async () => {
    const started = await startTestServer();
    expect((await request(started, "/api/web/draft?id=missing")).status).toBe(
      404,
    );
    expect(
      (
        await request(started, "/api/web/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(404);
  });
});

describe("general API routes", () => {
  test("diff returns the complete browser read identity and current status", async () => {
    const started = await startTestServer({
      range: "main...HEAD",
      reviewId: "security-pass",
      context: 8,
    });

    const response = await request(started, "/api/diff");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repo: repoId(started.options.repoRoot),
      range: "main...HEAD",
      id: "security-pass",
      context: 8,
      files: [diffFile()],
      statuses: [status],
    });
  });

  test("context validates the requested inclusive line range", async () => {
    const started = await startTestServer();

    for (const route of [
      "/api/context?start=1&end=2",
      "/api/context?path=app.ts&start=0&end=2",
      "/api/context?path=app.ts&start=4&end=3",
      "/api/context?path=app.ts&start=x&end=3",
    ]) {
      const response = await request(started, route);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "A path and an ascending line range are required.",
      });
    }
  });

  test("context forwards a valid path and range once", async () => {
    const calls: unknown[][] = [];
    const started = await startTestServer({
      getContext: async (...args) => {
        calls.push(args);
        return [{ t: "ctx", o: 2, n: 2, text: "kept" }];
      },
    });

    const response = await request(
      started,
      "/api/context?path=src%2Fapp.ts&start=2&end=5",
    );

    expect(await response.json()).toEqual({
      rows: [{ t: "ctx", o: 2, n: 2, text: "kept" }],
    });
    expect(calls).toEqual([["src/app.ts", 2, 5]]);
  });

  test("unknown routes return a plain 404", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/missing");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });

  test("route failures become JSON errors without taking down the server", async () => {
    const started = await startTestServer({
      getDiff: async () => {
        throw new Error("git failed");
      },
    });

    const failed = await request(started, "/api/diff");
    const healthy = await request(started, "/api/reviews");

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "git failed" });
    expect(healthy.status).toBe(200);
  });
});

describe("open-file API", () => {
  test("accepts only POST requests", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/open-file");

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  test("requires a JSON content type before reading the body", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/open-file", {
      method: "POST",
      body: JSON.stringify({ path: "assets/logo.png" }),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "JSON body required." });
  });

  test("requires a non-empty path", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/open-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A file path is required.",
    });
  });

  test("refuses a path that is not in the current diff", async () => {
    let opened = false;
    const started = await startTestServer({
      openFile: async () => {
        opened = true;
        return true;
      },
    });

    const response = await request(started, "/api/open-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../outside.ts" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "That file is not in this diff.",
    });
    expect(opened).toBe(false);
  });

  test("reports a launcher failure without claiming the file opened", async () => {
    const started = await startTestServer({
      openFile: async () => false,
    });

    const response = await request(started, "/api/open-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "assets/logo.png" }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "The configured editor could not open that file.",
    });
  });

  test("trims the configured editor and opens the selected diff file", async () => {
    const calls: string[][] = [];
    const started = await startTestServer({
      openFile: async (...args) => {
        calls.push(args);
        return true;
      },
    });

    const response = await request(started, "/api/open-file", {
      method: "POST",
      headers: { "content-type": " Application/JSON ; charset=utf-8" },
      body: JSON.stringify({
        path: "assets/logo.png",
        editor: "  code  ",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ opened: "assets/logo.png" });
    expect(calls).toEqual([["assets/logo.png", "code"]]);
  });
});

describe("blob API", () => {
  test("accepts only GET and HEAD requests", async () => {
    const started = await startTestServer();

    const response = await request(
      started,
      "/api/blob?path=assets%2Flogo.png",
      { method: "POST" },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  test("serves supported media with inert-content and revalidation headers", async () => {
    const started = await startTestServer();

    const response = await request(
      started,
      "/api/blob?path=assets%2Flogo.png&side=new",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("picture");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("7");
    expect(response.headers.get("etag")).toBe('"file-hash-new"');
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("HEAD reports the same blob metadata without a body", async () => {
    const started = await startTestServer();

    const response = await request(
      started,
      "/api/blob?path=assets%2Flogo.png",
      { method: "HEAD" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("7");
    expect(await response.text()).toBe("");
  });

  test("a matching ETag avoids reading the blob again", async () => {
    let reads = 0;
    const started = await startTestServer({
      readBlob: async () => {
        reads++;
        return new TextEncoder().encode("picture");
      },
    });

    const response = await request(
      started,
      "/api/blob?path=assets%2Flogo.png&side=old",
      { headers: { "if-none-match": '"file-hash-old"' } },
    );

    expect(response.status).toBe(304);
    expect(reads).toBe(0);
  });

  test("the old side of a rename is read under its former path", async () => {
    const calls: unknown[][] = [];
    const started = await startTestServer({
      getDiff: async () => [
        diffFile({
          from: "assets/old-logo.png",
          status: "renamed",
        }),
      ],
      readBlob: async (...args) => {
        calls.push(args);
        return new TextEncoder().encode("old picture");
      },
    });

    const response = await request(
      started,
      "/api/blob?path=assets%2Flogo.png&side=old",
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([["old", "assets/old-logo.png"]]);
  });

  test("rejects absent sides before trying to read them", async () => {
    let reads = 0;
    const added = await startTestServer({
      getDiff: async () => [diffFile({ status: "added" })],
      readBlob: async () => {
        reads++;
        return null;
      },
    });
    const deleted = await startTestServer({
      getDiff: async () => [diffFile({ status: "deleted" })],
      readBlob: async () => {
        reads++;
        return null;
      },
    });

    const oldResponse = await request(
      added,
      "/api/blob?path=assets%2Flogo.png&side=old",
    );
    const newResponse = await request(
      deleted,
      "/api/blob?path=assets%2Flogo.png&side=new",
    );

    expect(oldResponse.status).toBe(404);
    expect(newResponse.status).toBe(404);
    expect(reads).toBe(0);
  });

  test("rejects files outside the diff and unsupported media", async () => {
    const started = await startTestServer();

    const outside = await request(started, "/api/blob?path=..%2Fsecret.png");
    const unsupportedServer = await startTestServer({
      getDiff: async () => [diffFile({ path: "build/app.wasm" })],
    });
    const unsupported = await request(
      unsupportedServer,
      "/api/blob?path=build%2Fapp.wasm",
    );

    expect(outside.status).toBe(404);
    expect(unsupported.status).toBe(415);
  });
});

describe("attachment APIs", () => {
  test("attach accepts only POST requests with a supported image type", async () => {
    const started = await startTestServer();

    const wrongMethod = await request(started, "/api/attach");
    const wrongType = await request(started, "/api/attach", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not an image",
    });

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect(wrongType.status).toBe(415);
  });

  test("attach rejects an empty image", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/attach", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That image is empty." });
  });

  test("attach stores the exact bytes and returns the Markdown-relative ref", async () => {
    const calls: { bytes: Uint8Array; type: string }[] = [];
    const started = await startTestServer({
      saveAttachment: async (bytes, type) => {
        calls.push({ bytes, type });
        return "sha.png";
      },
    });

    const response = await request(started, "/api/attach", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new TextEncoder().encode("image bytes"),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "sha.png",
      ref: "images/sha.png",
    });
    expect(calls).toEqual([
      {
        bytes: new TextEncoder().encode("image bytes"),
        type: "image/png",
      },
    ]);
  });

  test("attach reports when the store refuses the bytes", async () => {
    const started = await startTestServer({
      saveAttachment: async () => "",
    });

    const response = await request(started, "/api/attach", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new TextEncoder().encode("image bytes"),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: "That image could not be kept.",
    });
  });

  test("attachment serves immutable inert image bytes", async () => {
    const started = await startTestServer();

    const response = await request(
      started,
      "/api/attachment?name=0123456789abcdef.png",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("attachment");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("etag")).toBe('"0123456789abcdef.png"');
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("attachment answers a matching ETag without reading the file", async () => {
    let reads = 0;
    const started = await startTestServer({
      readAttachment: async () => {
        reads++;
        return null;
      },
    });

    const response = await request(
      started,
      "/api/attachment?name=0123456789abcdef.png",
      { headers: { "if-none-match": '"0123456789abcdef.png"' } },
    );

    expect(response.status).toBe(304);
    expect(reads).toBe(0);
  });

  test("named agent images are revalidated by content, so updates do not show stale pixels", async () => {
    const names: string[] = [];
    let body = "first";
    const started = await startTestServer({
      readAttachment: async (name) => {
        names.push(name);
        return { type: "image/png", bytes: new TextEncoder().encode(body) };
      },
    });
    const url =
      "/api/attachment?ref=review-2026-10-29T12-26-26-package-not-ready.png";
    const first = await request(started, url);
    expect(names[0]).toBe("./review-2026-10-29T12-26-26-package-not-ready.png");
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const tag = first.headers.get("etag")!;
    expect(
      (await request(started, url, { headers: { "if-none-match": tag } }))
        .status,
    ).toBe(304);
    body = "updated";
    const updated = await request(started, url, {
      headers: { "if-none-match": tag },
    });
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).not.toBe(tag);
    expect(await updated.text()).toBe("updated");
    await request(started, "/api/attachment?ref=assets%2Fafter.png", {
      method: "HEAD",
    });
    expect(names.at(-1)).toBe("assets/after.png");
  });

  test("attachment reports a missing name and rejects mutation", async () => {
    const started = await startTestServer({
      readAttachment: async () => null,
    });

    const missing = await request(started, "/api/attachment?name=missing.png");
    const mutation = await request(
      started,
      "/api/attachment?name=missing.png",
      { method: "DELETE" },
    );

    expect(missing.status).toBe(404);
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("review conversation APIs", () => {
  test("one note is persisted and queued immediately, without submitting other notes or clicking the footer", async () => {
    const started = await startTestServer();
    const queued: string[][] = [];
    started.options.agent = {
      agent: "External ACP agent",
      publish: async (review, notes) => {
        for (const note of notes)
          expect(
            (await started.options.session.readNote(review, note.id))!.body,
          ).toBe(note.body);
        queued.push(notes.map((note) => note.id));
        return { state: "queued", count: notes.length };
      },
    };
    const post = async (value: object) => {
      const response = await request(started, "/api/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const saved = await post({ comment });
    expect(saved.delivery).toEqual({ state: "queued", count: 1 });
    expect(queued).toEqual([[comment.id!]]);
    expect((await started.options.session.read()).notes).toHaveLength(1);
    await post({ comment });
    expect(queued.at(-1)).toEqual([]);
    await post({
      comment: { ...comment, body: "Why is this fallback needed?" },
    });
    expect(queued.at(-1)).toEqual([comment.id!]);
    await post({ comment, retry: true });
    expect(queued.at(-1)).toEqual([comment.id!]);
  });

  test("without an ACP configuration, notes save locally and no agent is advertised", async () => {
    const started = await startTestServer();
    const status = await (await request(started, "/api/agent")).json();
    expect(status.agent).toBeUndefined();
    expect(status.connection).toBeUndefined();
    const response = await request(started, "/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).delivery).toBeUndefined();
    expect((await started.options.session.read()).notes[0]!.body).toBe(
      comment.body,
    );
  });

  test("single-note writes require JSON and complete note data", async () => {
    const started = await startTestServer();
    expect(
      (await request(started, "/api/note", { method: "POST", body: "{}" }))
        .status,
    ).toBe(415);
    expect(
      (
        await request(started, "/api/note", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: { body: "incomplete" } }),
        })
      ).status,
    ).toBe(400);
    expect((await started.options.session.read()).notes).toEqual([]);
  });

  test("ACP receives reviewer saves and follow-ups, while agent-only changes enqueue nothing", async () => {
    const started = await startTestServer();
    const submitted: string[][] = [];
    started.options.agent = {
      agent: "External ACP agent",
      publish: (_review, notes) => {
        submitted.push(notes.map((note) => note.id));
        return {
          state: notes.length ? "queued" : "unchanged",
          count: notes.length,
        };
      },
    };
    const post = async (route: string, body: object, method = "POST") => {
      const response = await request(started, route, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(
      (await post("/api/submit", { comments: [comment] })).delivery.state,
    ).toBe("queued");
    expect(
      (await post("/api/submit", { comments: [comment] })).delivery.state,
    ).toBe("unchanged");
    const reply = await post("/api/reply", {
      id: comment.id,
      body: "And why?",
    });
    expect(reply.delivery.state).toBe("queued");
    await post(
      "/api/reply",
      {
        id: comment.id,
        at: reply.note.messages[0].at,
        body: "Explain the fallback.",
      },
      "PUT",
    );
    await started.options.session.answer(
      started.options.session.file,
      comment.id!,
      "The fallback handles missing values.",
      "answered",
    );
    expect(submitted.filter((ids) => ids.length)).toHaveLength(3);
    const doc = await (await request(started, "/api/review")).json();
    expect(doc.notes[0].messages.at(-1)).toMatchObject({
      role: "agent",
      body: "The fallback handles missing values.",
    });
    expect(
      (await post("/api/submit", { comments: [comment] })).delivery.state,
    ).toBe("unchanged");
    expect(submitted.filter((ids) => ids.length)).toHaveLength(3);
  });

  test("review GET returns the current file, notes, and statuses", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/review");

    expect(await response.json()).toEqual({
      file: "",
      notes: [],
      statuses: [status],
    });
  });

  test("submit requires a JSON object", async () => {
    const started = await startTestServer();

    const wrongType = await request(started, "/api/submit", {
      method: "POST",
      body: "{}",
    });
    const invalidJson = await request(started, "/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });

    expect(wrongType.status).toBe(415);
    expect(invalidJson.status).toBe(400);
  });

  test("submit persists the notes and reports the saved review", async () => {
    const events: string[] = [];
    const started = await startTestServer();
    started.hub.add((chunk) => events.push(chunk));

    const response = await request(started, "/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comments: [comment] }),
    });
    const body = await response.json();
    const doc = await started.options.session.read();

    expect(response.status).toBe(200);
    expect(body.file).toMatch(/^\.review\/review-.*\.md$/);
    expect(body).toMatchObject({ count: 1, removed: [] });
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({
      id: comment.id,
      body: comment.body,
      file: comment.file,
    });
    expect(events).toEqual([
      `data: ${JSON.stringify({
        type: "review",
        file: started.options.session.file,
      })}\n\n`,
    ]);
  });

  test("starting a new review leaves the saved conversation on disk", async () => {
    const started = await startTestServer();
    const saved = await started.options.session.save({ comments: [comment] });

    const response = await request(started, "/api/review", {
      method: "DELETE",
    });

    expect(await response.json()).toEqual({
      file: "",
      previous: saved.file,
    });
    expect(started.options.session.file).toBe("");
  });

  test("review PUT reopens a saved conversation by file name", async () => {
    const started = await startTestServer();
    await started.options.session.save({ comments: [comment] });
    const name = started.options.session.file;
    started.options.session.startFresh();

    const response = await request(started, "/api/review", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: name }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      file: `.review/${name}`,
    });
    expect((await started.options.session.read()).notes).toHaveLength(1);
  });

  test("review PUT reports a file that no longer exists", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/review", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "review-missing.md" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "That review file does not exist.",
    });
  });

  test("reply refuses a note that has not been saved yet", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: comment.id, body: "Please clarify." }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "That note is not in the review file yet. Save the review first.",
    });
  });

  test("reply appends a trimmed reviewer message to the saved thread", async () => {
    const started = await startTestServer();
    await started.options.session.save({ comments: [comment] });

    const response = await request(started, "/api/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: comment.id,
        body: "  Please add the boundary case.  ",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.note.messages).toHaveLength(1);
    expect(body.note.messages[0]).toMatchObject({
      role: "reviewer",
      body: "Please add the boundary case.",
    });
    expect(body.note.messages[0].at).toMatch(/^\d{4}-\d\d-/);
  });

  test("reply editing requires a message stamp", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/reply", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: comment.id, body: "Reworded." }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A message stamp is required.",
    });
  });

  test("reply DELETE requires both the note id and message stamp", async () => {
    const started = await startTestServer();

    const response = await request(
      started,
      `/api/reply?id=${encodeURIComponent(comment.id ?? "")}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A note id and a message stamp are required.",
    });
  });

  test("note DELETE removes several notes in one session write", async () => {
    const started = await startTestServer();
    const second = {
      ...comment,
      id: "assets/logo.png|n1|n1|#second",
      body: "Second note.",
    };
    await started.options.session.save({ comments: [comment, second] });

    const response = await request(
      started,
      `/api/note?id=${encodeURIComponent(comment.id ?? "")}` +
        `&id=${encodeURIComponent(second.id)}`,
      { method: "DELETE" },
    );

    expect(await response.json()).toEqual({ removed: true });
    expect((await started.options.session.read()).notes).toEqual([]);
  });

  test("reviews GET exposes the configured directory and active session", async () => {
    const review = {
      file: "review-1.md",
      range: "HEAD",
      id: "",
      branch: "main",
      base: "abc",
      notes: 2,
      open: 1,
    };
    const started = await startTestServer({
      describeReviews: async () => [review],
    });

    const response = await request(started, "/api/reviews");

    expect(await response.json()).toEqual({
      dir: ".review",
      reviews: [review],
      session: "",
    });
  });

  test("reviews DELETE removes generated reviews and forgets the session", async () => {
    const started = await startTestServer({
      deleteReviews: async () => ["review-1.md", "review-2.md"],
    });
    await started.options.session.save({ comments: [comment] });

    const response = await request(started, "/api/reviews", {
      method: "DELETE",
    });

    expect(await response.json()).toEqual({
      removed: ["review-1.md", "review-2.md"],
    });
    expect(started.options.session.file).toBe("");
  });

  test("ghosts returns earlier review notes unchanged", async () => {
    const ghost = {
      file: "review-old.md",
      range: "main..HEAD",
      branch: "main",
      notes: [],
    };
    const started = await startTestServer({
      getGhosts: async () => [ghost],
    });

    const response = await request(started, "/api/ghosts");

    expect(await response.json()).toEqual({ ghosts: [ghost] });
  });

  test("import validates the source review and complete comment", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: { file: "review-old.md" },
        comment: { file: "app.ts", body: "Missing id." },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A source review, a note id, and a comment are required.",
    });
  });

  test("import carries the note into the current session with provenance", async () => {
    const started = await startTestServer();

    const response = await request(started, "/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: { file: "review-old.md", id: "old-note" },
        comment,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.note).toMatchObject({
      id: comment.id,
      body: comment.body,
      from: "review-old.md#old-note",
    });
    expect((await started.options.session.read()).notes).toHaveLength(1);
  });
});

describe("live UI browser API", () => {
  test("is unavailable in a diff review and requires JSON and a local origin to launch", async () => {
    const diff = await startTestServer();
    expect((await request(diff, "/api/web")).status).toBe(404);
    let opened = 0,
      captured = "";
    const web = {
      status: () => ({
        url: "http://localhost:3000/",
        state: "closed",
        detail: "Open browser",
      }),
      open: async () => {
        opened++;
      },
      captureAfter: async (id: string) => {
        captured = id;
      },
      focus: async () => {},
      close: async () => {},
    };
    const started = await startTestServer({ web: web as any });
    expect((await (await request(started, "/api/diff")).json()).web.url).toBe(
      "http://localhost:3000/",
    );
    expect(
      (await request(started, "/api/web", { method: "POST" })).status,
    ).toBe(415);
    expect(
      (
        await request(started, "/api/web", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://example.com",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(opened).toBe(0);
    expect(
      (
        await request(started, "/api/web", {
          method: "POST",
          headers: { "content-type": "application/json", origin: started.base },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect(opened).toBe(1);
    expect(
      (await request(started, "/api/web/capture", { method: "GET" })).status,
    ).toBe(405);
    expect(
      (
        await request(started, "/api/web/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(started, "/api/web/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "|@|@|#note" }),
        })
      ).status,
    ).toBe(200);
    expect(captured).toBe("|@|@|#note");
  });
});

describe("managed queue API", () => {
  test("read-only state and same-origin explicit controls expose permissions without granting by polling", async () => {
    const calls: any[] = [];
    const started = await startTestServer({
      agent: {
        agent: "Any external agent",
        status: () => ({
          agent: "Any external agent",
          state: "unavailable",
          detail: "Queued locally",
        }),
        snapshot: () => ({
          paused: true,
          tasks: [],
          permissions: [{ id: "permission-1" }],
        }),
        control: async (...args) => {
          calls.push(args);
        },
        publish: () => ({ state: "queued", count: 1 }),
      },
    });
    const state = await (await request(started, "/api/agent/queue")).json();
    expect(state.queue.permissions).toHaveLength(1);
    expect(calls).toEqual([]);
    const body = JSON.stringify({
      action: "permission",
      id: "permission-1",
      option: "allow-once",
    });
    expect(
      (await request(started, "/api/agent/queue", { method: "POST", body }))
        .status,
    ).toBe(415);
    expect(
      (
        await request(started, "/api/agent/queue", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://unrelated.example",
          },
          body,
        })
      ).status,
    ).toBe(403);
    expect(calls).toEqual([]);
    expect(
      (
        await request(started, "/api/agent/queue", {
          method: "POST",
          headers: { "content-type": "application/json", origin: started.base },
          body,
        })
      ).status,
    ).toBe(200);
    expect(calls).toEqual([["permission", "permission-1", "allow-once"]]);
    const saved = await request(started, "/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    expect(saved.status).toBe(200);
    const note = await saved.json();
    expect(note.connection.state).toBe("unavailable");
    expect(note.delivery).toEqual({ state: "queued", count: 1 });
  });
  test("manual mode does not expose managed controls", async () => {
    const started = await startTestServer();
    expect((await request(started, "/api/agent/queue")).status).toBe(404);
  });
  test("note deletion and reply withdrawal notify only the original review queue", async () => {
    const withdrawn: any[] = [],
      revised: any[] = [];
    const started = await startTestServer({
      agent: {
        agent: "ACP",
        publish: () => ({ state: "queued", count: 1 }),
        withdraw: async (...args) => {
          withdrawn.push(args);
        },
        revise: async (...args) => {
          revised.push(args);
        },
      },
    });
    await started.options.session.save({ comments: [comment] });
    const review = started.options.session.file;
    const note = await started.options.session.reply(
      comment.id!,
      "Later withdrawn",
    );
    await request(
      started,
      "/api/reply?id=" +
        encodeURIComponent(comment.id!) +
        "&at=" +
        encodeURIComponent(note!.messages[0]!.at),
      { method: "DELETE" },
    );
    expect(revised[0][0]).toBe(review);
    expect(revised[0][1].messages).toEqual([]);
    await request(started, "/api/note?id=" + encodeURIComponent(comment.id!), {
      method: "DELETE",
    });
    expect(withdrawn).toEqual([[review, [comment.id]]]);
  });
});
