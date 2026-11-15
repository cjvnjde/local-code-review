import { z } from "zod";

export class RequestInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "RequestInputError";
  }
}

/** Count actual streamed bytes before decoding/parsing; Content-Length is only an early veto. */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError("A positive JSON byte limit is required.");
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length))
      throw new RequestInputError("Invalid Content-Length.");
    if (Number(length) > maxBytes) {
      void request.body?.cancel().catch(() => {});
      throw new RequestInputError(`JSON body exceeds ${maxBytes} bytes.`, 413);
    }
  }
  if (!request.body) throw new RequestInputError("A JSON body is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new RequestInputError(
          `JSON body exceeds ${maxBytes} bytes.`,
          413,
        );
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    // Do not await cancellation: an untrusted producer must not delay an error response.
    void reader.cancel().catch(() => {});
    if (error instanceof RequestInputError) throw error;
    throw new RequestInputError("A valid UTF-8 JSON body is required.");
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestInputError("A valid JSON body is required.");
  }
}

/** Schemas must choose their unknown-key policy explicitly; no input coercion occurs here. */
export function parseRequest<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new RequestInputError(
      `${field}${issue?.message ?? "Invalid request body."}`,
    );
  }
  return parsed.data;
}

export async function readJsonRequest<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number,
): Promise<z.output<S>> {
  return parseRequest(schema, await readBoundedJson(request, maxBytes));
}

/** Reject oversized arrays before Zod visits/allocates a result for every element. */
export function boundedArray<S extends z.ZodType>(schema: S, max: number) {
  return z
    .custom<unknown[]>(
      (value) => Array.isArray(value) && value.length <= max,
      `Expected an array with at most ${max} entries.`,
    )
    .pipe(z.array(schema));
}
