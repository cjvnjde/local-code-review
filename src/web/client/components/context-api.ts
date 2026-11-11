import {
  CONTEXT_MAX_BYTES,
  CONTEXT_TEXT_LIMIT,
  CONTEXT_TEXT_MAX,
  contextId,
  contextIsText,
  contextLink,
  contextPath,
  contextRef,
  type ContextManifest,
  type ContextPart,
  type ContextRef,
} from "../../../shared/context.ts";
let token = "";
/** The run token is kept only in memory, never in links or browser storage. */
export function setContextToken(value: unknown) {
  token = typeof value === "string" ? value : "";
}
async function contextFetch(path: string, init: RequestInit = {}) {
  if (!token) {
    const settings = await fetch("/api/settings", {
      cache: "no-store",
      signal: init.signal,
    });
    if (!settings.ok) throw new Error("Could not authorize context access.");
    setContextToken((await settings.json()).contextToken);
  }
  if (!token)
    throw new Error("Context access is unavailable. Reload this review.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + token);
  const response = await fetch("/api/ai-context" + path, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.error || "Could not read context (" + response.status + ").",
    );
  }
  return response;
}
export async function uploadContext(
  input:
    | File
    | { label: string; text: string; type: "text/plain" | "application/json" },
  signal?: AbortSignal,
): Promise<ContextRef> {
  let body: BodyInit;
  let headers: HeadersInit | undefined;
  if (input instanceof File) {
    if (!input.size || input.size > CONTEXT_MAX_BYTES)
      throw new Error("Choose a nonempty file up to 12 MiB.");
    const form = new FormData();
    form.append("file", input);
    form.append("label", input.name.slice(0, 200));
    // Carry the declared type separately: multipart readers can lose File.type.
    form.append("type", input.type);
    body = form;
  } else {
    if (!input.text.trim()) throw new Error("Enter some context first.");
    if (new TextEncoder().encode(input.text).length > CONTEXT_MAX_BYTES)
      throw new Error("Context must be no larger than 12 MiB.");
    if (input.type === "application/json") {
      try {
        JSON.parse(input.text);
      } catch {
        throw new Error(
          "The context is not valid JSON. Correct it or choose Plain text.",
        );
      }
    }
    headers = { "content-type": "application/json" };
    body = JSON.stringify(input);
  }
  const response = await contextFetch("", {
    method: "POST",
    body,
    headers,
    signal,
  });
  const ref = contextRef((await response.json()).context);
  if (!ref)
    throw new Error("The server did not return a saved context reference.");
  return ref;
}
export async function fetchContextManifest(
  id: string,
  signal?: AbortSignal,
): Promise<ContextManifest> {
  id = contextId(id);
  if (!id) throw new Error("Invalid context reference.");
  return (await contextFetch("/" + id, { signal })).json();
}
export interface ContextTextChunk {
  part: ContextPart;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalBytes: number;
}
export async function fetchContextText(
  id: string,
  name: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<ContextTextChunk> {
  id = contextId(id);
  if (!id) throw new Error("Invalid context reference.");
  return (
    await contextFetch(
      "/" +
        id +
        "/parts/" +
        encodeURIComponent(name) +
        "?offset=" +
        offset +
        "&limit=" +
        CONTEXT_TEXT_LIMIT,
      { signal },
    )
  ).json();
}
