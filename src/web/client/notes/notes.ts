import { webCaptureHtml } from "../web-review/web-capture.ts";
import {
  webReview,
  webSelectionKey,
  type WebReview,
  type WebAnnotationTarget,
} from "../../../shared/web-review.ts";
import { openAnnotation } from "../web-review/annotation-editor.ts";
import { placeOf } from "../diff/anchor.ts";
import { imageRegion, regionLabel } from "../../../shared/image-region.ts";
import { imageCaptureHtml } from "../diff/image-capture.ts";
import { paintImageNotes } from "../diff/image-comments.ts";
import {
  managedNoteTask,
  noteSaveLabel,
  queueTaskStatusHtml,
} from "../app/agent.ts";
import { openHistory } from "../history/history-ui.ts";
import { renderBody } from "../components/body.ts";
import {
  activeEditor,
  composerHint,
  composerTools,
  wireComposer,
} from "../components/composer.ts";
import { copyText } from "../components/clipboard.ts";
import { refToken } from "./note-ref.ts";
import { globalHost, repaintRow, syncGlobals } from "../diff/diff-view.ts";
import { reaims } from "../diff/drag.ts";
import { updateCount } from "./footer.ts";
import { codeHtml, langOf } from "../components/highlight.ts";
import { save, submitNote, withdrawNotes } from "../app/persistence.ts";
import { clearSel } from "../diff/selection.ts";
import {
  FILE_ANCHOR,
  GLOBAL_ANCHOR,
  SVG,
  clip,
  el,
  esc,
  isFileNote,
  isGlobalNote,
  keyIndex,
  locKey,
  markRead,
  mintGlobalId,
  mintNoteId,
  rowKey,
  state,
  statusOf,
  msgsOf,
  unreadOf,
  noteVisible,
  canResolve,
  isResolved,
} from "../app/state.ts";
import {
  capturedLines,
  insertBlock,
  suggestLines,
  suggestionBlock,
} from "./suggest.ts";
import {
  dropCleanEdit,
  mountReply,
  appendReplyText,
  setReplyEvidence,
  renderThread,
} from "./thread.ts";
import { renderTree } from "../navigation/tree.ts";

/* ---------- notes ---------- */
export function span(f, i, j, ch?) {
  const rows = f.rows.slice(i, j + 1).filter((r) => r.t !== "hunk");
  const ns = rows.filter((r) => r.n != null).map((r) => r.n);
  const os = rows.filter((r) => r.n == null && r.o != null).map((r) => r.o);
  const nums = ns.length ? ns : os;
  if (!nums.length)
    return { side: "new", start: 0, end: 0, label: "0", code: "" };
  const start = Math.min.apply(null, nums),
    end = Math.max.apply(null, nums);
  const code = rows
    .map((r) => (r.t === "add" ? "+" : r.t === "del" ? "-" : " ") + r.text)
    .join("\n");
  const out: any = {
    side: ns.length ? "new" : "old",
    start,
    end,
    label: start === end ? String(start) : start + "-" + end,
    code,
  };
  // Columns are 1-based and inclusive in the label; ch.cb is an exclusive offset.
  if (ch) {
    out.label += ":" + (ch.ca + 1) + "-" + ch.cb;
    out.snippet = f.rows[i].text.slice(ch.ca, ch.cb);
  }
  return out;
}
function bounds() {
  const s = state.sel;
  if (!s) return null;
  const f = state.files[s.fi];
  let i = Math.min(s.a, s.b),
    j = Math.max(s.a, s.b);
  while (i <= j && f.rows[i].t === "hunk") i++;
  while (j >= i && f.rows[j].t === "hunk") j--;
  if (i > j) return null;
  // A character range only survives while the selection is still the single row it was taken from.
  const ch =
    s.ca != null && i === j && i === s.a ? { ca: s.ca, cb: s.cb } : null;
  return { f, fi: s.fi, i, j, ch };
}
/**
 * The stored offsets, re-read against the text they point into. A row that still holds the note's
 * code can have shifted under it — a re-indent keeps it `exact` — so the snippet is what says where
 * the range now sits; offsets whose snippet has left the line entirely point at nothing.
 */
function charSpan(n: any, text: string) {
  if (n.ca == null) return null;
  if (!n.snippet || text.slice(n.ca, n.cb) === n.snippet)
    return { ca: n.ca, cb: n.cb };
  const at = text.indexOf(n.snippet);
  return at < 0 ? null : { ca: at, cb: at + n.snippet.length };
}
/** Character ranges to paint inside one row: every saved sub-line note, plus the live selection. */
export function charMarks(f: any, fi: number, idx: number) {
  const out: any[] = [];
  state.notes.forEach((n) => {
    if (!noteVisible(n)) return;
    if (n.ca == null || n.file !== f.path) return;
    // Where the note is showing, which after an edit need not be the row it was written on.
    const p = placeOf(n);
    if (!p || p.i !== idx) return;
    const span = charSpan(n, f.rows[idx].text);
    if (span) out.push({ s: span.ca, e: span.cb, c: "cn" });
  });
  const s = state.sel;
  if (s && s.ca != null && s.fi === fi && s.a === idx)
    out.push({ s: s.ca, e: s.cb, c: "cs" });
  return out.length ? out : null;
}
/** An untouched draft is disposable: a new click or shift-extend should move it, not stack a second box. */
function dropEmptyDraft() {
  const row = state.draftRow;
  state.draftRow = state.draftKey = state.draftAt = null;
  if (!row || !row.isConnected) return;
  if (state.notes.has(row.dataset.nid)) return;
  const ta = row.querySelector("textarea");
  if (!ta || ta.value.trim()) return;
  const host = row.parentElement;
  row.remove();
  if (row.__imageCleanup) row.__imageCleanup();
  if (host && host.id === "globalDraft") host.hidden = true;
  syncGlobals(); // it may have been the only thing in the card at the top
}
/** The text box of the draft standing open on this exact range, if the last one opened is still there. */
function draftFor(key: string) {
  const row = state.draftRow;
  if (!row || !row.isConnected || state.draftKey !== key) return null;
  return row.querySelector("textarea");
}
/**
 * The page holds one editor open at a time, replies included. A second box would leave the first one
 * behind, half written and out of view, so an untouched draft steps aside and anything else keeps the
 * floor and is brought back into view instead.
 */
export function busyEditor() {
  const drawing = document.querySelector<HTMLDialogElement>(
    "[data-annotation-editor]",
  );
  if (drawing) {
    drawing.focus();
    return true;
  }
  dropEmptyDraft();
  dropCleanEdit();
  const ta: any = activeEditor();
  if (!ta || !ta.isConnected) return false;
  const box = ta.closest(".nbox");
  if (box) {
    box.scrollIntoView({ block: "nearest" });
    box.classList.remove("bump");
    void box.offsetWidth; // restart the pulse when the same box is asked for twice
    box.classList.add("bump");
  }
  ta.focus();
  return true;
}
/**
 * What the draft standing open is carrying, when a selection has landed on lines it covers and is
 * therefore that same note being aimed again rather than a second one; null when there is nothing to
 * carry over. A saved note reopened for editing has a box of exactly the same shape, so the note
 * store is what tells the two apart: a draft is the one nothing has been written down about yet.
 */
function carriedDraft(fi: number, i: number, j: number) {
  if (!reaims(state.draftAt, fi, i, j)) return null;
  const row = state.draftRow;
  if (!row || !row.isConnected || state.notes.has(row.dataset.nid)) return null;
  const ta: any = row.querySelector(".nedit textarea");
  return ta
    ? { body: ta.value, from: ta.selectionStart, to: ta.selectionEnd }
    : null;
}
/** Opens a new note on the selected range. A range that already carries notes gets another one:
 *  a line can hold as many remarks as it earns, and each is edited from its own box. */
export function openEditor() {
  const b = bounds();
  if (!b) return;
  const { f, fi, i, j, ch } = b;
  const anchor = el("r" + fi + "-" + j);
  if (!anchor) return;
  const a = rowKey(f.rows[i]),
    z = rowKey(f.rows[j]);
  const key = locKey(f.path, a, z, ch && ch.ca, ch && ch.cb);
  const open = draftFor(key);
  if (open) {
    open.focus();
    return;
  }
  // Narrowing a line to a fragment, and re-picking that fragment, are the same gesture that opened
  // the draft, so a half-written note follows the selection rather than keeping the floor and going
  // on describing a range the reader has already left. The box is drawn from its range, so it is
  // built again around what was written into it.
  const carried = carriedDraft(fi, i, j);
  if (carried) {
    dropEmptyReply();
    state.draftRow.remove();
  } else if (busyEditor()) {
    clearSel();
    return;
  }
  const id = mintNoteId(f.path, a, z, ch && ch.ca, ch && ch.cb);
  const box = mountRow(anchor, id);
  state.draftRow = rowOf(box);
  state.draftKey = key;
  state.draftAt = { fi, i, j };
  editUI(box, { f, fi, i, j, ch, id, body: carried ? carried.body : "" });
  if (carried)
    box.querySelector("textarea").setSelectionRange(carried.from, carried.to);
}
/** A note on the file itself: no line anchor, as many per file as the review earns, mounted under
 *  the file header. A second click opens another draft rather than editing an earlier note. */
export function openFileEditor(fi: number) {
  const f = state.files[fi];
  if (!f) return;
  const host = el("fn" + fi);
  if (!host) return;
  const key = locKey(f.path, FILE_ANCHOR, FILE_ANCHOR);
  const open = draftFor(key);
  if (open) {
    open.focus();
    return;
  }
  if (busyEditor()) return;
  const id = mintNoteId(f.path, FILE_ANCHOR, FILE_ANCHOR);
  const box = mountFileBox(host, id);
  // No `draftAt`: a note on the whole file covers no lines, so no selection can re-aim it.
  state.draftRow = rowOf(box);
  state.draftKey = key;
  state.draftAt = null;
  editUI(box, { f, fi, i: null, j: null, ch: null, scope: "file", id });
}
/** A screenshot note uses the ordinary file conversation, with its editor beside the selected area. */
export function openImageEditor(
  fi: number,
  image: any,
  stage: any,
  rect: any,
  capture: () => Promise<string>,
) {
  const f = state.files[fi];
  if (!f || busyEditor()) {
    rect.remove();
    return;
  }
  clearSel();
  const host = document.createElement("div");
  host.className = "imgdraft";
  // Place the box near the bottom of the selected area, bounded to the visible part of a tall image.
  const bounds = stage.getBoundingClientRect(),
    pane = el("diff").getBoundingClientRect();
  const imageBox = stage.closest(".imgb"),
    parent = imageBox.getBoundingClientRect();
  const bottom = ((image.y + image.height) / image.imageHeight) * bounds.height;
  host.style.top =
    Math.max(
      0,
      Math.min(
        bounds.top - parent.top + bottom,
        pane.bottom - parent.top - 120,
      ),
    ) + "px";
  imageBox.append(host);
  imageBox.classList.add("editing-image");
  const baseHeight = imageBox.clientHeight;
  const size = new ResizeObserver(() => {
    imageBox.style.minHeight =
      Math.max(
        baseHeight,
        host.offsetTop +
          host.offsetHeight +
          parseFloat(getComputedStyle(imageBox).paddingBottom),
      ) + "px";
  });
  size.observe(host);
  const id = mintNoteId(f.path, FILE_ANCHOR, FILE_ANCHOR),
    box = mountFileBox(host, id);
  state.draftRow = rowOf(box);
  state.draftKey = id;
  state.draftAt = null;
  const cleanup = () => {
    size.disconnect();
    host.remove();
    rect.remove();
    imageBox.classList.remove("editing-image");
    imageBox.style.removeProperty("min-height");
  };
  // Empty drafts can be displaced by another editor; their detached wrappers and marks go with them.
  (rowOf(box) as any).__imageCleanup = cleanup;
  editUI(box, {
    f,
    fi,
    i: null,
    j: null,
    ch: null,
    scope: "file",
    id,
    image: { ...image, capture: "" },
    capture,
    cleanup,
    stage,
  });
  box.scrollIntoView({ block: "nearest" });
}
/**
 * A note about the review as a whole. Its editor hangs from the permanent page header, so starting
 * one never moves the diff. Saving puts the note in its ordinary card above the first file.
 */
export function openGlobalEditor() {
  if (busyEditor()) return;
  const host = el("globalDraft");
  if (!host) return;
  host.hidden = false;
  const id = mintGlobalId();
  const box = mountFileBox(host, id);
  state.draftRow = rowOf(box);
  state.draftKey = locKey("", GLOBAL_ANCHOR, GLOBAL_ANCHOR);
  state.draftAt = null;
  editUI(box, {
    f: { path: "", rows: [] },
    fi: -1,
    i: null,
    j: null,
    ch: null,
    scope: "global",
    id,
    body: "",
  });
}
/** The live page hosts this same editor; only its captured subject differs from an overall note. */
export function openWebEditor(
  host: HTMLElement,
  web: WebReview | null,
  onCancel: () => void,
) {
  if (busyEditor()) return "";
  const id = mintGlobalId(),
    box = mountFileBox(host, id);
  state.draftRow = rowOf(box);
  state.draftKey = id;
  state.draftAt = null;
  editUI(box, {
    f: { path: "", rows: [] },
    fi: -1,
    i: null,
    j: null,
    ch: null,
    scope: "global",
    id,
    body: "",
    web,
    onCancel,
  });
  return id;
}
/** Several ranges can end on the same row, so each note row is tagged and matched by id. */
function rowFor(anchor, id) {
  let n = anchor.nextElementSibling;
  while (n && n.classList.contains("nrow")) {
    if (n.dataset.nid === id) return n;
    n = n.nextElementSibling;
  }
  return null;
}
function mountRow(anchor, id) {
  let after = anchor;
  while (
    after.nextElementSibling &&
    after.nextElementSibling.classList.contains("nrow")
  )
    after = after.nextElementSibling;
  const row = document.createElement("tr");
  row.className = "nrow";
  row.dataset.nid = id;
  const td = document.createElement("td");
  td.colSpan = 4;
  const box = document.createElement("div");
  box.className = "nbox";
  td.append(box);
  row.append(td);
  after.after(row);
  return box;
}
/** File notes live outside the table, so they carry the same `.nrow` wrapper without a cell. */
function mountFileBox(host, id) {
  const row = document.createElement("div");
  row.className = "nrow";
  row.dataset.nid = id;
  const box = document.createElement("div");
  box.className = "nbox";
  row.append(box);
  host.append(row);
  return box;
}
/** The wrapper a box lives in, whether that is a table row or a file-header block. */
const rowOf = (box: any) => box.closest(".nrow");
// Context and capture state outlive evidence refreshes and view/edit repaints of the same box.
const noteContexts = new WeakMap<HTMLElement, any>();
const webCapturing = new WeakSet<HTMLElement>();
const webRemoving = new Set<string>();
const webAnnotating = new Set<string>();
const webRemovalErrors = new Map<string, string>();
const webRemovalWired = new WeakSet<HTMLElement>();
/** Busy state follows the box and note id through view/edit repaints. */
function refreshWebControls(box: HTMLElement) {
  const id = rowOf(box)?.dataset.nid;
  const busy =
    webCapturing.has(box) ||
    webRemoving.has(id) ||
    webAnnotating.has(id) ||
    state.noteSending.has(id) ||
    !!box.querySelector(".reply[data-sending]");
  box.toggleAttribute("data-web-busy", busy);
  box
    .querySelectorAll<HTMLButtonElement>(
      "[data-save-note],[data-reply-save],[data-ask-note],[data-web-remove],[data-web-annotate]",
    )
    .forEach((button) => {
      button.disabled = busy;
    });
  let error = box.querySelector<HTMLElement>("[data-web-error]");
  if (state.notes.get(id)?.sentAt && !box.querySelector(".nedit"))
    box
      .querySelectorAll("[data-web-evidence] [data-web-remove]")
      .forEach((button) => button.remove());
  const message = webRemovalErrors.get(id);
  if (message && !error) {
    error = document.createElement("p");
    error.dataset.webError = "";
    error.className = "ui-note-error";
    error.setAttribute("role", "alert");
    box.querySelector("[data-web-evidence]")?.after(error);
  }
  if (error) {
    if (error.textContent !== (message || ""))
      error.textContent = message || "";
    error.hidden = !message;
  }
}
/** Keep capture-in-flight state on the box, not on a save button that a repaint replaces. */
export function setWebNoteCapturing(host: HTMLElement, busy: boolean) {
  host.querySelectorAll<HTMLElement>(".nbox").forEach((box) => {
    if (busy) webCapturing.add(box);
    else webCapturing.delete(box);
    refreshWebControls(box);
  });
}
/** A failed parent mutation leaves evidence intact and reports the reason beside it. */
export function setWebNoteError(host: HTMLElement, id: string, error?: string) {
  if (error) webRemovalErrors.set(id, error);
  else webRemovalErrors.delete(id);
  host.querySelectorAll<HTMLElement>(".nbox").forEach(refreshWebControls);
}
/** Replace only evidence and commit context; textarea and reply DOM stay untouched. */
export function updateWebNoteEvidence(
  host: ParentNode,
  id: string,
  web: WebReview | null,
  options?: { reply?: boolean; draftId?: string },
) {
  if (options?.reply) {
    host.querySelectorAll<HTMLElement>(".nrow").forEach((row) => {
      if (row.dataset.nid === id) {
        const box = row.querySelector<HTMLElement>(".nbox");
        if (box) setReplyEvidence(box, web, options.draftId);
      }
    });
    return;
  }
  const note = state.notes.get(id);
  if (note) note.web = web;
  host.querySelectorAll<HTMLElement>(".nrow").forEach((row) => {
    if (row.dataset.nid !== id) return;
    const box = row.querySelector<HTMLElement>(".nbox");
    if (!box) return;
    const ctx = noteContexts.get(box);
    if (ctx) ctx.web = web;
    const preview = box.querySelector<HTMLElement>("[data-web-evidence]");
    if (preview) preview.innerHTML = webCaptureHtml(web, true);
    const heading = document.createElement("div");
    heading.innerHTML = headHtml(
      ctx?.f || { path: "" },
      null,
      null,
      "",
      ctx?.scope,
      ctx?.image,
      web,
    );
    for (const selector of [".loc", ".all"]) {
      const current = box.querySelector(".nhead " + selector),
        next = heading.querySelector(selector);
      if (current && next) current.replaceWith(next);
    }
    if (!web)
      box
        .querySelectorAll("[data-web-focus],[data-web-after]")
        .forEach((button) => button.remove());
    else if (
      note &&
      state.web &&
      !box.querySelector(".nedit") &&
      !box.querySelector("[data-web-focus]")
    ) {
      const history = box.querySelector(".history");
      for (const [action, label] of [
        ["webFocus", "On page"],
        ["webAfter", "Capture after"],
      ]) {
        const button = document.createElement("button");
        button.dataset[action] = id;
        button.textContent = label;
        history?.before(button);
      }
    }
    const ta = box.querySelector<HTMLTextAreaElement>(".nedit textarea");
    if (ta && ctx?.scope === "global")
      ta.placeholder = web
        ? "What should change here?"
        : "What should be said about this review as a whole?";
    refreshWebControls(box);
  });
}
/** Edit evidence without replacing the note's textarea, thread, or original screenshot. */
async function annotateWebCapture(box: HTMLElement, button: HTMLButtonElement) {
  const id = rowOf(box)?.dataset.nid;
  if (
    !id ||
    button.disabled ||
    webCapturing.has(box) ||
    webRemoving.has(id) ||
    webAnnotating.has(id) ||
    state.noteSending.has(id)
  )
    return;
  const ctx = noteContexts.get(box),
    reply: any = button.closest(".reply"),
    web = webReview(reply?.__web ?? ctx?.web ?? state.notes.get(id)?.web);
  if (!web) return;
  const index = Number(button.dataset.webAnnotate),
    kind = button.dataset.webKind;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    (kind !== "selection" && kind !== "after")
  )
    return;
  const capture =
    kind === "after"
      ? web.after[index]
      : index === 0
        ? web.before
        : web.additional?.[index - 1];
  if (!capture || button.dataset.webKey !== webSelectionKey(capture)) return;
  const target: WebAnnotationTarget = {
    kind,
    index,
    key: webSelectionKey(capture),
    expected: capture.annotation?.image || "",
  };
  const ta = box.querySelector<HTMLTextAreaElement>("textarea");
  const selection = ta
    ? {
        start: ta.selectionStart,
        end: ta.selectionEnd,
        direction: ta.selectionDirection,
      }
    : null;
  webAnnotating.add(id);
  webRemovalErrors.delete(id);
  document.querySelectorAll<HTMLElement>(".nbox").forEach(refreshWebControls);
  try {
    await openAnnotation(capture, async (annotation) => {
      const note = state.notes.get(id);
      if (note?.sentAt && !reply && !box.querySelector(".nedit")) {
        if (annotation)
          appendReplyText(
            box,
            "Annotated proposal for the original selected area:\n\n![Original selected area](" +
              capture.area +
              ")\n\n![Annotated proposal](" +
              annotation.image +
              ")",
          );
        return;
      }
      const draftId =
        reply?.dataset.draftId ||
        (state.uiEmbed
          ? new URLSearchParams(location.search).get("ui-draft")
          : null);
      const response = await fetch("/api/web/annotation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(draftId ? { draftId } : { id }),
          target,
          annotation,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save this drawing.");
      const next = webReview(result.web);
      if (!next)
        throw new Error("The server returned invalid drawing evidence.");
      updateWebNoteEvidence(
        document,
        id,
        next,
        reply ? { reply: true, draftId } : undefined,
      );
      save();
    });
  } catch (error) {
    webRemovalErrors.set(
      id,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    webAnnotating.delete(id);
    document.querySelectorAll<HTMLElement>(".nbox").forEach(refreshWebControls);
    if (ta?.isConnected && selection) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  }
}
function wireWebRemoval(box: HTMLElement) {
  refreshWebControls(box);
  if (webRemovalWired.has(box)) return;
  webRemovalWired.add(box);
  box.addEventListener("click", async (event) => {
    const annotate =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-web-annotate]")
        : null;
    if (annotate && box.contains(annotate)) {
      void annotateWebCapture(box, annotate);
      return;
    }
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-web-remove]")
        : null;
    if (!button || !box.contains(button)) return;
    const id = rowOf(box)?.dataset.nid;
    if (
      !id ||
      button.disabled ||
      webCapturing.has(box) ||
      webRemoving.has(id) ||
      webAnnotating.has(id) ||
      state.noteSending.has(id)
    )
      return;
    const index = Number(button.dataset.webRemove),
      key = button.dataset.webKey;
    if (key === undefined) return;
    const reply = button.closest<HTMLElement>(".reply");
    const draftId = reply?.dataset.draftId;
    webRemovalErrors.delete(id);
    if (state.uiEmbed) {
      setWebNoteCapturing(box.parentElement!, true);
      box.dispatchEvent(
        new CustomEvent("lcr:web-remove", {
          bubbles: true,
          detail: { index, key, ...(draftId ? { draftId } : {}) },
        }),
      );
      return;
    }
    webRemoving.add(id);
    document.querySelectorAll<HTMLElement>(".nbox").forEach(refreshWebControls);
    try {
      const response = await fetch("/api/web/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(draftId ? { draftId } : { id }),
          index,
          key,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not remove this selection.");
      const web = result.web === null ? null : webReview(result.web);
      if (result.web !== null && !web)
        throw new Error("The server returned invalid selection evidence.");
      updateWebNoteEvidence(
        document,
        id,
        web,
        reply ? { reply: true, draftId } : undefined,
      );
      save();
    } catch (error) {
      webRemovalErrors.set(
        id,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      webRemoving.delete(id);
      document
        .querySelectorAll<HTMLElement>(".nbox")
        .forEach(refreshWebControls);
    }
  });
}
/** Removes an unsaved editor and closes the header popover used only by overall-note drafts. */
function removeDraftBox(box: any) {
  const row = rowOf(box);
  const host = row && row.parentElement;
  if (state.draftRow === row)
    state.draftRow = state.draftKey = state.draftAt = null;
  if (row) row.remove();
  if (row?.__imageCleanup) row.__imageCleanup();
  if (host && host.id === "globalDraft") host.hidden = true;
}
/** What the agent reported for this note, sourced from the review file it wrote it in. */
function statusChip(st) {
  if (!st) return "";
  return (
    '<span class="stat ' +
    esc(st.status) +
    '" title="' +
    esc(st.source + (st.detail ? " — " + st.detail : "")) +
    '">' +
    esc(st.status.replace("-", " ")) +
    "</span>"
  );
}
/**
 * What a note says it is about. A note on the whole review names no file, one on a whole file names
 * no lines, and the badge under `all` is what carries that instead of a line range.
 */
function headHtml(f, label, snippet, extra, scope?, image?, web?) {
  const global = scope === "global";
  return (
    '<div class="nhead"><span class="loc">' +
    (web
      ? esc(web.before.element?.tag || web.before.mode) + " · UI"
      : global
        ? "Overall"
        : esc(f.path) + (label ? ":" + label : "")) +
    "</span>" +
    (image
      ? '<span class="all">' + esc(regionLabel(image)) + "</span>"
      : web
        ? '<span class="all">' +
          esc(
            web.before.components.map((c) => c.name).join(" → ") ||
              web.before.mode,
          ) +
          "</span>"
        : global
          ? '<span class="all">whole review</span>'
          : label
            ? ""
            : '<span class="all">whole file</span>') +
    (snippet
      ? '<span class="snip" title="' +
        esc(snippet) +
        '">' +
        esc(clip(snippet.trim())) +
        "</span>"
      : "") +
    '<span class="spacer"></span>' +
    (extra || "") +
    "</div>"
  );
}
function editUI(box, ctx) {
  const { f, fi, i, j, ch, id } = ctx;
  noteContexts.set(box, ctx);
  const global = ctx.scope === "global";
  const whole = global || ctx.scope === "file";
  const sp = whole ? null : span(f, i, j, ch);
  // A note covering no lines has nothing to suggest a replacement for.
  const suggest = whole
    ? ""
    : '<button class="sug" title="Insert these lines as a suggested change">' +
      SVG.plus +
      " suggest</button>";
  box.innerHTML =
    headHtml(
      f,
      whole ? null : sp.label,
      whole ? null : sp.snippet,
      suggest + composerTools(id),
      ctx.scope,
      ctx.image,
      ctx.web,
    ) +
    (ctx.image
      ? '<div class="image-preview">' + imageCaptureHtml(ctx.image) + "</div>"
      : "") +
    "<div data-web-evidence>" +
    webCaptureHtml(ctx.web, true) +
    "</div>" +
    '<div class="nedit"><textarea placeholder="' +
    (ctx.web
      ? "What should change here?"
      : global
        ? "What should be said about this review as a whole?"
        : ctx.image
          ? "What should change in this area?"
          : whole
            ? "What should change in this file?"
            : ch
              ? "What should change in this part of the line?"
              : "What should change here?") +
    '"></textarea>' +
    '<div class="acts"><button data-save-note' +
    (webCapturing.has(box) ? " disabled" : "") +
    ">" +
    esc(noteSaveLabel()) +
    '</button><button class="primary" data-ask-note' +
    (state.agent ? "" : " hidden") +
    ">Save &amp; ask AI</button>" +
    (state.uiEmbed && !state.notes.has(id)
      ? ""
      : '<button class="cancel">Cancel</button>') +
    (state.notes.has(id) ? '<button class="danger del">Delete</button>' : "") +
    composerHint("save") +
    "</div></div>";
  wireWebRemoval(box);
  const ta = box.querySelector("textarea");
  ta.value = ctx.body || "";
  const fit = wireComposer(box, ta, id, {
    save: () => commit(),
    cancel: () => cancel(),
  });
  if (ctx.capture && !ctx.image.capture) {
    const start = () => {
      const button = box.querySelector("[data-save-note]"),
        preview = box.querySelector(".image-preview");
      button.disabled = true;
      preview.textContent = "Capturing selected area…";
      void ctx
        .capture()
        .then((ref) => {
          if (!box.isConnected) return;
          ctx.image = { ...ctx.image, capture: ref };
          preview.innerHTML = imageCaptureHtml(ctx.image);
          button.disabled = false;
        })
        .catch((error) => {
          if (!box.isConnected) return;
          preview.textContent =
            "Could not capture this area: " +
            String(error.message || error) +
            " ";
          const retry = document.createElement("button");
          retry.textContent = "Retry capture";
          retry.onclick = start;
          preview.append(retry);
        });
    };
    start();
  }
  const sug = box.querySelector(".sug");
  // The suggestion is seeded with whole lines even for a note on part of one: it replaces lines.
  if (sug)
    sug.onclick = () => {
      const { value, to } = insertBlock(
        ta.value,
        ta.selectionStart,
        suggestionBlock(suggestLines(f.rows.slice(i, j + 1))),
      );
      ta.value = value;
      fit();
      ta.focus();
      ta.setSelectionRange(to, to);
    };
  const commit = (ask = false) => {
    if (
      webCapturing.has(box) ||
      webRemoving.has(id) ||
      webAnnotating.has(id) ||
      state.noteSending.has(id)
    )
      return;
    const body = ta.value.trim();
    if (ctx.image && !imageRegion(ctx.image)) return;
    if (!body) {
      drop();
      return;
    }
    const kept = state.notes.get(id);
    const note: any = global
      ? {
          id,
          file: "",
          body,
          a: GLOBAL_ANCHOR,
          b: GLOBAL_ANCHOR,
          scope: "global",
          start: 0,
          end: 0,
        }
      : whole
        ? {
            id,
            file: f.path,
            body,
            a: FILE_ANCHOR,
            b: FILE_ANCHOR,
            scope: "file",
            start: 0,
            end: 0,
          }
        : {
            id,
            file: f.path,
            body,
            a: rowKey(f.rows[i]),
            b: rowKey(f.rows[j]),
            side: sp.side,
            start: sp.start,
            end: sp.end,
            label: sp.label,
            code: sp.code,
          };
    if (ch) {
      note.ca = ch.ca;
      note.cb = ch.cb;
      note.snippet = sp.snippet;
    }
    if (ctx.image) note.image = { ...ctx.image };
    if (ctx.web) note.web = ctx.web;
    // Editing a note that is already in the review file leaves it in the same conversation.
    if (kept && kept.sentAt) note.sentAt = kept.sentAt;
    state.notes.set(id, note);
    // The row now holds a saved conversation, including an empty reply input, not a draft.
    if (state.draftRow === rowOf(box))
      state.draftRow = state.draftKey = state.draftAt = null;
    state.place.set(
      id,
      global
        ? { fi: -1, i: -1, j: -1, how: "global" }
        : whole
          ? { fi, i: -1, j: -1, how: "file" }
          : { fi, i, j, how: "exact" },
    );
    save();
    clearSel();
    if (global && box.closest("#globalDraft")) {
      // The saved note belongs at the top of the diff. Absorb the height inserted above the current
      // reading position so saving from halfway through a review leaves the same code in view.
      const pane = el("diff"),
        at = pane.scrollTop,
        before = pane.scrollHeight;
      removeDraftBox(box);
      const host = globalHost(true);
      if (host) mountGlobal(host, note);
      if (at > 0) pane.scrollTop = at + (pane.scrollHeight - before);
    } else if (ctx.cleanup) {
      const before = ctx.stage.getBoundingClientRect().top;
      removeDraftBox(box);
      const host = el("fn" + fi);
      if (host)
        viewUI(mountFileBox(host, id), note, {
          ...ctx,
          cleanup: null,
          capture: null,
        });
      el("diff").scrollTop += ctx.stage.getBoundingClientRect().top - before;
    } else {
      viewUI(box, note, ctx);
      repaintNote(id, box); // the same note may be mounted in the all-notes panel as well
    }
    mark(fi, i, j, true);
    if (ch) repaintRow(fi, i);
    renderTree();
    updateCount();
    paintImageNotes();
    void sendNote(note, false, ask);
  };
  const drop = () => {
    // Emptying a saved note is deleting it, and deleting is what takes it out of the review file
    // too; only a draft that never existed comes down with no more ceremony than cancel.
    const kept = state.notes.get(id);
    if (kept) {
      clearSel();
      removeNote(box, kept, ctx);
      return;
    }
    removeDraftBox(box);
    clearSel();
    if (ch) repaintRow(fi, i);
    syncGlobals();
    ctx.onCancel?.();
  };
  box.querySelector("[data-save-note]").onclick = () => commit(false);
  box.querySelector("[data-ask-note]").onclick = () => commit(true);
  const del = box.querySelector(".del");
  if (del) del.onclick = drop;
  const cancel = () => {
    const kept = state.notes.get(id);
    clearSel();
    if (kept) viewUI(box, kept, ctx);
    else {
      removeDraftBox(box);
      syncGlobals();
      ctx.onCancel?.();
    }
  };
  const cancelButton = box.querySelector(".cancel");
  if (cancelButton) cancelButton.onclick = cancel;
}

/** Keep the editor's save gesture local to this note, and repaint only its existing copies. */
async function sendNote(note: any, retry = false, ask = true) {
  state.noteDelivery.set(note.id, {
    state: "sending",
    agent: ask ? state.agent : "",
  });
  const agent = ask ? state.agent : "";
  const sending = submitNote(note, retry, ask);
  repaintNote(note.id);
  updateCount();
  try {
    const data = await sending;
    if (state.notes.has(note.id))
      state.noteDelivery.set(note.id, {
        ...(data?.delivery || { state: "saved" }),
        agent,
        error:
          data?.delivery?.error ||
          (!data?.delivery && agent
            ? "Saved locally without an ACP connection."
            : ""),
      });
    if (!state.noteDelivery.get(note.id)?.error)
      document.dispatchEvent(
        new CustomEvent("lcr:note-saved", { detail: note.id }),
      );
  } catch (error) {
    if (state.notes.has(note.id))
      state.noteDelivery.set(note.id, {
        state: "failed",
        agent,
        error:
          "Could not save this note: " +
          (error instanceof Error ? error.message : String(error)),
      });
  } finally {
    if (state.notes.has(note.id)) {
      repaintNote(note.id);
      updateCount();
    }
  }
}

function deliveryHtml(note: any) {
  const task = managedNoteTask(note.id);
  if (task) return queueTaskStatusHtml(task);
  const delivery = state.noteDelivery.get(note.id);
  if (!delivery) return "";
  const label = state.noteSending.has(note.id)
    ? "sending…"
    : delivery.state === "queued"
      ? "queued"
      : delivery.state === "unchanged"
        ? "saved"
        : delivery.error
          ? "not sent"
          : "saved";
  return (
    '<span class="stat" title="' +
    esc(delivery.error || "This note’s delivery to the agent") +
    '">' +
    esc(label) +
    "</span>"
  );
}
/**
 * What a note's placement has to say once the diff cannot provide one unambiguous line for it.
 * Keeping it visibly detached is safer than making a nearby or duplicate line look authoritative.
 */
const PLACING = {
  outdated: [
    "outdated",
    "The code this comment was attached to is gone or appears in more than one place. It is kept under its original file instead of attaching it to an unrelated line.",
  ],
  stray: [
    "file not in this diff",
    "The file this note was written on has no changes left in the diff, so there is nowhere to attach it.",
  ],
};
function placeHtml(how: string) {
  const entry = PLACING[how];
  if (!entry) return "";
  return (
    '<div class="lost" title="' +
    esc(entry[1]) +
    '"><span class="tag">' +
    esc(entry[0]) +
    "</span>" +
    '<span class="why">' +
    esc(entry[1]) +
    "</span></div>"
  );
}
/**
 * The lines the note was written on, kept with the note itself. A note is read a long way from where
 * it was made — under the file, at the end of the page, or after the agent has rewritten everything
 * around it — so it carries its own subject rather than relying on the row above it.
 *
 * The heading is where a note says its code has gone. `exact` and `moved` are both sitting on the code
 * they captured, wherever in the file that now is, so they read as the code in front of you; the rest
 * are showing a record of code the diff no longer has.
 */
function capturedHtml(note: any, how: string) {
  if (!note.code || !note.code.trim()) return "";
  const lang = langOf(note.file);
  const rows = note.code
    .split("\n")
    .map((line: string) => {
      const t = line[0] === "+" ? "add" : line[0] === "-" ? "del" : "ctx";
      return (
        '<div class="cl ' +
        t +
        '"><span class="cm">' +
        esc(line[0] || " ") +
        "</span>" +
        '<span class="c">' +
        codeHtml(line.slice(1), lang) +
        "</span></div>"
      );
    })
    .join("");
  const here = how === "exact" || how === "moved" || how === "file";
  return (
    '<div class="cap' +
    (here ? "" : " was") +
    '"><div class="caph">' +
    (here
      ? "commented on"
      : "commented on — this code is no longer in the diff") +
    "</div>" +
    '<div class="capc">' +
    rows +
    "</div></div>"
  );
}
function canEditNote(note: any) {
  return (
    !msgsOf(note).some((message: any) => message.role === "agent") &&
    !["answered", "applied", "skipped"].includes(statusOf(note)?.status)
  );
}

export function viewUI(box, note, ctx) {
  noteContexts.set(box, ctx);
  const st = statusOf(note);
  const how = ctx.how || "exact";
  const lost = how === "outdated" || how === "stray";
  const unread = unreadOf(note);
  // A note read away from the diff needs the way back to it. Read off the DOM rather than passed in,
  // so a note repainted by a reply or a verdict keeps the button wherever it is mounted.
  const away = !!box.closest(".rdr");
  box.classList.toggle("done", !!st && st.status === "applied");
  box.classList.toggle("adrift", lost);
  box.classList.toggle("unread-on", !!unread);
  box.innerHTML =
    headHtml(
      ctx.f,
      note.label,
      note.snippet,
      '<span class="unread"' +
        (unread ? "" : " hidden") +
        ">" +
        (unread ? unread + " new" : "") +
        "</span>" +
        statusChip(st) +
        deliveryHtml(note) +
        '<button class="copyref" title="Copy this short reference to paste into another note">' +
        esc(refToken(note)) +
        "</button>" +
        (away
          ? '<button class="jmp" data-goto="' +
            esc(note.id) +
            '" title="Show this note where it sits in the diff">' +
            (ctx.scope === "global" ? "show" : "in diff") +
            "</button>"
          : "") +
        (isResolved(note) || canResolve(note)
          ? '<button class="resolve" data-resolve="' +
            esc(note.id) +
            '" title="' +
            (isResolved(note)
              ? "Show this conversation again"
              : "Hide from the page; keep the conversation in Markdown") +
            '">' +
            SVG.check +
            " " +
            (isResolved(note) ? "Reopen" : "Resolve") +
            "</button>"
          : "") +
        (note.web && state.web
          ? '<button data-web-focus="' +
            esc(note.id) +
            '">On page</button><button data-web-after="' +
            esc(note.id) +
            '">Capture after</button>'
          : "") +
        '<button class="history" title="See earlier versions of this note">History</button>' +
        (canEditNote(note) ? '<button class="edit">Edit</button>' : "") +
        (!canResolve(note) ? '<button class="danger del">Delete</button>' : ""),
      ctx.scope,
      note.image,
      note.web,
    ) +
    placeHtml(
      how === "exact" || how === "file" || how === "global" ? "" : how,
    ) +
    capturedHtml(note, how) +
    "<div data-web-evidence>" +
    webCaptureHtml(note.web, true) +
    "</div>" +
    imageCaptureHtml(
      note.image,
      !!ctx.f.hash && note.image?.source !== ctx.f.hash,
    ) +
    '<div class="nbody"></div>' +
    (st && st.detail ? '<div class="nstat"></div>' : "") +
    '<div class="thread"></div><div class="replyhost"></div>';
  renderBody(
    box.querySelector(".nbody"),
    note.body,
    note.file,
    capturedLines(note.code),
  );
  if (st && st.detail)
    box.querySelector(".nstat").textContent =
      st.status.replace("-", " ") + " — " + st.detail;
  renderThread(box.querySelector(".thread"), note, () => repaintNote(note.id));
  mountReply(box.querySelector(".replyhost"), note, () => repaintNote(note.id));
  box.querySelector(".history").onclick = () => openHistory(note.id);
  box.querySelector(".copyref").onclick = (e: any) =>
    copyText(e.currentTarget, refToken(note));
  // Looking at a note is what reads its thread; the count in the footer follows from that. The box
  // outlives its contents, so the listener is attached once and finds the note again when it fires.
  if (!box.__read) {
    box.__read = true;
    box.addEventListener("click", () => {
      const id = rowOf(box)?.dataset.nid;
      const seen = id && state.notes.get(id);
      if (!seen || !markRead(seen)) return;
      save();
      updateCount();
      box.classList.remove("unread-on");
      const chip = box.querySelector(".unread");
      if (chip) {
        chip.hidden = true;
        chip.textContent = "";
      }
      box
        .querySelectorAll(".msg.fresh")
        .forEach((m: any) => m.classList.remove("fresh"));
    });
  }
  const edit = box.querySelector(".edit");
  if (edit)
    edit.onclick = () => {
      if (busyEditor()) return;
      if (lost) {
        alert(
          "This note has no lines to edit against any more. Reply to it instead, or delete it.",
        );
        return;
      }
      const current = state.notes.get(note.id) || note;
      editUI(
        box,
        Object.assign({}, ctx, {
          id: current.id,
          body: current.body,
          image: current.image,
          web: current.web,
        }),
      );
    };
  const del = box.querySelector(".del");
  if (del) del.onclick = () => removeNote(box, note, ctx);
  wireWebRemoval(box);
}
/** Deleting a note that was handed over takes it out of the review file too, thread and all. */
function removeNote(box, note, ctx) {
  if (
    note.sentAt &&
    !confirm(
      "Delete this note?\n\nIt is in " +
        (state.sessionFile || "the review file") +
        ", so its thread goes with it.",
    )
  )
    return;
  state.notes.delete(note.id);
  state.msgs.delete(note.id);
  state.seen.delete(note.id);
  state.place.delete(note.id);
  save();
  if (ctx.f && ctx.i != null && ctx.i >= 0) remark(ctx.f, ctx.fi, ctx.i, ctx.j);
  // Every box the note had, not only the one deleted from: it may also be mounted in the panel.
  document.querySelectorAll(".nrow").forEach((row: any) => {
    if (row.dataset.nid === note.id) row.remove();
  });
  if (note.ca != null && ctx.i != null && ctx.i >= 0) repaintRow(ctx.fi, ctx.i);
  syncGlobals(); // the card at the top goes with the last note in it
  renderTree();
  updateCount();
  paintImageNotes();
  withdrawNotes([note.id]);
}
function mark(fi, i, j, on) {
  if (i == null || i < 0) return; // a file note, or one with no rows left, marks no lines
  for (let k = i; k <= j; k++) {
    const tr = el("r" + fi + "-" + k);
    if (tr && tr.classList.contains("r")) tr.classList.toggle("noted", on);
  }
}
/** Repaints a span a note has just left: the lines under it may still be covered by other notes. */
function remark(f, fi, i, j) {
  if (i == null || i < 0) return; // a file note marks no lines
  const spans = [];
  state.notes.forEach((n: any) => {
    if (!noteVisible(n)) return;
    if (n.file !== f.path || isFileNote(n)) return;
    const p = placeOf(n);
    if (p && p.i >= 0) spans.push([p.i, p.j]);
  });
  for (let k = i; k <= j; k++) {
    const tr = el("r" + fi + "-" + k);
    if (tr && tr.classList.contains("r"))
      tr.classList.toggle(
        "noted",
        spans.some((s) => s[0] <= k && k <= s[1]),
      );
  }
}
/** Mounts every note on the file itself under a freshly rendered file header. */
export function applyFileNotes(f: any, fi: number) {
  const host = el("fn" + fi);
  if (!host) return;
  state.notes.forEach((n: any) => {
    if (!noteVisible(n)) return;
    if (n.file !== f.path || !isFileNote(n)) return;
    viewUI(mountFileBox(host, n.id), n, {
      f,
      fi,
      i: null,
      j: null,
      ch: null,
      scope: "file",
      how: "file",
    });
  });
}
export function applyNotesIn(f: any, fi: number, from: number, to: number) {
  keyIndex(f); // built once here, so every placement below reads the same index
  state.notes.forEach((n) => {
    if (!noteVisible(n)) return;
    if (n.file !== f.path) return;
    const p = placeOf(n);
    if (!p || p.i < 0) return;
    const i = p.i,
      j = p.j;
    if (j < from || i >= to) return;
    mark(fi, Math.max(i, from), Math.min(j, to - 1), true);
    if (j < from || j >= to) return; // the box belongs to the block holding the last row
    const anchor = el("r" + fi + "-" + j);
    if (!anchor) return;
    const ch = n.ca != null ? charSpan(n, f.rows[i].text) : null;
    if (!rowFor(anchor, n.id))
      viewUI(mountRow(anchor, n.id), n, { f, fi, i, j, ch, how: p.how });
  });
}
/** Mounts a note that has no row of its own, inside whichever holding block it belongs to. */
export function mountDetached(
  host: any,
  note: any,
  f: any,
  fi: number,
  how: string,
) {
  const box = mountFileBox(host, note.id);
  viewUI(box, note, { f, fi, i: null, j: null, ch: null, how });
}
/**
 * How a note is drawn wherever it is mounted, worked out from where the diff places it now rather
 * than from where it was written. Edit reads the note's shape off this, so a whole-file note must
 * say it is one here too.
 */
function ctxFor(n: any) {
  if (isGlobalNote(n))
    return {
      f: { path: "", rows: [] },
      fi: -1,
      i: null,
      j: null,
      ch: null,
      how: "global",
      scope: "global",
      web: n.web,
    };
  const p = placeOf(n);
  const f = p ? state.files[p.fi] : { path: n.file, rows: [] };
  const how = p ? p.how : "stray";
  const ch =
    n.ca != null && p && p.i >= 0 && f.rows[p.i]
      ? charSpan(n, f.rows[p.i].text)
      : null;
  const ctx: any = {
    f,
    fi: p ? p.fi : -1,
    i: p ? p.i : null,
    j: p ? p.j : null,
    ch,
    how,
  };
  if (isFileNote(n)) ctx.scope = "file";
  return ctx;
}
/** Mounts one of the review's own notes in the card above the diff. */
export function mountGlobal(host: any, note: any) {
  viewUI(mountFileBox(host, note.id), note, ctxFor(note));
}
/**
 * Mounts a note somewhere that is not the row it belongs to — the all-notes panel reads the whole
 * review this way. It is the same box the diff shows, so everything a note can do it can do here.
 */
export function mountNoteIn(host: any, note: any) {
  const box = mountFileBox(host, note.id);
  viewUI(box, note, ctxFor(note));
  return box;
}
/**
 * Redraws one note wherever it is mounted, for a reply or a verdict that arrived from the review
 * file. An open editor keeps its wording and DOM; only its visual evidence and commit context
 * refresh in place. `skip` is the box whose own change started this and is already current.
 */
export function repaintNote(id: string, skip?: any) {
  const n = state.notes.get(id);
  if (!n) return;
  const ctx = ctxFor(n);
  document.querySelectorAll(".nrow").forEach((row: any) => {
    if (row.dataset.nid !== id) return;
    const box = row.querySelector(".nbox");
    if (!box || box === skip) return;
    const reply: any = box.querySelector(".reply");
    if (reply && activeEditor(reply.closest(".nbox"))?.closest(".reply")) {
      const focused = reply.contains(document.activeElement)
        ? (document.activeElement as HTMLTextAreaElement)
        : null;
      const from = focused?.selectionStart,
        to = focused?.selectionEnd;
      reply.remove();
      viewUI(box, n, ctx);
      box.querySelector(".reply")?.replaceWith(reply);
      if (focused) {
        focused.focus({ preventScroll: true });
        focused.setSelectionRange(from, to);
      }
      return;
    }
    if (activeEditor(box)) {
      const editing = noteContexts.get(box);
      if (editing && (editing.web ?? null) !== (n.web ?? null))
        updateWebNoteEvidence(row.parentElement, id, n.web ?? null);
      refreshWebControls(box);
      return;
    }
    viewUI(box, n, ctx);
  });
}
