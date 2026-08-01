import page from "./web/shell.html";
import { SkillPreviewChangedError } from "./skill.ts";
import type { SkillInstallResult, SkillPreview, SkillTargetState } from "./skill.ts";
import type { DiffFile, ReviewSubmission } from "./types.ts";

export interface ServerOptions {
  port: number;
  repoRoot: string;
  outDir: string;
  range: string;
  getDiff: () => Promise<DiffFile[]>;
  saveReview: (submission: ReviewSubmission) => Promise<string>;
  previewSkill: () => Promise<SkillPreview>;
  installSkill: (
    directory: string,
    expectedState: "create" | "replace",
    expectedRevision: string | null,
  ) => Promise<SkillInstallResult>;
}

export function startServer(options: ServerOptions) {
  let skillConfirmationToken = "";
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    routes: { "/": page },
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname === "/api/diff") {
          const files = await options.getDiff();
          return Response.json({ range: options.range, files });
        }
        if (url.pathname === "/api/submit" && request.method === "POST") {
          if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
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
        if (url.pathname === "/api/skill") {
          if (request.method === "GET") {
            skillConfirmationToken = crypto.randomUUID();
            return Response.json({ ...await options.previewSkill(), confirmationToken: skillConfirmationToken });
          }
          if (request.method === "POST") {
            if (!isJsonRequest(request)) return Response.json({ error: "JSON body required." }, { status: 415 });
            const payload = await request.json() as {
              directory?: unknown;
              expectedState?: unknown;
              expectedRevision?: unknown;
              confirmationToken?: unknown;
            };
            if (payload.confirmationToken !== skillConfirmationToken || !skillConfirmationToken) {
              return Response.json({ error: "Skill confirmation expired. Reopen the preview." }, { status: 403 });
            }
            if (
              typeof payload.directory !== "string" ||
              !isInstallState(payload.expectedState) ||
              !(payload.expectedRevision === null || typeof payload.expectedRevision === "string")
            ) {
              return Response.json({ error: "Valid skill target, state, and revision are required." }, { status: 400 });
            }
            skillConfirmationToken = "";
            const result = await options.installSkill(
              payload.directory,
              payload.expectedState,
              payload.expectedRevision,
            );
            console.log(`\n  skill ${result.state}: ${result.path}\n`);
            return Response.json(result);
          }
          return new Response("method not allowed", { status: 405, headers: { allow: "GET, POST" } });
        }
        return new Response("not found", { status: 404 });
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof SkillPreviewChangedError ? 409 : 500;
        return Response.json({ error: message }, { status });
      }
    },
  });

  console.log(`\n  git review  ->  http://localhost:${server.port}`);
  console.log(`  diff: ${options.range}`);
  console.log(`  repo: ${options.repoRoot}`);
  console.log(`  out:  ${options.outDir}/\n`);
  return server;
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isInstallState(value: unknown): value is Extract<SkillTargetState, "create" | "replace"> {
  return value === "create" || value === "replace";
}
