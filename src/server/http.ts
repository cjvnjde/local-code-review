import type { Server } from "bun";
import path from "node:path";
import page from "../web/shell.html";
import { ATTACH_MAX_BYTES, attachRef } from "../review/attach.ts";
import { mediaType } from "../git/blob.ts";
import { fingerprint } from "../git/diff.ts";
import { currentBranch } from "../git/commands.ts";
import type { Hub } from "./events.ts";
import type { GhostGroup, ReviewInfo } from "../review/history.ts";
import type { ReviewSession } from "../review/session.ts";
import type { ReviewNote } from "../review/thread.ts";
import type {
  DiffFile,
  DiffRow,
  NoteStatus,
  ReviewComment,
  ReviewSubmission,
} from "../shared/review-types.ts";
import { VERSION } from "../version.ts";
import type { AgentAdapter } from "../agent/agent-connection.ts";
import {
  webAnnotationTarget,
  WebAnnotationInvalid,
  WebSelectionConflict,
} from "../shared/web-review.ts";
import { webAnnotation } from "../shared/web-annotation.ts";
import {
  DEFAULT_UI_SETTINGS,
  parseUiSettings,
  type UiSettings,
} from "../shared/settings.ts";
import { contextRequestAllowed, contextRoute } from "./context.ts";

export interface ServerOptions {
  web?: import("../web-review/controller.ts").WebReviewController;
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
  /** One side of one file as bytes, for media content a binary diff prints no lines of. */
  readBlob: (side: "old" | "new", path: string) => Promise<Uint8Array | null>;
  /** Keeps exact attachment bytes beside the review and returns their immutable filename. */
  saveAttachment: (
    bytes: Uint8Array,
    type: string,
    filename?: string,
  ) => Promise<string>;
  /** Reads a bounded file from the review's attachment locations. */
  readAttachment: (
    name: string,
  ) => Promise<{ bytes: Uint8Array; type: string } | null>;
  /** Opens one current diff file with a configured executable, or the system default when empty. */
  openFile: (path: string, editor: string) => Promise<boolean>;
  getStatuses: () => Promise<NoteStatus[]>;
  listReviews: () => Promise<string[]>;
  deleteReviews: () => Promise<string[]>;
  /** Every saved review described for the picker. */
  describeReviews: () => Promise<ReviewInfo[]>;
  /** Notes from the other reviews of this branch, for the page to mark beside the diff. */
  getGhosts: () => Promise<GhostGroup[]>;
  /** Carries one note from an earlier review into the session; null when the original is gone. */
  importNote: (
    from: { file: string; id: string },
    comment: ReviewComment,
  ) => Promise<ReviewNote | null>;
  /** The one review file this run is talking through. */
  session: ReviewSession;
  /** Open pages, told whenever the review file or the diff moved. */
  hub: Hub;
  /** Optional ACP connection that queues saved reviewer feedback for managed work. */
  agent?: AgentAdapter;
  /** Effective defaults read from the user's configuration. */
  uiDefaults?: Partial<UiSettings>;
  saveUiSettings?: (patch: Partial<UiSettings>) => Promise<void>;
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

const agentState = (options: ServerOptions) =>
  options.agent
    ? {
        ...(options.agent.snapshot ? { queue: options.agent.snapshot() } : {}),
        connection: options.agent.status?.() ?? {
          agent: options.agent.agent,
          state: "ready",
          detail: "ACP agent connection.",
        },
        agent: options.agent.agent,
      }
    : {};

export function startServer(options: ServerOptions) {
  const server = listen(options.port, (port) => serve(options, port));

  if (options.port !== 0 && server.port !== options.port) {
    console.log(
      `\n  port ${options.port} is in use, using ${server.port} instead`,
    );
  }
  // The banner carries the build stamp: this line is the one place that says which lcr is serving.
  console.log(`\n  git review ${VERSION}  ->  http://localhost:${server.port}`);
  if (options.reviewId) console.log(`  id:   ${options.reviewId}`);
  console.log(`  diff: ${options.range}`);
  if (options.web) console.log(`  page: ${options.web.status().url}`);
  console.log(`  repo: ${options.repoRoot}`);
  console.log(`  out:  ${options.outDir}/`);
  console.log(
    options.session.file
      ? `  review: ${options.session.shownFile} (continuing)\n`
      : "  review: starts on your first save\n",
  );
  return server;
}

/**
 * Walks up from the requested port until one is free, the way a dev server does, so a second
 * review in another repository starts instead of failing. Port 0 means the OS picks, so it is
 * never walked.
 */
export function listen<T>(port: number, open: (port: number) => T): T {
  const last = port === 0 ? port : Math.min(65535, port + PORT_ATTEMPTS - 1);
  for (let candidate = port; candidate <= last; candidate++) {
    try {
      return open(candidate);
    } catch (error) {
      if (!isPortTaken(error)) throw error;
    }
  }
  throw new Error(
    `ports ${port}-${last} are all in use; pass --port to pick another`,
  );
}

function isPortTaken(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

function serve(options: ServerOptions, port: number) {
  // Browser storage is partitioned in an editor embedded under the reviewed app's origin.
  // Editors can open before a full review tab, so this run starts with effective file defaults.
  const runId = crypto.randomUUID();
  const defaults = parseUiSettings(options.uiDefaults ?? {});
  let settings: UiSettings = { ...DEFAULT_UI_SETTINGS, ...defaults };
  let settingsWrites = Promise.resolve();
  const contextToken = crypto.randomUUID();
  options.web?.configureContext(settings);
  options.agent?.contextMode?.(settings.aiContext);
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    routes: {
      "/": async () => {
        // The bundle is only reachable as a route, so the built markup comes back over loopback.
        const bundled = await fetch(
          `http://127.0.0.1:${server.port}${PAGE_PATH}`,
        );
        return new Response(await bundled.bytes(), {
          headers: {
            "content-type": "text/html;charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
      [PAGE_PATH]: page,
    },
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (
          url.pathname === "/api/ai-context" ||
          url.pathname.startsWith("/api/ai-context/")
        )
          return contextRoute(request, options, contextToken, server.port!);
        if (url.pathname === "/api/events")
          return events(options, request, server);
        if (url.pathname === "/api/settings") {
          if (!contextRequestAllowed(request, server.port!))
            return Response.json(
              { error: "Access settings from the review origin." },
              { status: 403 },
            );
          const headers = { "cache-control": "no-store" };
          if (request.method === "GET")
            return Response.json(
              { runId, defaults, settings, contextToken },
              { headers },
            );
          if (request.method !== "PUT")
            return new Response("method not allowed", {
              status: 405,
              headers: { allow: "GET, PUT" },
            });
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const payload = await readJson(request);
          let patch: Partial<UiSettings>;
          try {
            if (JSON.stringify(payload).length > 32768)
              throw new Error("Settings object is too large.");
            patch = parseUiSettings(payload);
          } catch {
            return Response.json(
              { error: "A valid settings object is required." },
              { status: 400 },
            );
          }
          const write = settingsWrites.then(async () => {
            await options.saveUiSettings?.(patch);
            settings = { ...settings, ...patch };
            options.web?.configureContext(settings);
            options.agent?.contextMode?.(settings.aiContext);
            options.hub.emit({ type: "settings" });
          });
          settingsWrites = write.catch(() => {});
          await write;
          return Response.json({ ok: true, settings }, { headers });
        }
        if (url.pathname === "/api/agent/queue") {
          if (!options.agent?.control)
            return Response.json(
              { error: "This connection has no managed execution lifecycle." },
              { status: 404 },
            );
          if (request.method === "GET")
            return Response.json(agentState(options));
          if (request.method !== "POST")
            return new Response("method not allowed", { status: 405 });
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const origin = request.headers.get("origin");
          if (
            origin &&
            ![
              `http://localhost:${server.port}`,
              `http://127.0.0.1:${server.port}`,
            ].includes(origin)
          )
            return Response.json(
              { error: "Use queue controls from the review page." },
              { status: 403 },
            );
          const payload = (await readJson(request)) as {
            action?: unknown;
            id?: unknown;
            option?: unknown;
          } | null;
          if (
            typeof payload?.action !== "string" ||
            (payload.id !== undefined && typeof payload.id !== "string") ||
            (payload.option !== undefined && typeof payload.option !== "string")
          )
            return Response.json(
              { error: "A queue action is required." },
              { status: 400 },
            );
          await options.agent.control(
            payload.action,
            payload.id as string | undefined,
            payload.option as string | undefined,
          );
          return Response.json(agentState(options));
        }
        if (url.pathname === "/api/agent" && request.method === "GET") {
          await options.agent?.check?.();
          return Response.json(agentState(options));
        }
        if (url.pathname === "/api/diff") {
          const [files, statuses, branch] = await Promise.all([
            options.getDiff(),
            options.getStatuses(),
            currentBranch(options.repoRoot),
          ]);
          return Response.json({
            repo: repoId(options.repoRoot),
            range: options.range,
            branch,
            id: options.reviewId,
            context: options.context,
            ...(options.web ? { web: options.web.status() } : {}),
            files,
            statuses,
            ...agentState(options),
          });
        }
        if (url.pathname === "/api/web/annotation") {
          if (request.method !== "POST")
            return new Response("method not allowed", { status: 405 });
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const origin = request.headers.get("origin");
          if (
            origin &&
            ![
              `http://localhost:${server.port}`,
              `http://127.0.0.1:${server.port}`,
            ].includes(origin)
          )
            return Response.json(
              { error: "Open this action from the review page." },
              { status: 403 },
            );
          const payload = (await readJson(request)) as {
            id?: unknown;
            draftId?: unknown;
            target?: unknown;
            annotation?: unknown;
          } | null;
          const target = webAnnotationTarget(payload?.target);
          const annotation =
            payload?.annotation === null
              ? null
              : webAnnotation(payload?.annotation);
          const hasNote = payload?.id !== undefined,
            hasDraft = payload?.draftId !== undefined;
          if (
            !payload ||
            hasNote === hasDraft ||
            !target ||
            (payload.annotation !== null && !annotation) ||
            (hasNote && (typeof payload.id !== "string" || !payload.id)) ||
            (hasDraft &&
              (typeof payload.draftId !== "string" || !payload.draftId))
          )
            return Response.json(
              {
                error:
                  "A draft or note id, expected capture target and valid annotation are required.",
              },
              { status: 400 },
            );
          if (hasDraft) {
            if (
              !options.web ||
              options.web.draft(payload.draftId as string) === undefined
            )
              return Response.json(
                { error: "That captured selection no longer exists." },
                { status: 404 },
              );
            return Response.json(
              await options.web.annotate({
                draftId: payload.draftId as string,
                target,
                annotation,
              }),
            );
          }
          const note = await options.session.annotateWebCapture(
            payload.id as string,
            target,
            annotation,
          );
          if (!note?.web)
            return Response.json(
              { error: "That UI capture no longer exists." },
              { status: 404 },
            );
          options.hub.emit({ type: "review", file: options.session.file });
          return Response.json({ web: note.web });
        }
        if (url.pathname === "/api/web/selection") {
          if (request.method !== "POST")
            return new Response("method not allowed", { status: 405 });
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const origin = request.headers.get("origin");
          if (
            origin &&
            ![
              `http://localhost:${server.port}`,
              `http://127.0.0.1:${server.port}`,
            ].includes(origin)
          )
            return Response.json(
              { error: "Open this action from the review page." },
              { status: 403 },
            );
          const payload = (await readJson(request)) as {
            id?: unknown;
            draftId?: unknown;
            index?: unknown;
            key?: unknown;
          } | null;
          if (
            !payload ||
            (payload.id !== undefined) === (payload.draftId !== undefined) ||
            (payload.id !== undefined &&
              (typeof payload.id !== "string" || !payload.id)) ||
            (payload.draftId !== undefined &&
              (typeof payload.draftId !== "string" || !payload.draftId)) ||
            typeof payload.index !== "number" ||
            !Number.isInteger(payload.index) ||
            payload.index < 0 ||
            payload.index > 100 ||
            typeof payload.key !== "string"
          )
            return Response.json(
              {
                error:
                  "A note or draft id, selection index and expected key are required.",
              },
              { status: 400 },
            );
          if (typeof payload.draftId === "string") {
            if (
              !options.web ||
              options.web.draft(payload.draftId) === undefined
            )
              return Response.json(
                { error: "That captured selection no longer exists." },
                { status: 404 },
              );
            return Response.json(
              await options.web.removeSelection({
                draftId: payload.draftId,
                index: payload.index,
                key: payload.key,
              }),
            );
          }
          const note = await options.session.removeWebSelection(
            payload.id as string,
            payload.index,
            payload.key,
          );
          if (!note)
            return Response.json(
              { error: "That UI selection no longer exists." },
              { status: 404 },
            );
          options.hub.emit({ type: "review", file: options.session.file });
          return Response.json({ web: note.web ?? null });
        }
        if (
          [
            "/api/web",
            "/api/web/capture",
            "/api/web/focus",
            "/api/web/draft",
            "/api/web/review",
          ].includes(url.pathname)
        ) {
          if (!options.web)
            return Response.json(
              { error: "This is not a web review." },
              { status: 404 },
            );
          if (request.method === "GET" && url.pathname === "/api/web")
            return Response.json(options.web.status());
          if (url.pathname === "/api/web/draft" && request.method === "GET") {
            const noteId = url.searchParams.get("note");
            if (noteId !== null) {
              if (
                !(await options.session.read()).notes.some(
                  (note) => note.id === noteId,
                )
              )
                return Response.json(
                  { error: "That note no longer exists." },
                  { status: 404 },
                );
              return Response.json(options.web.replyDraft(noteId));
            }
            const id = url.searchParams.get("id") ?? "";
            const web = /^[a-zA-Z0-9_-]{1,128}$/.test(id)
              ? options.web.draft(id)
              : undefined;
            return web !== undefined
              ? Response.json({ web })
              : Response.json(
                  { error: "That captured selection no longer exists." },
                  { status: 404 },
                );
          }
          if (
            request.method !== "POST" &&
            !(url.pathname === "/api/web/draft" && request.method === "DELETE")
          )
            return new Response("method not allowed", { status: 405 });
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const origin = request.headers.get("origin");
          if (
            origin &&
            ![
              `http://localhost:${server.port}`,
              `http://127.0.0.1:${server.port}`,
            ].includes(origin)
          )
            return Response.json(
              { error: "Open this action from the review page." },
              { status: 403 },
            );
          server.timeout(request, 0); // Browser startup and capture own their bounded timeouts.
          const payload = (await readJson(request)) as {
            id?: unknown;
            draftId?: unknown;
          } | null;
          if (url.pathname === "/api/web/draft") {
            if (request.method !== "DELETE")
              return new Response("method not allowed", { status: 405 });
            if (typeof payload?.draftId !== "string")
              return Response.json(
                { error: "A draft id is required." },
                { status: 400 },
              );
            await options.web.discardDraft(payload.draftId);
            return Response.json({ ok: true });
          }
          if (url.pathname === "/api/web") {
            await options.web.open();
            return Response.json(options.web.status());
          }
          if (url.pathname === "/api/web/review") {
            if (payload?.id !== undefined && typeof payload.id !== "string")
              return Response.json(
                { error: "A note id must be a string." },
                { status: 400 },
              );
            await options.web.review(payload?.id);
            return Response.json({ ok: true });
          }
          if (typeof payload?.id !== "string")
            return Response.json(
              { error: "A note id is required." },
              { status: 400 },
            );
          if (url.pathname === "/api/web/focus") {
            await options.web.focus(payload.id);
            return Response.json({ ok: true });
          }
          return Response.json(await options.web.captureAfter(payload.id));
        }
        if (url.pathname === "/api/context") {
          const path = url.searchParams.get("path") ?? "";
          const start = Number(url.searchParams.get("start"));
          const end = Number(url.searchParams.get("end"));
          if (
            !path ||
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 1 ||
            end < start
          ) {
            return Response.json(
              { error: "A path and an ascending line range are required." },
              { status: 400 },
            );
          }
          return Response.json({
            rows: await options.getContext(path, start, end),
          });
        }
        if (url.pathname === "/api/blob") return blob(options, request, url);
        if (url.pathname === "/api/attach") {
          if (!contextRequestAllowed(request, server.port!))
            return Response.json(
              { error: "Attach files from the review origin." },
              { status: 403 },
            );
          return attach(options, request);
        }
        if (url.pathname === "/api/attachment")
          return attachment(options, request, url);
        if (url.pathname === "/api/open-file") {
          if (request.method !== "POST") {
            return new Response("method not allowed", {
              status: 405,
              headers: { allow: "POST" },
            });
          }
          // JSON makes this a preflighted cross-origin request: another page cannot turn the
          // configurable executable into a local launcher, while this loopback page needs no CORS.
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const payload = (await readJson(request)) as {
            path?: unknown;
            editor?: unknown;
          } | null;
          const path = typeof payload?.path === "string" ? payload.path : "";
          const editor =
            typeof payload?.editor === "string" ? payload.editor.trim() : "";
          if (!path)
            return Response.json(
              { error: "A file path is required." },
              { status: 400 },
            );
          const file = (await options.getDiff()).find(
            (entry) => entry.path === path,
          );
          if (!file)
            return Response.json(
              { error: "That file is not in this diff." },
              { status: 404 },
            );
          if (!(await options.openFile(path, editor))) {
            return Response.json(
              { error: "The configured editor could not open that file." },
              { status: 500 },
            );
          }
          console.log(
            `\n  opened ${path} with ${editor || "the system default"}\n`,
          );
          return Response.json({ opened: path });
        }
        if (url.pathname === "/api/review") {
          if (request.method === "GET") {
            // Statuses ride along: a reply and the verdict it explains are written in the same pass,
            // so the page must not have to ask for the diff again to see one of them.
            const [doc, statuses] = await Promise.all([
              options.session.read(),
              options.getStatuses(),
            ]);
            return Response.json({
              file: options.session.shownFile,
              notes: doc.notes,
              statuses,
              ...agentState(options),
            });
          }
          // Starting fresh only forgets which file we were in; the old one stays on disk as history.
          if (request.method === "DELETE") {
            const previous = options.session.shownFile;
            // Queued behind any save in flight, so its tail cannot write into the file just left.
            await options.session.run(async () => options.session.startFresh());
            console.log(
              `\n  new review started${previous ? `; ${previous} left as it is` : ""}\n`,
            );
            options.hub.emit({ type: "review", file: "" });
            return Response.json({ file: "", previous });
          }
          // Reopens an earlier review: the conversation moves into that file, notes and threads and all.
          if (request.method === "PUT") {
            if (!isJsonRequest(request))
              return Response.json(
                { error: "JSON body required." },
                { status: 415 },
              );
            const payload = (await readJson(request)) as {
              file?: unknown;
            } | null;
            const file =
              payload && typeof payload.file === "string" ? payload.file : "";
            if (!file)
              return Response.json(
                { error: "A review file name is required." },
                { status: 400 },
              );
            // Queued behind any save in flight, so its tail cannot write into the file just left.
            const opened = await options.session.run(() =>
              options.session.adoptFile(file),
            );
            if (!opened)
              return Response.json(
                { error: "That review file does not exist." },
                { status: 404 },
              );
            console.log(`\n  reopened ${options.session.shownFile}\n`);
            options.hub.emit({ type: "review", file: options.session.file });
            return Response.json({ file: options.session.shownFile });
          }
          return new Response("method not allowed", {
            status: 405,
            headers: { allow: "GET, PUT, DELETE" },
          });
        }
        // The reviewer's side of a thread: sent, rewritten, or taken back. A message is named by the
        // stamp in its marker, which is what a rewrite keeps and what a withdrawal is asked for by.
        if (url.pathname === "/api/reply") {
          if (request.method === "POST" || request.method === "PUT") {
            if (!isJsonRequest(request))
              return Response.json(
                { error: "JSON body required." },
                { status: 415 },
              );
            const payload = (await readJson(request)) as {
              id?: unknown;
              at?: unknown;
              body?: unknown;
              ask?: boolean;
            } | null;
            if (!payload)
              return Response.json(
                { error: "A JSON body is required." },
                { status: 400 },
              );
            const id = typeof payload.id === "string" ? payload.id : "";
            const at = typeof payload.at === "string" ? payload.at : "";
            const body =
              typeof payload.body === "string" ? payload.body.trim() : "";
            if (!id || !body)
              return Response.json(
                { error: "A note id and a message are required." },
                { status: 400 },
              );
            if (request.method === "PUT" && !at) {
              return Response.json(
                { error: "A message stamp is required." },
                { status: 400 },
              );
            }
            const review = options.session.file;
            const note =
              request.method === "POST"
                ? await options.session.reply(id, body, review)
                : await options.session.editReply(id, at, body, review);
            if (!note)
              return Response.json(
                { error: missing(request.method) },
                { status: 404 },
              );
            console.log(
              `\n  ${request.method === "POST" ? "replied" : "reworded a reply"} on ${note.key} in ${options.session.shownFile}\n`,
            );
            options.hub.emit({ type: "review", file: options.session.file });
            const delivery =
              !settings.aiAnswers || payload.ask === false
                ? undefined
                : await options.agent?.publish(review, [note]);
            return Response.json({
              file: options.session.shownFile,
              note,
              ...agentState(options),
              ...(delivery ? { delivery } : {}),
            });
          }
          if (request.method === "DELETE") {
            const id = url.searchParams.get("id") ?? "";
            const at = url.searchParams.get("at") ?? "";
            if (!id || !at) {
              return Response.json(
                { error: "A note id and a message stamp are required." },
                { status: 400 },
              );
            }
            const review = options.session.file;
            const note = await options.session.dropReply(id, at, review);
            if (!note)
              return Response.json(
                { error: missing(request.method) },
                { status: 404 },
              );
            await options.agent?.revise?.(review, note);
            console.log(
              `\n  took a reply back on ${note.key} in ${options.session.shownFile}\n`,
            );
            options.hub.emit({ type: "review", file: options.session.file });
            return Response.json({ file: options.session.shownFile, note });
          }
          return new Response("method not allowed", {
            status: 405,
            headers: { allow: "POST, PUT, DELETE" },
          });
        }
        if (url.pathname === "/api/note" && request.method === "POST") {
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const payload = (await readJson(request)) as {
            comment?: ReviewComment;
            retry?: boolean;
            replace?: boolean;
            ask?: boolean;
          } | null;
          const comment = payload?.comment;
          if (
            !comment ||
            typeof comment.id !== "string" ||
            !comment.id ||
            typeof comment.file !== "string" ||
            typeof comment.body !== "string" ||
            !comment.body.trim() ||
            !Number.isInteger(comment.start) ||
            !Number.isInteger(comment.end) ||
            comment.start < 0 ||
            comment.end < comment.start
          ) {
            return Response.json(
              {
                error:
                  "A complete note with an id, body, file and line range is required.",
              },
              { status: 400 },
            );
          }
          const { file, changed, removed } = await options.session.save(
            { comments: [comment] },
            payload?.replace === true,
          );
          for (const old of removed) await options.agent?.withdraw?.(old);
          const review = path.basename(file);
          const notify = changed.length
            ? changed
            : payload?.retry
              ? [await options.session.readNote(review, comment.id)].filter(
                  (note): note is ReviewNote => !!note,
                )
              : [];
          const delivery =
            !settings.aiAnswers || payload?.ask === false
              ? undefined
              : await options.agent?.publish(review, notify);
          options.hub.emit({ type: "review", file: review });
          return Response.json({
            file,
            id: comment.id,
            ...agentState(options),
            ...(delivery ? { delivery } : {}),
          });
        }
        if (url.pathname === "/api/note" && request.method === "DELETE") {
          // Many ids in one request: clearing the page is one withdrawal, not one per note.
          const ids = url.searchParams.getAll("id").filter((id) => id);
          if (!ids.length)
            return Response.json(
              { error: "A note id is required." },
              { status: 400 },
            );
          const review = options.session.file;
          const removed = await options.session.remove(ids, review);
          if (removed) await options.agent?.withdraw?.(review, ids);
          if (removed)
            options.hub.emit({ type: "review", file: options.session.file });
          return Response.json({ removed });
        }
        if (url.pathname === "/api/submit" && request.method === "POST") {
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const payload = (await readJson(
            request,
          )) as Partial<ReviewSubmission> | null;
          if (!payload)
            return Response.json(
              { error: "A JSON body is required." },
              { status: 400 },
            );
          const submission = {
            comments: Array.isArray(payload.comments) ? payload.comments : [],
          };
          const { file, removed, changed } = await options.session.save(
            submission,
            (payload as { replace?: unknown }).replace === true,
          );
          console.log(
            `\n  saved ${file}  (${submission.comments.length} notes)`,
          );
          if (removed.length)
            console.log(
              `  replaced ${plural(removed.length, "earlier review file")}`,
            );
          if (!options.agent)
            console.log(
              `  next: ask the agent to "address the notes in ${file}"\n`,
            );
          options.hub.emit({ type: "review", file: options.session.file });
          for (const old of removed) await options.agent?.withdraw?.(old);
          const delivery = settings.aiAnswers
            ? await options.agent?.publish(path.basename(file), changed)
            : undefined;
          return Response.json({
            file,
            count: submission.comments.length,
            removed,
            ...agentState(options),
            ...(delivery ? { delivery } : {}),
          });
        }
        if (url.pathname === "/api/ghosts") {
          return Response.json({ ghosts: await options.getGhosts() });
        }
        if (url.pathname === "/api/import" && request.method === "POST") {
          if (!isJsonRequest(request))
            return Response.json(
              { error: "JSON body required." },
              { status: 415 },
            );
          const payload = (await readJson(request)) as {
            from?: { file?: unknown; id?: unknown };
            comment?: unknown;
          } | null;
          const file =
            typeof payload?.from?.file === "string" ? payload.from.file : "";
          const id =
            typeof payload?.from?.id === "string" ? payload.from.id : "";
          const comment =
            payload?.comment && typeof payload.comment === "object"
              ? (payload.comment as ReviewComment)
              : null;
          if (
            !file ||
            !id ||
            !comment ||
            typeof comment.id !== "string" ||
            typeof comment.body !== "string"
          ) {
            return Response.json(
              {
                error:
                  "A source review, a note id, and a comment are required.",
              },
              { status: 400 },
            );
          }
          const note = await options.importNote({ file, id }, comment);
          if (!note) {
            return Response.json(
              { error: "That note is no longer in its review file." },
              { status: 404 },
            );
          }
          console.log(
            `\n  continued ${note.key} from ${file} in ${options.session.shownFile}\n`,
          );
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
            for (const old of removed) await options.agent?.withdraw?.(old);
            console.log(
              `\n  deleted ${plural(removed.length, "review file")} from ${options.outDir}/\n`,
            );
            options.hub.emit({ type: "review", file: "" });
            return Response.json({ removed });
          }
          return new Response("method not allowed", {
            status: 405,
            headers: { allow: "GET, DELETE" },
          });
        }
        return new Response("not found", { status: 404 });
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        return Response.json(
          { error: message },
          {
            status:
              error instanceof WebSelectionConflict
                ? 409
                : error instanceof WebAnnotationInvalid
                  ? 400
                  : 500,
          },
        );
      }
    },
  });
  options.agent?.contextAccess?.({
    url: `http://127.0.0.1:${server.port}/api/ai-context`,
    token: contextToken,
  });

  return server;
}

/**
 * One side of one image or recording, straight out of the repository. The diff is what says which
 * files exist to be asked for — a path it does not list is not served, whatever it points at — and
 * file status says which of its two sides exists. A side before an addition or after a deletion
 * answers 404 rather than an empty media file.
 *
 * A diff refresh redraws every file, so the same media is asked for again and again; the file's own
 * hash is its ETag, which turns all but the first of those into a 304 and keeps media from reloading
 * on every repaint.
 */
async function blob(
  options: ServerOptions,
  request: Request,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  const wanted = url.searchParams.get("path") ?? "";
  const side = url.searchParams.get("side") === "old" ? "old" : "new";
  const file = (await options.getDiff()).find((entry) => entry.path === wanted);
  if (!file)
    return Response.json(
      { error: "That file is not in this diff." },
      { status: 404 },
    );
  // A rename moved the file, so its old side is still under the name it had then.
  const from = side === "old" ? (file.from ?? file.path) : file.path;
  const type = mediaType(from);
  if (!type)
    return Response.json(
      { error: "That file is not supported media." },
      { status: 415 },
    );
  if (side === "old" ? file.status === "added" : file.status === "deleted") {
    return Response.json(
      { error: `The ${side} side has no such file.` },
      { status: 404 },
    );
  }
  const tag = `"${file.hash}-${side}"`;
  if (request.headers.get("if-none-match") === tag) {
    return new Response(null, {
      status: 304,
      headers: { etag: tag, "cache-control": "no-cache" },
    });
  }
  const bytes = await options.readBlob(side, from);
  if (!bytes)
    return Response.json(
      { error: "That file could not be read." },
      { status: 404 },
    );
  return new Response(request.method === "HEAD" ? null : bytes, {
    headers: {
      "content-type": type,
      "content-length": String(bytes.byteLength),
      etag: tag,
      "cache-control": "no-cache",
      // Only ever rendered as inert media; this policy also protects a file opened in its own tab.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Uploads raw attachment bytes before the note itself is saved. */
async function attach(
  options: ServerOptions,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  const type = request.headers.get("content-type") ?? "";
  let filename: string;
  try {
    filename = decodeURIComponent(
      request.headers.get("x-attachment-name") ?? "attachment",
    );
  } catch {
    return Response.json(
      { error: "Invalid attachment filename." },
      { status: 400 },
    );
  }
  if (Number(request.headers.get("content-length")) > ATTACH_MAX_BYTES)
    return Response.json(
      { error: "That file exceeds the 12 MiB attachment limit." },
      { status: 413 },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > ATTACH_MAX_BYTES) {
          await reader.cancel();
          return Response.json(
            { error: "That file exceeds the 12 MiB attachment limit." },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const name = await options.saveAttachment(bytes, type, filename);
  if (!name)
    return Response.json(
      { error: "That file could not be kept." },
      { status: 415 },
    );
  console.log(`\n  attached ${attachRef(name)} in ${options.outDir}/\n`);
  return Response.json({ name, ref: attachRef(name) });
}

/**
 * Uploaded hash names are immutable. Agent pictures have descriptive names and may change, so their
 * ETags come from their bytes and each request revalidates rather than keeping stale pixels forever.
 */
async function attachment(
  options: ServerOptions,
  request: Request,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  const ref = url.searchParams.get("ref");
  const name =
    ref == null
      ? (url.searchParams.get("name") ?? "")
      : /^(?:images\/|assets\/)/.test(ref)
        ? ref
        : `./${ref}`;
  const immutable =
    ref == null &&
    /^[a-f0-9]{16}\.(?:png|jpg|gif|webp|avif|bmp|svg|apng)$/.test(name);
  let tag = `"${name}"`;
  // Only uploaded, content-addressed pictures can answer without re-reading their bytes.
  if (immutable && request.headers.get("if-none-match") === tag) {
    return new Response(null, { status: 304, headers: { etag: tag } });
  }
  const found = await options.readAttachment(name);
  if (!found)
    return Response.json({ error: "No such attachment." }, { status: 404 });
  if (!immutable)
    tag = `"${new Bun.CryptoHasher("sha256").update(found.bytes).digest("hex")}"`;
  if (request.headers.get("if-none-match") === tag) {
    return new Response(null, {
      status: 304,
      headers: { etag: tag, "cache-control": "no-cache" },
    });
  }
  const download =
    url.searchParams.has("download") ||
    !/^image\/(?:png|jpeg|gif|webp|avif|bmp|apng|x-icon|vnd\.microsoft\.icon)$/i.test(
      found.type,
    );
  const filename =
    name
      .split("/")
      .pop()!
      .replace(/^[a-f0-9]{16}-/, "")
      .replace(/[^A-Za-z0-9._-]/g, "_") || "attachment";
  return new Response(request.method === "HEAD" ? null : found.bytes, {
    headers: {
      // SVG decoding needs its image MIME; attachment disposition still prevents active navigation.
      "content-type":
        found.type === "image/svg+xml"
          ? found.type
          : download
            ? "application/octet-stream"
            : found.type,
      ...(download
        ? { "content-disposition": `attachment; filename="${filename}"` }
        : {}),
      "content-length": String(found.bytes.byteLength),
      etag: tag,
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      // Uploads never receive script execution, including SVG images opened directly.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * The page's live connection. Events say only that something moved; the page fetches the new state
 * itself, so a dropped or repeated event costs a fetch rather than correctness.
 */
function events(
  options: ServerOptions,
  request: Request,
  server: Server,
): Response {
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
      send(
        `data: ${JSON.stringify({ type: "hello", file: options.session.shownFile })}\n\n`,
      );
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
  return (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
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
