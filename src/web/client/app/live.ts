import {
  registerView,
  setView,
  setViews,
} from "../navigation/ui-navigation.ts";
import { placeNotes, placeOf } from "../diff/anchor.ts";
import { mountRowAt, setFolded, setHidden } from "../diff/diff-view.ts";
import { isHidden } from "../diff/filters.ts";
import { updateCount } from "../notes/footer.ts";
import { adopt, load, render } from "./load.ts";
import { markCurrentNote } from "../notes/note-pane.ts";
import { save, syncCfg } from "./persistence.ts";
import { busyEditor, repaintNote } from "../notes/notes.ts";
import { closeReader, syncReader } from "../notes/reader.ts";
import {
  SVG,
  el,
  esc,
  idxOf,
  msgsOf,
  state,
  visibleNotes,
  noteVisible,
} from "./state.ts";
import { paintActive } from "../navigation/tree.ts";
import { noteByRef, refOf } from "../notes/note-ref.ts";
import { activeEditor } from "../components/composer.ts";

/* ---------- following the agent ---------- */
/**
 * The page keeps a connection open while the review is being worked on. Events carry no state, only
 * the news that the review file or the diff moved, and the page fetches what it needs itself — so a
 * dropped connection costs nothing that a reconnect does not fix.
 *
 * A refresh that arrives mid-sentence would rebuild the pane under an open editor, so the diff waits
 * for that editor to close. Replies never wait: they only add to a note that is already on screen.
 */

const editing = () =>
  !!activeEditor() || !!document.querySelector("[data-annotation-editor]");

export function startLive() {
  const source = new EventSource("/api/events");
  let connected = false;
  source.onopen = () => {
    setLive(true);
    // Refresh on the first open too: a settings change can land between editor load and subscribe.
    void syncCfg().catch(() => {});
    // Whatever moved while the connection was down was announced to nobody, so a reconnect
    // fetches instead of trusting the silence; the first open lands on a freshly loaded page.
    if (connected) {
      refreshReview();
      checkDiffStale();
    }
    connected = true;
  };
  source.onerror = () => setLive(false); // EventSource reconnects on its own
  source.onmessage = (e: any) => {
    let event: any = null;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    if (event.type === "hello") {
      state.sessionFile = event.file || state.sessionFile;
      setLive(true);
      return;
    }
    if (event.type === "settings") {
      if (state.uiEmbed) void syncCfg().catch(() => {});
      return;
    }
    if (event.type === "review") {
      refreshReview();
      return;
    }
    if (event.type === "diff") queueDiff();
  };
  // An editor can close in ways nothing here sees, so the wait is checked rather than subscribed to.
  setInterval(() => {
    if (editing()) return;
    if (state.pendingDiff) {
      applyDiff();
      return;
    }
    if (state.pendingNotes) {
      state.pendingNotes = false;
      placeNotes();
      render();
      return;
    }
    // A panel rebuild the editor above was holding off: taking it now costs nobody anything.
    if (state.rdrStale) {
      state.rdrStale = false;
      syncReader();
    }
  }, 700);
}

function setLive(on: boolean) {
  state.live = on;
  const dot = el("live");
  if (!dot) return;
  dot.classList.toggle("on", on);
  dot.title = on
    ? "Following the review file and the working tree"
    : "Not connected — reload to catch up";
}

function queueDiff() {
  if (editing()) {
    state.pendingDiff = true;
    paintPending();
    return;
  }
  applyDiff();
}
async function applyDiff() {
  state.pendingDiff = false;
  state.pendingNotes = false; // the reload rebuilds the pane with every note placed
  paintPending();
  await load(true);
}

/** Compares the diff on the server with the one on screen, and only rebuilds when they differ. */
async function checkDiffStale() {
  try {
    const response = await fetch("/api/diff");
    const d = await response.json();
    if (!response.ok || d.error || !Array.isArray(d.files)) return;
    const same =
      d.files.length === state.files.length &&
      d.files.every(
        (f: any, k: number) =>
          state.files[k].path === f.path && state.files[k].hash === f.hash,
      );
    if (!same) queueDiff();
  } catch {
    // The next event, or the reader's own reload, will try again.
  }
}
function paintPending() {
  const pill = el("pending");
  if (!pill) return;
  pill.hidden = !state.pendingDiff;
}

/** The review file moved: take the threads and verdicts back from it and repaint what changed. */
let refreshing = false,
  again = false;
async function refreshReview() {
  if (refreshing) {
    again = true;
    return;
  }
  refreshing = true;
  try {
    const response = await fetch("/api/review");
    const data = await response.json();
    if (!response.ok) return;
    const beforeVisible = new Set(visibleNotes().map((n: any) => n.id));
    const before = new Map(
      [...state.notes.keys()].map((id: any) => [
        id,
        (state.msgs.get(id) || []).length,
      ]),
    );
    (data.statuses || []).forEach((s: any) => {
      if (s.id) state.status.set(s.id, s);
      if (s.key) state.statusByKey.set(s.key, s);
    });
    adopt(data);
    save();
    // A note that arrived from the file has no box yet, so the pane is rebuilt for it — but a
    // rebuild eats an open editor, so it waits for the last one to close, exactly as a diff does.
    const afterVisible = visibleNotes();
    const changed =
      afterVisible.some((n) => !beforeVisible.has(n.id)) ||
      [...beforeVisible].some((id) => !afterVisible.some((n) => n.id === id));
    if (changed && !editing()) {
      placeNotes();
      render();
    } else {
      if (changed) state.pendingNotes = true;
      state.notes.forEach((n: any) => repaintNote(n.id));
      updateCount();
    }
    announce(before);
  } finally {
    refreshing = false;
    if (again) {
      again = false;
      refreshReview();
    }
  }
}

/** Says what the agent just wrote, and offers to take the reader to it. */
function announce(before: Map<string, number>) {
  const host = el("toasts");
  if (!host) return;
  state.notes.forEach((n: any) => {
    const had = before.get(n.id);
    if (had == null) return;
    const msgs = msgsOf(n);
    const last = msgs[msgs.length - 1];
    if (msgs.length <= had || !last || last.role !== "agent") return;
    const toast = document.createElement("div");
    toast.className = "toast reply";
    const where = n.file
      ? n.file.split("/").pop() + (n.label ? ":" + n.label : "")
      : "Overall";
    toast.innerHTML =
      '<span class="ic">' +
      SVG.check +
      "</span>" +
      '<span class="tx" title="' +
      esc(n.file || "about the review as a whole") +
      '">' +
      esc(where) +
      "</span>" +
      '<span class="lbl">replied</span><button class="undo">show</button>';
    toast.querySelector(".undo").onclick = () => {
      jumpToNote(n.id);
      toast.remove();
    };
    host.append(toast);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => {
      toast.classList.add("out");
      setTimeout(() => toast.remove(), 200);
    }, 6000);
  });
}

el("unread").onclick = () => {
  const next: any = [...state.notes.values()].find(
    (n: any) =>
      (state.msgs.get(n.id) || []).length > (state.seen.get(n.id) || 0),
  );
  if (next) jumpToNote(next.id);
};
/** The wait is a courtesy, not a lock: the reader can take the refresh now and lose the draft. */
el("pending").onclick = () => {
  const ta: any = activeEditor();
  if (
    ta &&
    (ta.value.trim() || ta.closest("[data-evidence],[data-sending]")) &&
    !confirm("Refresh the diff now?\n\nThe note you are writing will be lost.")
  )
    return;
  applyDiff();
};

/**
 * A note that names another note is the way to it, so the chip in its prose is followed here. Reading
 * the panel is a read of its own: a reference followed inside it stays inside it whenever the note it
 * names is listed there, and goes to the diff — closing the panel on the way — when it is not.
 */
document.addEventListener("click", (e: any) => {
  const chip =
    e.target && e.target.closest ? e.target.closest(".nref[data-nref]") : null;
  if (!chip) return;
  e.preventDefault();
  const id = chip.dataset.nref;
  if (!state.notes.has(id)) return; // it left the review between the render and the click
  const wrap: any =
    state.reader &&
    [...el("rdrbody").querySelectorAll(".rdrn")].find(
      (w: any) => w.dataset.nid === id,
    );
  if (!wrap) {
    jumpToNote(id);
    return;
  }
  markCurrentNote(id);
  setView("note", refOf(id));
  wrap.scrollIntoView({ block: "start" });
  const box = wrap.querySelector(".nbox");
  if (!box) return;
  box.classList.remove("bump");
  void box.offsetWidth; // restart the pulse when the same note is asked for twice
  box.classList.add("bump");
});

/** Brings one note on screen, opening whatever the reader had put away to get there. */
export function jumpToNote(id: string, record = true) {
  const note = state.notes.get(id);
  if (!note) return;
  const wasReader = state.reader;
  if (!closeReader(false)) return;
  if (!noteVisible(note)) {
    if (busyEditor()) return;
    state.showResolved = true;
    render();
  }
  markCurrentNote(id); // however the jump started, this is the note the pane steps on from
  const place = placeOf(note);
  if (place && place.how !== "global") {
    if (isHidden(note.file)) setHidden([note.file], false);
    if (state.folded.has(note.file)) setFolded(note.file, false);
    state.jumpUntil = performance.now() + 500;
    if (place.i >= 0) mountRowAt(place.fi, place.j);
    state.active = note.file;
    paintActive();
  }
  // The note may also be mounted in the panel, which is not where this jump is going.
  const row = [...el("diff").querySelectorAll(".nrow")].find(
    (n: any) => n.dataset.nid === id,
  );
  const target =
    row ||
    (note.file ? el("f" + idxOf(note.file)) : el("fglobal")) ||
    el("fstray");
  if (target)
    (target as any).scrollIntoView({ block: row ? "center" : "start" });
  if (row) (row as any).querySelector(".nbox")?.click();
  if (record)
    setViews({
      note: refOf(id),
      notes: null,
      ...(wasReader ? { editor: null } : {}),
    });
}

registerView(
  "note",
  {
    restore(ref) {
      if (!ref) {
        markCurrentNote("");
        return;
      }
      const note = noteByRef(ref, state.notes.values());
      if (!note) return false;
      const wrap =
        state.reader &&
        [...el("rdrbody").querySelectorAll<HTMLElement>(".rdrn")].find(
          (row) => row.dataset.nid === note.id,
        );
      if (wrap) {
        markCurrentNote(note.id);
        wrap.scrollIntoView({ block: "start" });
      } else jumpToNote(note.id);
    },
  },
  10,
);
