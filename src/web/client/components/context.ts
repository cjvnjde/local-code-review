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
import { insertShot } from "./attach.ts";
import { decorateAction } from "./actions.ts";
import { copyText } from "./clipboard.ts";
import { esc, state, SVG } from "../app/state.ts";

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

function contextIdentity(id: string, compact = false): string {
  return (
    '<button type="button" class="context-id" data-context-copy="' +
    esc(id) +
    '" aria-label="Copy context ID ' +
    esc(id) +
    '" data-tooltip="Copy full context ID">' +
    esc(compact ? "ID " + id.slice(0, 12) + "…" : id) +
    "</button>"
  );
}

/** Inline-safe cards work in paragraphs, list items, history, and reference previews alike. */
export function contextCard(ref: ContextRef): string {
  return (
    '<span class="context-ref"><button type="button" class="context-card" data-context-id="' +
    esc(ref.id) +
    '" aria-label="Inspect context: ' +
    esc(ref.label) +
    '">' +
    SVG.ref +
    "<span>" +
    esc(ref.label) +
    "</span><small>Inspect context</small></button>" +
    contextIdentity(ref.id, true) +
    "</span>"
  );
}
export const contextButton = () =>
  '<button type="button" class="context-add" title="Attach a file or text/JSON as on-demand context">' +
  SVG.plus +
  " Add context</button>";
export const contextBusy = (host: ParentNode = document) =>
  !!host.querySelector("[data-context-busy]");
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function dialog(label: string) {
  const box = document.createElement("dialog");
  box.className = "context-dialog";
  box.setAttribute("aria-label", label);
  box.addEventListener("keydown", (event) => event.stopPropagation());
  document.body.append(box);
  return box;
}

/** Upload first, then insert one ordinary relative link into the existing note editor. */
export function wireContext(
  host: HTMLElement,
  ta: HTMLTextAreaElement,
  id: string,
) {
  const add = host.querySelector<HTMLButtonElement>(".context-add");
  if (!add) return;
  add.onclick = () => {
    if (ta.disabled || contextBusy(host)) return;
    const from = ta.selectionStart,
      to = ta.selectionEnd;
    const box = dialog("Add context");
    box.innerHTML =
      "<h3>Add context</h3><p>Saved locally beside this review. Share only content the agent may read; attachments are not automatically deleted.</p>" +
      '<label>File (up to 12 MiB)<input type="file" data-context-file></label>' +
      '<p>Or attach text / JSON:</p><label>Label<input data-context-label maxlength="200" value="Additional details"></label>' +
      '<label>Format<select data-context-type><option value="text/plain">Plain text</option><option value="application/json">JSON</option></select></label>' +
      '<label>Context<textarea data-context-text rows="8" spellcheck="false"></textarea></label>' +
      '<p class="context-status" role="status" aria-live="polite"></p><div class="context-actions"><button type="button" data-context-cancel aria-label="Cancel attaching context">Cancel</button><button type="button" class="primary" data-context-save>Attach text</button></div>';
    const status = box.querySelector<HTMLElement>(".context-status")!;
    decorateAction(
      box.querySelector<HTMLButtonElement>("[data-context-cancel]")!,
    );
    const file = box.querySelector<HTMLInputElement>("[data-context-file]")!;
    const text = box.querySelector<HTMLTextAreaElement>("[data-context-text]")!;
    const save = box.querySelector<HTMLButtonElement>("[data-context-save]")!;
    let busy = false;
    ta.dataset.contextBusy = "";
    const abort = new AbortController();
    const observer = new MutationObserver(() => {
      if (!ta.isConnected) {
        abort.abort();
        box.close();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    box.onclose = () => {
      observer.disconnect();
      abort.abort();
      delete ta.dataset.contextBusy;
      box.remove();
      if (ta.isConnected) ta.focus();
    };
    box.oncancel = (event) => {
      if (busy) event.preventDefault();
    };
    box.querySelector<HTMLButtonElement>("[data-context-cancel]")!.onclick =
      () => box.close();
    file.onchange = () => {
      save.textContent = file.files?.length ? "Attach file" : "Attach text";
    };
    save.onclick = async () => {
      if (busy || !ta.isConnected) return;
      busy = true;
      state.noteSending.set(id, (state.noteSending.get(id) || 0) + 1);
      const controls = [
        ...host.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>(
          "button,textarea",
        ),
        ...box.querySelectorAll<
          | HTMLInputElement
          | HTMLButtonElement
          | HTMLTextAreaElement
          | HTMLSelectElement
        >("input,button,textarea,select"),
      ];
      const disabled = controls.map((control) => control.disabled);
      controls.forEach((control) => {
        control.disabled = true;
      });
      status.textContent = "Saving context… Keep this editor open.";
      try {
        const ref = await uploadContext(
          file.files?.[0] ?? {
            label:
              box
                .querySelector<HTMLInputElement>("[data-context-label]")!
                .value.trim() || "Additional details",
            text: text.value,
            type: box.querySelector<HTMLSelectElement>("[data-context-type]")!
              .value as "text/plain" | "application/json",
          },
          abort.signal,
        );
        if (!ta.isConnected) return;
        const written = insertShot(ta.value, from, to, contextLink(ref));
        ta.value = written.value;
        ta.setSelectionRange(written.caret, written.caret);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        box.close();
      } catch (error) {
        if (!abort.signal.aborted)
          status.textContent = "Could not add context: " + errorText(error);
      } finally {
        busy = false;
        const count = (state.noteSending.get(id) || 1) - 1;
        if (count) state.noteSending.set(id, count);
        else state.noteSending.delete(id);
        controls.forEach((control, index) => {
          control.disabled = disabled[index]!;
        });
        if (!box.open && ta.isConnected) ta.focus();
      }
    };
    box.showModal();
  };
}

/** One selected part at a time: opening a manifest never fetches any of its payloads. */
export async function inspectContext(id: string) {
  const box = dialog("Inspect context");
  box.innerHTML =
    '<div class="context-actions"><h3>Context</h3><button type="button" data-context-close aria-label="Close context inspector">Close</button></div>' +
    '<div class="context-identity"><span>Context ID</span>' +
    contextIdentity(id) +
    '</div><p class="context-source">Without lcr, read <code>' +
    esc(contextPath(id)) +
    '</code> in the review output directory.</p><p class="context-status" role="status" aria-live="polite">Loading manifest…</p><div class="context-manifest"></div><section class="context-preview" aria-label="Selected context part"></section>';
  const status = box.querySelector<HTMLElement>(".context-status")!;
  decorateAction(box.querySelector<HTMLButtonElement>("[data-context-close]")!);
  const manifestHost = box.querySelector<HTMLElement>(".context-manifest")!;
  const preview = box.querySelector<HTMLElement>(".context-preview")!;
  const lifetime = new AbortController();
  let request: AbortController | undefined;
  let objectUrl = "";
  const release = () => {
    request?.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  };
  box.onclose = () => {
    lifetime.abort();
    release();
    box.remove();
  };
  box.querySelector<HTMLButtonElement>("[data-context-close]")!.onclick = () =>
    box.close();
  box.showModal();
  try {
    const manifest = await fetchContextManifest(id, lifetime.signal);
    if (lifetime.signal.aborted) return;
    box.querySelector("h3")!.textContent = manifest.label;
    status.textContent =
      "Saved " +
      manifest.at +
      ". Choose a part to retrieve; nothing else is loaded.";
    const source = document.createElement("p");
    source.className = "context-source";
    source.textContent = [
      manifest.source?.title,
      manifest.source?.url,
      manifest.source?.captureAt ? "Captured " + manifest.source.captureAt : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (source.textContent) manifestHost.append(source);
    const list = document.createElement("ul");
    manifestHost.append(list);
    for (const part of manifest.parts) {
      const item = document.createElement("li");
      const choose = document.createElement("button");
      choose.type = "button";
      choose.textContent = part.label;
      choose.disabled = part.status !== "available";
      const detail = document.createElement("span");
      detail.textContent = [
        part.status,
        part.type,
        part.bytes.toLocaleString() + " bytes",
        part.truncated ? "Truncated at capture" : "",
        part.detail || "",
      ]
        .filter(Boolean)
        .join(" · ");
      item.append(choose, detail);
      list.append(item);
      choose.onclick = () => {
        void select(part);
      };
    }
  } catch (error) {
    if (!lifetime.signal.aborted)
      status.textContent = "Could not load context: " + errorText(error);
  }
  async function select(part: ContextPart) {
    release();
    const current = (request = new AbortController());
    preview.replaceChildren();
    const title = document.createElement("h4");
    title.textContent = part.label;
    const progress = document.createElement("p");
    progress.setAttribute("role", "status");
    progress.textContent = "Loading selected part…";
    preview.append(title, progress);
    if (contextIsText(part.type)) {
      const content = document.createElement("pre");
      const more = document.createElement("button");
      more.type = "button";
      more.textContent = "Load more";
      more.hidden = true;
      preview.append(content, more);
      let offset = 0;
      let shown = "";
      const load = async () => {
        more.disabled = true;
        try {
          const chunk = await fetchContextText(
            id,
            part.name,
            offset,
            current.signal,
          );
          if (current.signal.aborted) return;
          // Keep the DOM preview bounded even when a large text part is read a page at a time.
          shown = (shown + chunk.content).slice(-CONTEXT_TEXT_MAX);
          content.textContent = shown;
          progress.textContent =
            "Read through byte " +
            (chunk.nextOffset ?? chunk.totalBytes) +
            " of " +
            chunk.totalBytes +
            ". Preview keeps the latest " +
            CONTEXT_TEXT_MAX / 1024 +
            "K characters.";
          more.hidden = chunk.nextOffset == null;
          if (chunk.nextOffset != null) offset = chunk.nextOffset;
        } catch (error) {
          if (!current.signal.aborted) {
            progress.textContent = errorText(error);
            more.hidden = false;
            more.textContent = "Retry";
          }
        } finally {
          more.disabled = false;
        }
      };
      more.onclick = () => {
        more.textContent = "Load more";
        void load();
      };
      await load();
      return;
    }
    try {
      const response = await contextFetch(
        "/" + id + "/parts/" + encodeURIComponent(part.name),
        { signal: current.signal },
      );
      const blob = await response.blob();
      if (current.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      if (blob.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = objectUrl;
        image.alt = part.label;
        preview.append(image);
      }
      const download = document.createElement("button");
      download.type = "button";
      download.dataset.contextDownload = "";
      download.setAttribute("aria-label", "Download " + part.label);
      decorateAction(download);
      download.onclick = () => {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = part.attachment?.split("/").pop() || part.name;
        link.click();
      };
      preview.append(download);
      progress.textContent =
        part.bytes.toLocaleString() + " bytes · " + part.type;
    } catch (error) {
      if (!current.signal.aborted)
        progress.textContent =
          errorText(error) + " Select the part again to retry.";
    }
  }
}

export function watchContext() {
  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            "[data-context-copy],[data-context-id]",
          )
        : null;
    const id = contextId(
      target?.dataset.contextCopy || target?.dataset.contextId,
    );
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    if (target?.hasAttribute("data-context-copy")) void copyText(target, id);
    else void inspectContext(id);
  });
}
