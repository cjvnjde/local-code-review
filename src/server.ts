import type { Server } from "bun";
import page from "./web/shell.html";
import { fingerprint } from "./diff.ts";
import type { Hub } from "./events.ts";
import type { GhostGroup, ReviewInfo } from "./history.ts";
import type { ReviewSession } from "./session.ts";
import type { ReviewNote } from "./thread.ts";
import type { DiffFile, DiffRow, NoteStatus, ReviewComment, ReviewSubmission } from "./types.ts";

export interface ServerOptions {
  port: number;
  repoRoot: string;
  outDir: string;
  range: string;
  /**
   * Name this review was started under, from `--id`; empty when the diff is the identity. The page
   * keys its own store on it, so a name it has not seen before starts with nothing stored.
   */
  reviewId: string;
  /** `-U` value the diff was produced with; the page needs it to spot a trailing hidden region. */
  context: number;
  getDiff: () => Promise<DiffFile[]>;
  getContext: (path: string, start: number, end: number) => Promise<DiffRow[]>;
  getStatuses: () => Promise<NoteStatus[]>;
  listReviews: () => Promise<string[]>;
  deleteReviews: () => Promise<string[]>;
  /** Every saved review described for the picker. */
  describeReviews: () => Promise<ReviewInfo[]>;
  /** Notes from the other reviews of this branch, for the page to mark beside the diff. */
  getGhosts: () => Promise<GhostGroup[]>;
  /** Carries one note from an earlier review into the session; null when the original is gone. */
  importNote: (from: { file: string; id: string }, comment: ReviewComment) => Promise<ReviewNote | null>;
  /** The one review file this run is talking through. */
  session: ReviewSession;
  /** Open pages, told whenever the review file or the diff moved. */
  hub: Hub;
}

/**
 * Bun's HTML route answers with one ETag for every build, so a browser that kept an older page
 * revalidates straight back into it and then asks for asset chunks that build no longer has: no
 * styles and no client script. The bundle therefore stays on `PAGE_PATH`, which keeps its hashed
 * chunk URLs reachable, while `/` hands out the same markup with caching switched off.
 */
const PAGE_PATH = "/index.html";

/** Ports tried, counting the requested one, before start gives up. */
export const PORT_ATTEMPTS = 10;

/**
 * Which repository the page is reading, for the browser store to key itself on. Every run serves
 * from `localhost`, and a port freed by one review is taken by the next, so the origin alone cannot
 * tell two projects apart: without this they share one localStorage record. Hashed rather than sent
 * whole, because the store outlives the run and a working-copy path is not the page's to keep.
 */
export const repoId = (repoRoot: string) => fingerprint(repoRoot);

export function startServer(options: ServerOptions) {
  const server = listen(options.port, (port) => serve(options, port));

  if (options.port !== 0 && server.port !== options.port) {
    console.log(`\n  port ${options.port} is in use, using ${server.port} instead`);
  }
  console.log(`\n  git review  ->  http://localhost:${server.port}`);
  if (options.reviewId) console.log(`  id:   ${options.reviewId}`);
  console.log(`  diff: ${options.range}`);
  console.log(`  repo: ${options.repoRoot}`);
  console.log(`  out:  ${options.outDir}/`);
  console.log(options.session.file
    ? `  review: ${options.session.shownFile} (continuing)\n`
    : "  review: starts on your first save\n");
  return server;
}

/**
 * Walks up from the requested port until one is free, the way a dev server does, so a second
 * review in another repository starts instead of failing. Port 0 means the OS picks, so it is
 * never walked.
 */
export function listen<T>(port: number, open: (port: number) => T): T {
  const last = port === 0 ? port : port + PORT_ATTEMPTS - 1;
  for (let candidate = port; candidate <= last; candidate++) {
    try {
      return open(candidate);
    } catch (error) {
      if (!isPortTaken(error)) throw error;
    }
  }
  throw new Error(`ports ${port}-${last} are all in use; pass --port to pick another`);
}

function isPortTaken(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EADDRINUSE";
}

function serve(options: ServerOptions, port: number) {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    routes: {
      "/": async () => {
        // The bundle is only reachable as a route, so the built markup comes back over loopback.
        const bundled = await fetch(`http://127.0.0.1:${server.port}${PAGE_PATH}`);
        return new Response(await bundled.bytes(), {
          headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" },
        });
      },
      [PAGE_PATH]: page,
    },
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname === "/api/events") return events(options, request, server);
        if (url.pathname === "/api/diff") {
          const [files, statuses] = await Promise.all([options.getDiff(), options.getStatuses()]);
          return Response.json({
            repo: repoId(options.repoRoot),
            range: options.range,
            id: options.reviewId,
            context: options.context,
            files,
            statuses,
          });
        }
        if (url.pathname === "/api/context") {
          const path = url.searchParams.get("path") ?? "";
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          if (!path || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
            return Response.json({ error: "A path and an ascending line range are required." }, { status: 400 });
          }
          return Response.json({ rows: await options.getContext(path, start, end) });
        }
        if (url.pathname === "/api/review") {
          if (request.method === "GET") {
            // Statuses ride along: a reply and the verdict it explains are written in the same pass,
            // so the page must not have to ask for the diff again to see one of them.
            const [doc, statuses] = await Promise.all([options.session.read(), options.getStatuses()]);
            return Response.json({
              file: options.session.shownFile,
              notes: doc.notes,
              statuses,
            });
          }
          // Starting fresh only forgets which file we were in; the old one stays on disk as history.
          if (request.method === "DELETE") {
            const previous = options.session.shownFile;
            // Queued behind any save in flight, so its tail cannot write into the file just left.
            await options.session.run(async () => options.session.startFresh());
            console.log(`\n  new review started${previous ? `; ${previous} left as it is` : ""}\n`);
            options.hub.emit({ type: "review", file: "" });
            return Response.json({ file: "", previous });
          }
          // Reopens an earlier review: the conversation moves into that file, notes and threads and all.
          if (request.method === "PUT") {
            if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
            const payload = await readJson(request) as { file?: unknown } | null;
            const file = payload && typeof payload.file === "string" ? payload.file : "";
            if (!file) return Response.json({ error: "A review file name is required." }, { status: 400 });
            // Queued behind any save in flight, so its tail cannot write into the file just left.
            const opened = await options.session.run(() => options.session.adoptFile(file));
            if (!opened) return Response.json({ error: "That review file does not exist." }, { status: 404 });
            console.log(`\n  reopened ${options.session.shownFile}\n`);
            options.hub.emit({ type: "review", file: options.session.file });
            return Response.json({ file: options.session.shownFile });
          }
          return new Response("method not allowed", { status: 405, headers: { allow: "GET, PUT, DELETE" } });
        }
        // The reviewer's side of a thread: sent, rewritten, or taken back. A message is named by the
        // stamp in its marker, which is what a rewrite keeps and what a withdrawal is asked for by.
        if (url.pathname === "/api/reply") {
          if (request.method === "POST" || request.method === "PUT") {
            if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
            const payload = await readJson(request) as { id?: unknown; at?: unknown; body?: unknown } | null;
            if (!payload) return Response.json({ error: "A JSON body is required." }, { status: 400 });
            const id = typeof payload.id === "string" ? payload.id : "";
            const at = typeof payload.at === "string" ? payload.at : "";
            const body = typeof payload.body === "string" ? payload.body.trim() : "";
            if (!id || !body) return Response.json({ error: "A note id and a message are required." }, { status: 400 });
            if (request.method === "PUT" && !at) {
              return Response.json({ error: "A message stamp is required." }, { status: 400 });
            }
            const note = request.method === "POST"
              ? await options.session.reply(id, body)
              : await options.session.editReply(id, at, body);
            if (!note) return Response.json({ error: missing(request.method) }, { status: 404 });
            console.log(
              `\n  ${request.method === "POST" ? "replied" : "reworded a reply"} on ${note.key} in ${options.session.shownFile}\n`,
            );
            options.hub.emit({ type: "review", file: options.session.file });
            return Response.json({ file: options.session.shownFile, note });
          }
          if (request.method === "DELETE") {
            const id = url.searchParams.get("id") ?? "";
            const at = url.searchParams.get("at") ?? "";
            if (!id || !at) {
              return Response.json({ error: "A note id and a message stamp are required." }, { status: 400 });
            }
            const note = await options.session.dropReply(id, at);
            if (!note) return Response.json({ error: missing(request.method) }, { status: 404 });
            console.log(`\n  took a reply back on ${note.key} in ${options.session.shownFile}\n`);
            options.hub.emit({ type: "review", file: options.session.file });
            return Response.json({ file: options.session.shownFile, note });
          }
          return new Response("method not allowed", { status: 405, headers: { allow: "POST, PUT, DELETE" } });
        }
        if (url.pathname === "/api/note" && request.method === "DELETE") {
          // Many ids in one request: clearing the page is one withdrawal, not one per note.
          const ids = url.searchParams.getAll("id").filter((id) => id);
          if (!ids.length) return Response.json({ error: "A note id is required." }, { status: 400 });
          const removed = await options.session.remove(ids);
          if (removed) options.hub.emit({ type: "review", file: options.session.file });
          return Response.json({ removed });
        }
        if (url.pathname === "/api/submit" && request.method === "POST") {
          if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
          const payload = await readJson(request) as Partial<ReviewSubmission> | null;
          if (!payload) return Response.json({ error: "A JSON body is required." }, { status: 400 });
          const submission = { comments: Array.isArray(payload.comments) ? payload.comments : [] };
          const { file, removed } = await options.session.save(
            submission,
            (payload as { replace?: unknown }).replace === true,
          );
          console.log(`\n  saved ${file}  (${submission.comments.length} notes)`);
          if (removed.length) console.log(`  replaced ${plural(removed.length, "earlier review file")}`);
          console.log(`  next: ask the agent to "address the notes in ${file}"\n`);
          options.hub.emit({ type: "review", file: options.session.file });
          return Response.json({ file, count: submission.comments.length, removed });
        }
        if (url.pathname === "/api/ghosts") {
          return Response.json({ ghosts: await options.getGhosts() });
        }
        if (url.pathname === "/api/import" && request.method === "POST") {
          if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
          const payload = await readJson(request) as {
            from?: { file?: unknown; id?: unknown };
            comment?: unknown;
          } | null;
          const file = typeof payload?.from?.file === "string" ? payload.from.file : "";
          const id = typeof payload?.from?.id === "string" ? payload.from.id : "";
          const comment = payload?.comment && typeof payload.comment === "object"
            ? payload.comment as ReviewComment
            : null;
          if (!file || !id || !comment || typeof comment.id !== "string" || typeof comment.body !== "string") {
            return Response.json({ error: "A source review, a note id, and a comment are required." }, { status: 400 });
          }
          const note = await options.importNote({ file, id }, comment);
          if (!note) {
            return Response.json({ error: "That note is no longer in its review file." }, { status: 404 });
          }
          console.log(`\n  continued ${note.key} from ${file} in ${options.session.shownFile}\n`);
          options.hub.emit({ type: "review", file: options.session.file });
          return Response.json({ file: options.session.shownFile, note });
        }
        if (url.pathname === "/api/reviews") {
          if (request.method === "GET") {
            return Response.json({
              dir: options.outDir,
              reviews: await options.describeReviews(),
              session: options.session.file,
            });
          }
          if (request.method === "DELETE") {
            // Queued behind any save in flight: deleting mid-save would let its write resurrect
            // the file while the session had already forgotten it.
            const removed = await options.session.run(async () => {
              const names = await options.deleteReviews();
              // The conversation went with them, so the next save opens a new one.
              options.session.startFresh();
              return names;
            });
            console.log(`\n  deleted ${plural(removed.length, "review file")} from ${options.outDir}/\n`);
            options.hub.emit({ type: "review", file: "" });
            return Response.json({ removed });
          }
          return new Response("method not allowed", { status: 405, headers: { allow: "GET, DELETE" } });
        }
        return new Response("not found", { status: 404 });
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ error: message }, { status: 500 });
      }
    },
  });

  return server;
}

/**
 * The page's live connection. Events say only that something moved; the page fetches the new state
 * itself, so a dropped or repeated event costs a fetch rather than correctness.
 */
function events(options: ServerOptions, request: Request, server: Server): Response {
  // A quiet review is the normal case, and a connection that sends nothing reads to the runtime as
  // idle: left at the ten-second default it would be cut and reopened all day, and the heartbeat
  // that is meant to hold it open would never arrive in time. Only this route waits on the reviewer,
  // so only this route drops the limit.
  server.timeout(request, 0);
  const encoder = new TextEncoder();
  let detach: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send(`data: ${JSON.stringify({ type: "hello", file: options.session.shownFile })}\n\n`);
      detach = options.hub.add(send);
      request.signal.addEventListener("abort", () => {
        detach?.();
        detach = null;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the page went away.
        }
      });
    },
    cancel() {
      detach?.();
      detach = null;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

/** Why a thread could not be written to: the note is not in the file, or the message is not yours. */
function missing(method: string): string {
  return method === "POST"
    ? "That note is not in the review file yet. Save the review first."
    : "That message is not one of yours in the review file any more.";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

/** The parsed object a request carries, or null for a body that is not a JSON object. */
async function readJson(request: Request): Promise<unknown | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
