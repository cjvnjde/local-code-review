import page from "./web/shell.html";
import type { DiffFile, ReviewSubmission } from "./types.ts";

export interface ServerOptions {
  port: number;
  repoRoot: string;
  outDir: string;
  range: string;
  getDiff: () => Promise<DiffFile[]>;
  saveReview: (submission: ReviewSubmission) => Promise<string>;
}

export function startServer(options: ServerOptions) {
  const server = Bun.serve({
    port: options.port,
    routes: { "/": page },
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname === "/api/diff") {
          const files = await options.getDiff();
          return Response.json({ range: options.range, files });
        }
        if (url.pathname === "/api/submit" && request.method === "POST") {
          const payload = await request.json() as Partial<ReviewSubmission>;
          const submission = {
            general: payload.general ?? "",
            comments: payload.comments ?? [],
          };
          const file = await options.saveReview(submission);
          console.log(`\n  saved ${file}  (${submission.comments.length} notes)`);
          console.log(`  next: ask the agent to "address the notes in ${file}"\n`);
          return Response.json({ file, count: submission.comments.length });
        }
        return new Response("not found", { status: 404 });
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ error: message }, { status: 500 });
      }
    },
  });

  console.log(`\n  git review  ->  http://localhost:${server.port}`);
  console.log(`  diff: ${options.range}`);
  console.log(`  repo: ${options.repoRoot}`);
  console.log(`  out:  ${options.outDir}/\n`);
  return server;
}
