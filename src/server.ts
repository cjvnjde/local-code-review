import page from "./web/shell.html";
import type { SaveResult } from "./output.ts";
import type { DiffFile, DiffRow, NoteStatus, ReviewSubmission } from "./types.ts";

export interface ServerOptions {
  port: number;
  repoRoot: string;
  outDir: string;
  range: string;
  /** `-U` value the diff was produced with; the page needs it to spot a trailing hidden region. */
  context: number;
  getDiff: () => Promise<DiffFile[]>;
  getContext: (path: string, start: number, end: number) => Promise<DiffRow[]>;
  getStatuses: () => Promise<NoteStatus[]>;
  listReviews: () => Promise<string[]>;
  deleteReviews: () => Promise<string[]>;
  saveReview: (submission: ReviewSubmission, replace: boolean) => Promise<SaveResult>;
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

export function startServer(options: ServerOptions) {
  const server = listen(options.port, (port) => serve(options, port));

  if (server.port !== options.port) {
    console.log(`\n  port ${options.port} is in use, using ${server.port} instead`);
  }
  console.log(`\n  git review  ->  http://localhost:${server.port}`);
  console.log(`  diff: ${options.range}`);
  console.log(`  repo: ${options.repoRoot}`);
  console.log(`  out:  ${options.outDir}/\n`);
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
        if (url.pathname === "/api/diff") {
          const [files, statuses] = await Promise.all([options.getDiff(), options.getStatuses()]);
          return Response.json({ range: options.range, context: options.context, files, statuses });
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
        if (url.pathname === "/api/submit" && request.method === "POST") {
          if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
          const payload = await request.json() as Partial<ReviewSubmission>;
          const submission = {
            general: payload.general ?? "",
            comments: payload.comments ?? [],
          };
          const { file, removed } = await options.saveReview(
            submission,
            (payload as { replace?: unknown }).replace === true,
          );
          console.log(`\n  saved ${file}  (${submission.comments.length} notes)`);
          if (removed.length) console.log(`  replaced ${plural(removed.length, "earlier review file")}`);
          console.log(`  next: ask the agent to "address the notes in ${file}"\n`);
          return Response.json({ file, count: submission.comments.length, removed });
        }
        if (url.pathname === "/api/reviews") {
          if (request.method === "GET") {
            return Response.json({ dir: options.outDir, files: await options.listReviews() });
          }
          if (request.method === "DELETE") {
            const removed = await options.deleteReviews();
            console.log(`\n  deleted ${plural(removed.length, "review file")} from ${options.outDir}/\n`);
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

