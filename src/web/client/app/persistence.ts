import { bookmarksIn } from "../navigation/bookmarks.ts";
import { compileHide } from "../diff/filters.ts";
import {
  GLOBAL_ANCHOR,
  el,
  idxOf,
  isMinted,
  markSubmitted,
  mintGlobalId,
  mintNoteId,
  reindexNotes,
  saveKeyHint,
  state,
} from "./state.ts";
import { adoptAgent } from "./agent.ts";
import { rememberPage } from "../history/history.ts";
import {
  DEFAULT_UI_SETTINGS,
  parseUiSettings,
  type UiSettings,
} from "../../../shared/settings.ts";
import { setContextToken } from "../components/context.ts";

// All saves and deletes share a queue, so a late review-wide save cannot resurrect a deleted note.
let noteWrites: Promise<unknown> = Promise.resolve();
function writeNotes<T>(work: () => Promise<T>): Promise<T> {
  const next = noteWrites.then(work, work);
  noteWrites = next.catch(() => {});
  return next;
}

/** Save the notes present at the click, even if another edit arrives while a write is in flight. */
export function submitReview() {
  const snapshot = structuredClone([...state.notes.values()]);
  const replace = !!state.cfg.single;
  snapshot.forEach((note) =>
    state.noteSending.set(note.id, (state.noteSending.get(note.id) || 0) + 1),
  );
  return writeNotes(async () => {
    const comments = snapshot.filter((note) => state.notes.has(note.id));
    if (!comments.length) return null;
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comments, replace }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not save this review.");
    state.sessionFile = data.file;
    markSubmitted(
      data.file,
      comments.map((note) => note.id),
    );
    adoptAgent(data);
    save();
    return data;
  }).finally(() => snapshot.forEach((note) => finishSending(note.id)));
}

function finishSending(id: string) {
  const left = (state.noteSending.get(id) || 1) - 1;
  if (left) state.noteSending.set(id, left);
  else state.noteSending.delete(id);
}

export function submitNote(note: any, retry = false, ask = true) {
  state.noteSending.set(note.id, (state.noteSending.get(note.id) || 0) + 1);
  return writeNotes(async () => {
    if (!state.notes.has(note.id)) return null;
    const response = await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comment: note,
        retry,
        ask,
        replace: !!state.cfg.single,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not save this note.");
    if (state.notes.has(note.id)) {
      state.sessionFile = data.file;
      markSubmitted(data.file, [note.id]);
      adoptAgent(data);
      save();
    }
    return data;
  }).finally(() => finishSending(note.id));
}

/* ---------- persistence ---------- */
const CFG_KEY = "gitreview:settings";
const CFG_RUN_KEY = "gitreview:settings-run";
let cfgRunId = "";
let cfgRequests: Promise<unknown> = Promise.resolve();
function queueCfg(work: () => Promise<void>): Promise<void> {
  const next = cfgRequests.then(work);
  cfgRequests = next.catch(() => {});
  return next;
}
function adoptCfg(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(DEFAULT_UI_SETTINGS)) {
    if (!Object.hasOwn(value, key)) continue;
    try {
      Object.assign(
        state.cfg,
        parseUiSettings({ [key]: Reflect.get(value, key) }),
      );
    } catch {
      // Ignore an invalid stored preference without dropping the other browser preferences.
    }
  }
}
async function readCfg(): Promise<{
  runId: string;
  defaults: Partial<UiSettings>;
  settings: Partial<UiSettings>;
}> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  if (!response.ok)
    throw new Error(
      "Could not load review settings. Retry to load this review.",
    );
  const data = await response.json();
  if (typeof data.runId !== "string" || !data.runId)
    throw new Error("Invalid review settings. Retry to load this review.");
  setContextToken(data.contextToken);
  return {
    runId: data.runId,
    defaults: parseUiSettings(data.defaults),
    settings: parseUiSettings(data.settings),
  };
}
async function publishCfg() {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.cfg),
  });
  if (!response.ok)
    throw new Error(
      "Could not share review settings. Retry to load this review.",
    );
}
function storeCfg() {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(state.cfg));
    localStorage.setItem(CFG_RUN_KEY, cfgRunId);
  } catch {}
}
/** Load the run identity before allowing browser preferences to publish or the UI to render. */
export function loadCfg(): Promise<void> {
  const embedded = state.uiEmbed;
  return queueCfg(async () => {
    const data = await readCfg();
    state.cfg = { ...DEFAULT_UI_SETTINGS, disabledHide: [] };
    if (embedded) {
      // Third-party storage partitions are not authoritative for an embedded editor.
      adoptCfg(data.settings);
    } else {
      let storedRun = "";
      try {
        adoptCfg(JSON.parse(localStorage.getItem(CFG_KEY) || "{}"));
        storedRun = localStorage.getItem(CFG_RUN_KEY) || "";
      } catch {}
      if (storedRun !== data.runId) adoptCfg(data.defaults);
      cfgRunId = data.runId;
      storeCfg();
    }
    paintCfg();
    if (!embedded) await publishCfg();
  });
}
function paintCfg() {
  el("cfgAuto").checked = state.cfg.auto;
  el("cfgBack").checked = state.cfg.back;
  el("cfgToast").checked = state.cfg.toast;
  el("cfgLimit").value = String(state.cfg.limit);
  el("cfgExpand").value = String(state.cfg.expand);
  el("cfgHide").value = state.cfg.hide || "";
  el("cfgDeleted").checked = !!state.cfg.hideDeleted;
  el("cfgEnter").checked = state.cfg.enterSaves;
  el("cfgSingle").checked = !!state.cfg.single;
  el("cfgGhosts").checked = state.cfg.ghosts !== false;
  el("cfgEditor").value = state.cfg.editor || "";
  el("cfgBack").disabled = !state.cfg.auto;
  el("cfgAiContext").checked = state.cfg.aiContext;
  el("cfgContextHtml").checked = state.cfg.contextHtml;
  el("cfgContextFullPage").checked = state.cfg.contextFullPage;
  el("cfgContextHtml").disabled = !state.cfg.aiContext;
  el("cfgContextFullPage").disabled = !state.cfg.aiContext;
  state.hideRx = compileHide(state.cfg.hide, state.cfg.disabledHide);
  // Do not render an editor to update its shortcut hint: its text, selection and handlers stay put.
  document
    .querySelectorAll?.<HTMLElement>(".nedit .tip,.medit .tip,.reply .tip")
    .forEach((hint) => {
      hint.textContent =
        saveKeyHint() +
        (hint.closest(".reply") ? " send" : " save") +
        " · esc cancel";
    });
}
/** The HTTP/SSE handoff crosses browser storage partitions. Only full review tabs may publish. */
export function syncCfg(): Promise<void> {
  const embedded = state.uiEmbed;
  return queueCfg(async () => {
    const data = await readCfg();
    if (embedded) {
      adoptCfg(data.settings);
      paintCfg();
      return;
    }
    // An old tab can reconnect to a new server at the same origin. Read before publishing so its
    // stale snapshot cannot overwrite newly configured defaults, even before the page is reloaded.
    if (cfgRunId !== data.runId) {
      adoptCfg(data.defaults);
      cfgRunId = data.runId;
      storeCfg();
      paintCfg();
    }
    await publishCfg();
  });
}
/** Writes `state.cfg` out as it stands, for the preferences that are not fields in the settings panel. */
export function persistCfg() {
  if (state.uiEmbed) return;
  storeCfg();
  paintCfg();
  if (typeof window !== "undefined") void syncCfg().catch(() => {});
}
/** Returns true for the settings the rendered diff depends on: which files it shows, and its expanders. */
export function saveCfg() {
  state.cfg.auto = el("cfgAuto").checked;
  state.cfg.back = el("cfgBack").checked;
  state.cfg.toast = el("cfgToast").checked;
  state.cfg.limit = Number(el("cfgLimit").value);
  state.cfg.enterSaves = el("cfgEnter").checked;
  state.cfg.single = el("cfgSingle").checked;
  state.cfg.editor = el("cfgEditor").value.trim();
  state.cfg.aiContext = el("cfgAiContext").checked;
  state.cfg.contextHtml = el("cfgContextHtml").checked;
  state.cfg.contextFullPage = el("cfgContextFullPage").checked;
  const hide = el("cfgHide").value,
    deleted = el("cfgDeleted").checked;
  const expand = Number(el("cfgExpand").value);
  const ghosts = el("cfgGhosts").checked;
  const changed =
    hide !== state.cfg.hide ||
    deleted !== !!state.cfg.hideDeleted ||
    expand !== state.cfg.expand ||
    ghosts !== (state.cfg.ghosts !== false);
  state.cfg.ghosts = ghosts;
  state.cfg.hideDeleted = deleted;
  state.cfg.expand = expand;
  if (hide !== state.cfg.hide)
    state.hideRx = compileHide(hide, state.cfg.disabledHide);
  state.cfg.hide = hide;
  el("cfgBack").disabled = !state.cfg.auto;
  persistCfg();
  return changed;
}
/**
 * Which read this is: the repository as the server named it, and what is being read in it. Every
 * run is served from `localhost` and a port one review frees the next one takes, so the origin alone
 * cannot tell two projects apart — without the repository in the key, every project on a machine
 * shares one record and reads back another project's notes.
 *
 * A run started with `--id` is keyed on that name rather than on its diff, because the name is what
 * identifies the review: it comes back to its own notes wherever the diff has moved to since, and a
 * name nothing has been read under yet starts with nothing stored, which is what makes a new name an
 * altogether new review rather than the last one's notes under another heading.
 */
const scope = () =>
  state.repo + ":" + (state.reviewId ? "#" + state.reviewId : state.range);
const store = () => "gitreview:" + scope();
/** Said once per session: every save after a full store fails the same way, and one warning is news. */
let warnedStore = false;
function warnStore() {
  if (warnedStore) return;
  warnedStore = true;
  const host = el("toasts");
  if (!host) return;
  const t = document.createElement("div");
  t.className = "toast off";
  t.innerHTML = '<span class="tx"></span><span class="lbl">not stored</span>';
  t.querySelector(".tx").textContent =
    "The browser refused to store this page’s notes — a reload may lose unsaved ones. Save the review to keep them.";
  host.append(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 200);
  }, 9000);
}
export function save() {
  reindexNotes();
  rememberPage();
  if (typeof document.dispatchEvent === "function")
    document.dispatchEvent(new Event("lcr:notes"));
  // Embedded editors write their own note through the API, never a stale copy of another tab's store.
  if (state.uiEmbed) return;
  try {
    localStorage.setItem(
      store(),
      JSON.stringify({
        notes: [...state.notes.values()],
        hidden: [...state.hidden],
        shown: [...state.shown],
        collapsed: [...state.collapsed],
        folded: [...state.folded],
        viewed: [...state.viewed],
        delFold: [...state.delFold],
        // The review file owns the threads; this copy is only so a reload has them before it answers.
        msgs: [...state.msgs],
        seen: [...state.seen],
        resolved: [...state.resolved],
      }),
    );
  } catch (e) {
    warnStore(); // usually the quota: the page still works, but a reload would forget
  }
}
export function restore() {
  // Ahead of the notes, and not after them: a repository with nothing stored yet leaves early below,
  // and this tab may still be mid-read through it.
  restoreBookmarks();
  try {
    const d = JSON.parse(localStorage.getItem(store()) || "null");
    if (!d) return;
    // The overall note used to be one field beside the notes rather than a note. What was typed into
    // it is still worth keeping, so it comes back as the first of the review's own notes.
    if ((d.general || "").trim()) {
      const id = mintGlobalId();
      state.notes.set(id, {
        id,
        file: "",
        body: d.general.trim(),
        a: GLOBAL_ANCHOR,
        b: GLOBAL_ANCHOR,
        scope: "global",
        start: 0,
        end: 0,
      });
    }
    (d.notes || []).forEach((n) => {
      // Ids used to be derived from the note's location, which made a note written where a handled one
      // had been indistinguishable from it. Notes stored that way are re-minted as the fresh, unsent
      // notes we cannot prove they are not; the cost is losing verdicts reported before this version.
      if (!isMinted(n.id)) {
        n.id = mintNoteId(n.file, n.a, n.b, n.ca, n.cb);
        n.sentAt = 0;
      }
      state.notes.set(n.id, n);
    });
    state.hidden = new Set(d.hidden || []);
    state.shown = new Set(d.shown || []);
    state.collapsed = new Set(d.collapsed || []);
    state.folded = new Set(d.folded || []);
    // Which runs stand open is this read of the diff; which files fold theirs at all is a preference.
    state.delFold = new Map(
      (d.delFold || [])
        .filter((e) => e && typeof e[0] === "string")
        .map((e) => [e[0], !!e[1]]),
    );
    state.viewed = new Map(
      (d.viewed || []).map((e) => [
        e[0],
        typeof e[1] === "string" ? { h: e[1], auto: false } : e[1],
      ]),
    );
    state.msgs = new Map(
      (d.msgs || []).filter((e) => e && e[0] && Array.isArray(e[1])),
    );
    state.seen = new Map((d.seen || []).filter((e) => e && e[0]));
    state.resolved = new Map(
      (d.resolved || []).filter(
        (e) => e && typeof e[0] === "string" && typeof e[1] === "string",
      ),
    );
  } catch (e) {}
}
/**
 * Bookmarks are the trail of one sitting, not a record of it: they say where the reader meant to
 * come back to before finishing, so they belong to the tab doing the reading and go when it closes.
 * That is what sessionStorage is — it survives the reload a live diff refresh or an F5 costs, and
 * nothing further. Notes are the opposite and stay in `store()`, which outlives the tab.
 */
const BM_KEY = "gitreview:bookmarks";
export function saveBookmarks() {
  try {
    sessionStorage.setItem(
      BM_KEY,
      JSON.stringify({ scope: scope(), list: [...state.bookmarks.values()] }),
    );
  } catch (e) {
    // Losing a place to jump back to costs a scroll, so it is not worth a warning of its own.
  }
}
export function restoreBookmarks() {
  let record = null;
  try {
    record = JSON.parse(sessionStorage.getItem(BM_KEY) || "null");
  } catch (e) {}
  state.bookmarks = new Map(
    bookmarksIn(record, scope()).map((b: any) => [b.key, b]),
  );
  state.bmCur = "";
}
/** Drops every bookmark and the record behind it, for the moments that end a read-through. */
export function clearBookmarks() {
  state.bookmarks.clear();
  state.bmCur = "";
  saveBookmarks();
}
/** A file whose notes are gone was reviewed for feedback that no longer exists, so it needs another
 *  pass; a file nobody commented on keeps its mark, which pruneViewed drops if the file changed. */
export function unviewCommented(notes = [...state.notes.values()]) {
  // A note about the review as a whole names no file, so it puts none of them back either.
  const commented = new Set(notes.map((n: any) => n.file).filter(Boolean));
  commented.forEach((p) => {
    state.viewed.delete(p);
    state.folded.delete(p);
  });
  return commented;
}
/**
 * Takes notes out of the review file. The page reads that file back whole on every review event, so
 * a note only dropped here comes straight back with the next one — withdrawing is what makes
 * clearing stick. One request for the whole set: a delete per note announces the file after each
 * write, and the page would adopt the notes still in it back onto the page that just let them go.
 */
export function withdrawNotes(ids: string[]) {
  const query = ids.map((id) => "id=" + encodeURIComponent(id));
  if (!query.length) return Promise.resolve();
  // The page has already let them go; the file catches up, and a failed delete costs a stale entry.
  return writeNotes(() =>
    fetch("/api/note?" + query.join("&"), { method: "DELETE" }).then(
      () => {},
      () => {},
    ),
  );
}
/** Drops the selected conversations, all by default. Display preferences stay. The review file
 *  remains untouched here; withdrawing the selected ids from it is the caller's to do. */
export function clearNotes(ids = [...state.notes.keys()]) {
  const unviewed = unviewCommented(
    ids.map((id) => state.notes.get(id)).filter(Boolean),
  );
  ids.forEach((id) => {
    state.notes.delete(id);
    state.msgs.delete(id);
    state.seen.delete(id);
    state.place.delete(id);
    state.resolved.delete(id);
  });
  if (!state.notes.size) state.resolved.clear();
  state.showResolved = false;
  save();
  return unviewed;
}
/** A viewed mark only holds while the file's diff is byte-identical to what was reviewed. */
export function pruneViewed() {
  const stale = [];
  state.viewed.forEach((v, p) => {
    const i = idxOf(p);
    if (i < 0 || state.files[i].hash !== v.h) stale.push(p);
  });
  stale.forEach((p) => {
    state.viewed.delete(p);
    state.folded.delete(p);
  });
  return stale;
}
