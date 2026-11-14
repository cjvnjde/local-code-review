import {
  CONTEXT_TEXT_LIMIT,
  contextId,
  type ContextManifest,
  type ContextPart,
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
