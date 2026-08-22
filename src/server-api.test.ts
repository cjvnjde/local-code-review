import type { Server } from "bun";
import { mkdtemp } from "node:fs/promises";
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
import { createSession } from "./session.ts";
import { repoId, startServer } from "./server.ts";
import type { ServerOptions } from "./server.ts";
import type {
  DiffFile,
  NoteStatus,
  ReviewComment,
} from "./types.ts";

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
    getContext: async () => [
      { t: "ctx", o: 2, n: 2, text: "context" },
    ],
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
    importNote: (from, imported) => session.import(
      imported,
      [],
      `${from.file}#${from.id}`,
    ),
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

const request = (
  started: StartedServer,
  route: string,
  init?: RequestInit,
) => fetch(`${started.base}${route}`, init);

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
    expect(await response.json()).toEqual({ error: "A file path is required." });
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
      getDiff: async () => [diffFile({
        from: "assets/old-logo.png",
        status: "renamed",
      })],
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

    const outside = await request(
      started,
      "/api/blob?path=..%2Fsecret.png",
    );
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
    expect(calls).toEqual([{
      bytes: new TextEncoder().encode("image bytes"),
      type: "image/png",
    }]);
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
      "/api/attachment?name=image-hash.png",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("attachment");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("etag")).toBe('"image-hash.png"');
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
      "/api/attachment?name=image-hash.png",
      { headers: { "if-none-match": '"image-hash.png"' } },
    );

    expect(response.status).toBe(304);
    expect(reads).toBe(0);
  });

  test("attachment reports a missing name and rejects mutation", async () => {
    const started = await startTestServer({
      readAttachment: async () => null,
    });

    const missing = await request(
      started,
      "/api/attachment?name=missing.png",
    );
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
      `/api/note?id=${encodeURIComponent(comment.id ?? "")}`
        + `&id=${encodeURIComponent(second.id)}`,
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
