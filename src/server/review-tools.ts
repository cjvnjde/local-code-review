import path from "node:path";
import { z } from "zod";
import type { ReviewRoundStore } from "../review/rounds.ts";
import type { ServerOptions } from "./http.ts";
import { contextRequestAllowed } from "./context.ts";
import { JSON_LIMITS } from "./request-schemas.ts";
import {
  boundedArray,
  parseRequest,
  readJsonRequest,
  RequestInputError,
} from "./request.ts";

const emptyBody = z.strictObject({});
const findingsBody = z.strictObject({
  ids: boundedArray(z.string().min(1).max(200), 500).refine(
    (ids) => ids.length > 0,
    "Choose at least one finding.",
  ),
});
const verificationBody = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const roundId = z.uuid();
const listQuery = z.strictObject({
  archived: z.enum(["0", "1"]).optional(),
  offset: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .optional(),
});
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
const methodNotAllowed = (allow: string) =>
  new Response("method not allowed", {
    status: 405,
    headers: { ...headers, allow },
  });

type ReviewToolsOptions = Pick<
  ServerOptions,
  "repoRoot" | "outDir" | "session" | "web" | "hub"
>;

/** These endpoints expose repository/page evidence, so reads also require the loopback origin. */
export async function reviewToolsRoute(
  request: Request,
  url: URL,
  options: ReviewToolsOptions,
  rounds: ReviewRoundStore,
  port: number,
): Promise<Response> {
  if (!contextRequestAllowed(request, port))
    return json({ error: "Access review tools from the review origin." }, 403);
  const accessibility = url.pathname === "/api/web/accessibility";
  const saveFindings = url.pathname === "/api/web/accessibility/notes";
  const collection = url.pathname === "/api/review-rounds";
  const match = /^\/api\/review-rounds\/([^/]+)(?:\/(verify|archive))?$/.exec(
    url.pathname,
  );
  if (!accessibility && !saveFindings && !collection && !match)
    return json({ error: "Unknown review tool endpoint." }, 404);
  const id = match ? parseRequest(roundId, match[1]) : undefined;
  const action = match?.[2];

  if (request.method === "GET" && collection) {
    const query = parseRequest(listQuery, Object.fromEntries(url.searchParams));
    const offset = Number(query.offset ?? "0");
    if (!Number.isSafeInteger(offset))
      throw new RequestInputError("Invalid round offset.");
    return json({
      rounds: await rounds.list({ archived: query.archived === "1", offset }),
    });
  }
  if (request.method === "GET" && id && !action)
    return json(await rounds.compare(id));
  if (request.method !== "POST")
    return methodNotAllowed(
      collection ? "GET, POST" : id && !action ? "GET" : "POST",
    );
  if (id && !action) return methodNotAllowed("GET");
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  )
    return json({ error: "JSON body required." }, 415);

  if (accessibility || saveFindings) {
    if (!options.web) return json({ error: "This is not a web review." }, 404);
    if (saveFindings) {
      const body = await readJsonRequest(
        request,
        findingsBody,
        JSON_LIMITS.control,
      );
      return json(await options.web.saveAccessibilityFindings(body.ids));
    }
    await readJsonRequest(request, emptyBody, JSON_LIMITS.control);
    return json(await options.web.scanAccessibility());
  }
  if (id && action === "verify") {
    const body = await readJsonRequest(
      request,
      verificationBody,
      JSON_LIMITS.control,
    );
    const comparison = await rounds.verify(id, body.fingerprint);
    options.hub.emit({ type: "review", file: options.session.file });
    return json(comparison);
  }
  await readJsonRequest(request, emptyBody, JSON_LIMITS.control);
  if (id && action === "archive") {
    await rounds.archive(id);
    options.hub.emit({ type: "review", file: options.session.file });
    return json({ ok: true });
  }
  const doc = await options.session.read();
  const review = options.session.file
    ? path.resolve(options.repoRoot, options.outDir, options.session.file)
    : "";
  const round = await rounds.capture({
    source: "manual",
    review,
    notes: doc.notes.map((note) => ({
      review,
      noteId: note.id,
      file: note.file,
      label: note.label,
    })),
  });
  options.hub.emit({ type: "review", file: options.session.file });
  return json(round);
}
