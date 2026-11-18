import type { Cdp, CdpCommand, CdpParams } from "../browser/cdp.ts";
import type { ContextPartInput } from "../review/context.ts";
import { REDACTION_OMISSION } from "../shared/redaction.ts";
import { boundedRequest, safeEvidenceUrl } from "./evidence.ts";

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_SOURCE = 256 * 1024;
const MAX_RESOURCES = 100;
const MAX_SOURCE_TOTAL = 1024 * 1024;
const definitions = [
  {
    name: "full-page-html",
    label: "Full document HTML source",
    type: "text/plain",
  },
  {
    name: "full-page-css",
    label: "Loaded stylesheet sources",
    type: "application/json",
  },
  {
    name: "full-page-js",
    label: "Loaded script sources",
    type: "application/json",
  },
];

type Source = {
  kind: "inline" | "resource";
  frame?: string;
  url?: string;
  index?: number;
  status: "available" | "unavailable";
  source?: string;
  truncated?: boolean;
  detail?: string;
};

function boundedText(text: string, limit: number) {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return { source: text, truncated: false };
  let end = limit;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { source: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

/** Runs in the page through Runtime.evaluate. Keep its limits explicit at the call site. */
function documentSources(
  maxHtml: number,
  maxSource: number,
  count: number,
  budget: number,
) {
  const html =
    (document.doctype
      ? new XMLSerializer().serializeToString(document.doctype) + "\n"
      : "") + (document.documentElement?.outerHTML || "");
  const nodes = document.querySelectorAll("style,script:not([src])");
  const inline = [];
  const encoder = new TextEncoder();
  const buffer = new Uint8Array(maxSource);
  for (
    let index = 0;
    index < Math.min(nodes.length, count) && budget > 0;
    index++
  ) {
    const node = nodes[index]!;
    const text = node.textContent || "";
    const { read, written } = encoder.encodeInto(
      text,
      buffer.subarray(0, budget),
    );
    inline.push({
      kind: node.localName,
      index,
      source: text.slice(0, read),
      truncated: read < text.length,
    });
    budget -= written;
  }
  return {
    html: html.slice(0, maxHtml),
    truncated: html.length > maxHtml,
    partial: inline.length < nodes.length,
    inline,
  };
}

/** Capture-only text evidence. Never fetch URLs or render these sources as HTML. */
export async function fullPageSources(
  cdp: Pick<Cdp, "send"> | null,
  session: string,
  policy: { enabled: boolean; private: boolean; point: boolean },
): Promise<ContextPartInput[]> {
  const omission = policy.private
    ? REDACTION_OMISSION
    : policy.point
      ? "Point selections contain metadata only."
      : !policy.enabled
        ? "Full-page source context was disabled at capture time."
        : "";
  if (omission)
    return definitions.map((part) => ({
      ...part,
      status: "excluded",
      detail: omission,
    }));
  const deadline = Date.now() + 3000;
  function send<M extends CdpCommand>(method: M, params: CdpParams<M>) {
    if (!cdp)
      throw new Error("The reviewed browser was not attached at capture time.");
    if (Date.now() >= deadline)
      throw new Error("Source capture deadline exceeded.");
    return boundedRequest(
      cdp.send(method, params, session),
      deadline - Date.now(),
    );
  }
  const parts: ContextPartInput[] = [];
  const css: Source[] = [],
    js: Source[] = [];
  let partial = false;
  // Leave room for JSON escaping and provenance below the 12 MiB part limit.
  let remaining = MAX_SOURCE_TOTAL;
  const add = (list: Source[], entry: Source, source: string) => {
    const bounded = boundedText(source, Math.min(MAX_SOURCE, remaining));
    remaining -= Buffer.byteLength(bounded.source);
    partial ||= bounded.truncated;
    list.push({ ...entry, ...bounded });
  };
  try {
    // Bound values in the page before transporting them. Inline text is captured
    // alongside the HTML, including scripts that have no network resource entry.
    const result = await send("Runtime.evaluate", {
      expression: `(${documentSources.toString()})(${MAX_TEXT},${MAX_SOURCE},${MAX_RESOURCES},${MAX_SOURCE_TOTAL})`,
      returnByValue: true,
    });
    if (result.exceptionDetails || !result.result.value)
      throw new Error("Document source snapshot was unavailable.");
    const snapshot = result.result.value as {
      html: string;
      truncated: boolean;
      partial: boolean;
      inline: {
        kind: string;
        index: number;
        source: string;
        truncated: boolean;
      }[];
    };
    const html = boundedText(snapshot.html, MAX_TEXT);
    parts.push({
      ...definitions[0]!,
      data: html.source,
      truncated: html.truncated || snapshot.truncated,
      detail:
        "Capture-time live document markup (including inline CSS/JS), not the original response. Text evidence only; shadow roots and child-frame documents are not serialized.",
    });
    partial ||= snapshot.partial;
    for (const entry of snapshot.inline) {
      partial ||= entry.truncated;
      add(
        entry.kind === "style" ? css : js,
        {
          kind: "inline",
          index: entry.index,
          status: "available",
          ...(entry.truncated
            ? { detail: "Inline source was clipped to the capture budget." }
            : {}),
        },
        entry.source,
      );
    }
  } catch {
    parts.push({
      ...definitions[0]!,
      status: "unavailable",
      detail:
        "Capture-time document source could not be read within the source capture deadline.",
    });
    partial = true;
  }
  let resourceFailure = false;
  try {
    const { frameTree } = await send("Page.getResourceTree", {});
    const frames = [frameTree];
    let count = 0;
    while (frames.length) {
      const frame = frames.pop()!;
      frames.push(...(frame.childFrames ?? []));
      for (const resource of frame.resources) {
        if (resource.type !== "Stylesheet" && resource.type !== "Script")
          continue;
        if (++count > MAX_RESOURCES || remaining <= 0) {
          partial = true;
          continue;
        }
        const list = resource.type === "Stylesheet" ? css : js;
        const entry: Source = {
          kind: "resource",
          frame: frame.frame.id,
          url: safeEvidenceUrl(resource.url) ?? "[non-HTTP resource]",
          status: "available",
        };
        if (resource.failed || resource.canceled) {
          list.push({
            ...entry,
            status: "unavailable",
            detail: "Resource load failed or was canceled.",
          });
          partial = true;
          continue;
        }
        try {
          const result = await send("Page.getResourceContent", {
            frameId: frame.frame.id,
            url: resource.url,
          });
          const source = result.base64Encoded
            ? Buffer.from(result.content, "base64").toString("utf8")
            : result.content;
          add(list, entry, source);
        } catch {
          list.push({
            ...entry,
            status: "unavailable",
            detail:
              "Already-loaded resource content was unavailable from the browser.",
          });
          partial = true;
        }
      }
    }
  } catch {
    resourceFailure = true;
    partial = true;
  }
  for (const [index, sources] of [
    [1, css],
    [2, js],
  ] as const) {
    parts.push({
      ...definitions[index]!,
      data: JSON.stringify({
        sources,
        partial,
        resourceInventory: resourceFailure ? "unavailable" : "available",
      }),
      truncated: partial,
      detail:
        "Capture-time inline and already-loaded browser resource text; URLs omit credentials, query and fragment. At most 100 inline and 100 external sources, 256 KiB per source, 1 MiB combined source text, and a shared 3-second deadline. Missing/oversized resources are partial; dynamically generated code, adopted stylesheets and unloaded resources may not be represented. Text evidence only.",
    });
  }
  return parts;
}
