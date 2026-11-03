import { attachExtension, attachRef } from "../review/attach.ts";
import {
  contextTextSlice,
  readContext,
  readContextPart,
  saveContext,
} from "../review/context.ts";
import {
  CONTEXT_MAX_BYTES,
  contextId,
  contextIsText,
  contextLink,
  contextPath,
} from "../shared/context.ts";

export interface ContextRouteOptions {
  repoRoot: string;
  outDir: string;
  saveAttachment: (bytes: Uint8Array, type: string) => Promise<string>;
}
export function contextRequestAllowed(request: Request, port: number): boolean {
  const url = new URL(request.url);
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  return (
    url.protocol === "http:" &&
    allowed.includes(url.host) &&
    host === url.host &&
    (!origin || origin === url.origin)
  );
}
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
class ContextRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
/** Bound the body before parsing multipart or JSON, including chunked requests. */
async function uploadBody(request: Request, json = false) {
  // JSON escaping can use six request bytes for one byte of saved text.
  const max = CONTEXT_MAX_BYTES * (json ? 6 : 1) + 64 * 1024;
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > max))
    throw new ContextRequestError("Context upload exceeds 12 MiB.", 413);
  if (!request.body)
    throw new ContextRequestError("Context upload body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ContextRequestError("Context upload exceeds 12 MiB.", 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
}
function numberParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new ContextRequestError(`${key} must be a non-negative integer.`);
  return Number(value);
}
async function saveImage(
  options: ContextRouteOptions,
  bytes: Uint8Array,
  type: string,
) {
  const saved = await options.saveAttachment(bytes, type);
  if (!saved)
    throw new ContextRequestError("Image attachment is empty or unsupported.");
  return attachRef(saved);
}
export async function contextRoute(
  request: Request,
  options: ContextRouteOptions,
  token: string,
  port: number,
): Promise<Response> {
  if (
    !contextRequestAllowed(request, port) ||
    request.headers.get("authorization") !== `Bearer ${token}`
  )
    return Response.json(
      {
        error:
          "Context access requires this review's same-origin authorization token.",
      },
      { status: 403, headers },
    );
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/ai-context") {
      if (request.method !== "POST")
        return new Response("method not allowed", {
          status: 405,
          headers: { ...headers, allow: "POST" },
        });
      const contentType = request.headers.get("content-type") ?? "";
      let label: string;
      let type: string;
      let bytes: Uint8Array;
      if (/^application\/json(?:\s*;|$)/i.test(contentType)) {
        let payload: unknown;
        try {
          payload = JSON.parse(await (await uploadBody(request, true)).text());
        } catch (error) {
          if (error instanceof ContextRequestError) throw error;
          throw new ContextRequestError("Invalid context JSON.");
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw new ContextRequestError(
            "Context JSON must contain label and text.",
          );
        const input = payload as Record<string, unknown>;
        if (
          typeof input.label !== "string" ||
          typeof input.text !== "string" ||
          (input.type !== undefined &&
            input.type !== "text/plain" &&
            input.type !== "application/json")
        )
          throw new ContextRequestError(
            "Context JSON requires label, text, and optional text/plain or application/json type.",
          );
        label = input.label;
        type = (input.type as string | undefined) ?? "text/plain";
        if (type === "application/json") {
          try {
            JSON.parse(input.text);
          } catch {
            throw new ContextRequestError("Context text is not valid JSON.");
          }
        }
        bytes = new TextEncoder().encode(input.text);
      } else if (/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
        let form: FormData;
        try {
          form = await new Response(await uploadBody(request), {
            headers: { "content-type": contentType },
          }).formData();
        } catch (error) {
          if (error instanceof ContextRequestError) throw error;
          throw new ContextRequestError("Invalid multipart context upload.");
        }
        const file = form.get("file");
        const suppliedLabel = form.get("label");
        const suppliedType = form.get("type");
        if (
          !(file instanceof File) ||
          (suppliedLabel !== null && typeof suppliedLabel !== "string") ||
          (suppliedType !== null && typeof suppliedType !== "string") ||
          form.getAll("file").length !== 1 ||
          form.getAll("label").length > 1 ||
          form.getAll("type").length > 1
        )
          throw new ContextRequestError(
            "Upload one file with an optional text label and media type.",
          );
        label = suppliedLabel ?? file.name;
        type = (suppliedType || file.type)
          .toLowerCase()
          .split(";", 1)[0]!
          .trim();
        if (!attachExtension(type) && !contextIsText(type))
          type = "application/octet-stream";
        bytes = new Uint8Array(await file.arrayBuffer());
        if (contextIsText(type)) {
          try {
            new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            throw new ContextRequestError("Text context must be valid UTF-8.");
          }
        }
      } else
        throw new ContextRequestError(
          "Use application/json or multipart/form-data.",
          415,
        );
      if (!label.trim() || label.length > 200 || /[\x00-\x1f\x7f]/.test(label))
        throw new ContextRequestError(
          "Context labels must contain 1–200 printable characters.",
        );
      if (bytes.byteLength > CONTEXT_MAX_BYTES)
        throw new ContextRequestError("Context upload exceeds 12 MiB.", 413);
      const part = {
        name: "content",
        label,
        type,
        ...(attachExtension(type)
          ? { attachment: await saveImage(options, bytes, type) }
          : { data: bytes }),
      };
      const context = await saveContext(options.repoRoot, options.outDir, {
        label,
        parts: [part],
      });
      return Response.json(
        {
          context,
          ref: contextPath(context.id),
          markdown: contextLink(context),
        },
        { headers },
      );
    }
    if (request.method !== "GET")
      return new Response("method not allowed", {
        status: 405,
        headers: { ...headers, allow: "GET" },
      });
    const match =
      /^\/api\/ai-context\/([a-f0-9]{64})(?:\/parts\/([A-Za-z0-9][A-Za-z0-9_-]{0,99}))?$/.exec(
        url.pathname,
      );
    if (!match || !contextId(match[1]))
      throw new ContextRequestError("Unknown context resource.", 404);
    const id = match[1]!;
    if (!match[2]) {
      const manifest = await readContext(options.repoRoot, options.outDir, id);
      if (!manifest)
        throw new ContextRequestError(
          "Context bundle is missing or incomplete.",
          404,
        );
      return Response.json(manifest, { headers });
    }
    const found = await readContextPart(
      options.repoRoot,
      options.outDir,
      id,
      match[2],
    );
    if (!found)
      throw new ContextRequestError(
        "Context part is missing or unavailable.",
        404,
      );
    if (contextIsText(found.part.type)) {
      let slice;
      try {
        slice = contextTextSlice(
          found.bytes,
          numberParam(url, "offset"),
          numberParam(url, "limit"),
        );
      } catch (error) {
        throw new ContextRequestError(
          error instanceof Error ? error.message : "Invalid text range.",
        );
      }
      return Response.json({ part: found.part, ...slice }, { headers });
    }
    if (url.searchParams.has("offset") || url.searchParams.has("limit"))
      throw new ContextRequestError(
        "Binary parts do not support text pagination.",
      );
    const safeImage = /^image\/(?:png|jpeg|gif|webp|avif|bmp|apng)$/.test(
      found.part.type,
    );
    return new Response(found.bytes, {
      headers: {
        ...headers,
        "content-type": safeImage
          ? found.part.type
          : "application/octet-stream",
        "content-disposition": `attachment; filename="${found.part.name}"`,
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Context request failed.",
      },
      {
        status: error instanceof ContextRequestError ? error.status : 500,
        headers,
      },
    );
  }
}
