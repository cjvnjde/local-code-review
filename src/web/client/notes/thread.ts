import {
  registerEditor,
  trackEditor,
  finishEditor,
} from "./editor-navigation.ts";
import { renderBody } from "../components/body.ts";
import {
  activeEditor,
  composerHint,
  composerTools,
  wireComposer,
} from "../components/composer.ts";
import { busyEditor, findNoteBox } from "./notes.ts";
import { save, submitNote } from "../app/persistence.ts";
import { rememberPage } from "../history/history.ts";
import { esc, markRead, msgsOf, state } from "../app/state.ts";
import { capturedLines } from "./suggest.ts";
import { webReviewLines, type WebReview } from "../../../shared/web-review.ts";
import { webCaptureHtml } from "../web-review/web-capture.ts";
import { adoptAgent } from "../app/agent.ts";
import { noteByRef, refOf } from "./note-ref.ts";

registerEditor((route) => {
  const match = /^(reply|message):([a-z0-9]+)(?::(.+))?$/.exec(route);
  if (!match) return false;
  const note = noteByRef(match[2], state.notes.values());
  if (!note?.sentAt) return false;
  const host = findNoteBox(note.id);
  if (!host) return false;
  if (match[1] === "reply") {
    const ta = host.querySelector<HTMLTextAreaElement>(".reply textarea");
    ta?.focus();
    return !!ta;
  }
  const message = [...host.querySelectorAll<HTMLElement>(".msg")].find(
    (box) => box.dataset.at === match[3],
  );
  const button = message?.querySelector<HTMLButtonElement>(".rewrite");
  button?.click();
  return !!message?.querySelector(".medit textarea");
});

/* ---------- threads ---------- */
/**
 * A note is a conversation, not a one-way message. The reviewer opens it, the agent answers in the
 * review file as it works, and the reviewer can answer back. The file is the only writer of a thread:
 * a reply is posted to the server, which appends it there, and the page takes the thread back from
 * the file. Nothing on this side ever invents, rewrites, or removes a message.
 *
 * The reviewer's own messages stay the reviewer's: one can be reworded or taken back where it
 * stands, exactly as the note above it can. The agent's are read-only here, because they are its
 * account of what it did. A message is named by the stamp in its marker, so one written without a
 * stamp — an agent's, or a `**Reviewer**` line put in the file by hand — is shown and left alone.
 */

/** Clock time for a message written today, and the date as well for an older one. */
function when(at: string) {
  const t = Date.parse(at || "");
  if (!t) return "";
  const d = new Date(t),
    now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

/**
 * Draws the thread under a note's own text. `from` is how many messages the reviewer has already
 * read, so the ones that arrived while the page was open can announce themselves. `done` is how a
 * message that has just been reworded or withdrawn gets the note drawn again wherever it is mounted.
 */
export function renderThread(host: any, note: any, done: () => void) {
  const msgs = msgsOf(note),
    read = state.seen.get(note.id) || 0;
  // Either side may propose a replacement, and both propose it for the lines the note is about.
  const base = capturedLines(note.code);
  host.textContent = "";
  msgs.forEach((m: any, k: number) => {
    const agent = m.role === "agent";
    const mine =
      !agent &&
      !!m.at &&
      !msgs.slice(k + 1).some((next: any) => next.role === "agent");
    const box = document.createElement("div");
    box.className = "msg " + (agent ? "a" : "r") + (k >= read ? " fresh" : "");
    box.dataset.at = m.at || "";
    const head = document.createElement("div");
    head.className = "who";
    // Every message names its speaker, and the agent's carries a badge as well: in a thread that
    // reads back as one conversation, whose words these are is the thing that must not be guessed at.
    head.innerHTML =
      (agent ? '<span class="bot">AI</span>' : "") +
      "<b>" +
      (agent ? "Agent" : "You") +
      "</b>" +
      (k >= read ? '<span class="newtag">new</span>' : "") +
      (m.at ? '<span class="when">' + esc(when(m.at)) + "</span>" : "") +
      (mine
        ? '<button class="rewrite" title="Reword this reply where it stands">Edit</button>' +
          '<button class="danger drop" title="Take this reply back out of the review file">Delete</button>'
        : "");
    const body = document.createElement("div");
    body.className = "mb";
    renderBody(body, m.body, note.file, base);
    box.append(head, body);
    host.append(box);
    if (!mine) return;
    head.querySelector(".rewrite").onclick = () =>
      editMessage(box, note, m, done);
    head.querySelector(".drop").onclick = () => dropMessage(note, m, done);
  });
}

/**
 * Rewrites one of your own messages in the box it is shown in. What is posted is the new wording;
 * the thread comes back from the review file, so the page never edits a message into itself.
 */
function editMessage(box: any, note: any, m: any, done: () => void) {
  if (busyEditor()) return;
  const body = box.querySelector(".mb");
  const form: any = document.createElement("div");
  form.className = "medit";
  form.innerHTML =
    "<textarea></textarea>" +
    '<div class="acts">' +
    composerTools(note.id) +
    '<button class="cancel">Cancel</button>' +
    composerHint("save") +
    '<button class="primary">Save reply</button></div>';
  const ta: any = form.querySelector("textarea");
  ta.value = m.body || "";
  ta.dataset.was = m.body || ""; // what says the box is untouched and may step aside for the next one
  body.replaceWith(form);
  wireComposer(form, ta, note.id, {
    save: () => commit(),
    cancel: () => shut(),
  });
  const shut = (replace = false) => {
    form.replaceWith(body);
    finishEditor(ta, replace);
  };
  form.__shut = () => shut(true);
  let sending = false;
  const commit = async () => {
    if (sending) return;
    const text = ta.value.trim();
    // Emptying a message is withdrawing it, exactly as emptying a note deletes the note.
    if (!text) {
      shut();
      dropMessage(note, m, done);
      return;
    }
    if (text === (m.body || "").trim()) {
      shut();
      return;
    }
    sending = true;
    const button: any = form.querySelector(".primary");
    button.disabled = true;
    button.textContent = "Saving…";
    const ok = await tell(
      note.id,
      "/api/reply",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: note.id, at: m.at, body: text }),
      },
      "save the reply",
    );
    if (!ok) {
      sending = false;
      button.disabled = false;
      button.textContent = "Save reply";
      return;
    }
    // The editor comes down first: a note is refused a repaint while one of its boxes is being
    // typed into, so a box still standing here would refuse the redraw meant to replace it.
    shut();
    done();
  };
  form.querySelector(".primary").onclick = commit;
  form.querySelector(".cancel").onclick = () => shut();
  trackEditor(
    `message:${refOf(note.id)}:${m.at}`,
    ta,
    () => shut(),
    () => sending,
  );
}

/**
 * Takes one of your own messages back out of the thread. It is in the file the agent is reading and
 * may already have been answered, so it asks first, exactly as deleting a handed-over note does.
 */
async function dropMessage(note: any, m: any, done: () => void) {
  if (
    !confirm(
      "Delete this reply?\n\nIt goes out of " +
        (state.sessionFile || "the review file") +
        ", where the agent reads it.",
    )
  )
    return;
  const query =
    "id=" + encodeURIComponent(note.id) + "&at=" + encodeURIComponent(m.at);
  if (
    !(await tell(
      note.id,
      "/api/reply?" + query,
      { method: "DELETE" },
      "delete the reply",
    ))
  )
    return;
  done();
}

/**
 * The same for a message opened for rewriting: one still holding exactly what it was opened with has
 * said nothing yet, so it steps aside rather than keeping the floor. A box is drawn from the note it
 * belongs to, so it is enough to take it down — the message under it is unchanged and comes back
 * with the next draw.
 */
export function dropCleanEdit() {
  const ta: any = document.querySelector(".medit textarea");
  if (!ta || ta.value !== ta.dataset.was) return;
  const form: any = ta.closest(".medit");
  form.__shut?.();
}

/** New observations belong to the next message, never to the submitted note above it. */
export function setReplyEvidence(
  box: HTMLElement,
  web: WebReview | null,
  draftId?: string,
) {
  const reply: any = box.querySelector(".reply");
  if (!reply) return;
  reply.__web = web;
  reply.dataset.draftId = draftId || "";
  reply.toggleAttribute("data-evidence", !!web);
  let preview = box.querySelector<HTMLElement>("[data-reply-evidence]");
  if (!preview) {
    preview = document.createElement("div");
    preview.dataset.replyEvidence = "";
    const scroll = box.querySelector(".ui-note-scroll");
    if (scroll) scroll.append(preview);
    else reply.prepend(preview);
  }
  preview.innerHTML = webCaptureHtml(web, true);
  reply.dispatchEvent(new Event("input", { bubbles: true }));
}

export function appendReplyText(box: HTMLElement, body: string) {
  const ta = box.querySelector<HTMLTextAreaElement>(".reply textarea");
  if (!ta) return;
  ta.value = [ta.value.trimEnd(), body].filter(Boolean).join("\n\n");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
}
/** Mounts the reply affordance for a note that the agent can actually see: one that was handed over. */
export function mountReply(host: any, note: any, done: () => void) {
  host.textContent = "";
  if (!note.sentAt) {
    const hint = document.createElement("div");
    hint.className = "rhint";
    hint.textContent = "Save the review to start a thread on this note.";
    host.append(hint);
    return;
  }
  const placeholder = document.createElement("div");
  host.append(placeholder);
  startReply(placeholder, note.id, done);
}

function startReply(wrap: any, id: string, done: () => void) {
  const box: any = document.createElement("div");
  box.className = "reply";
  box.__done = done;
  box.innerHTML =
    '<textarea aria-label="Reply to the agent" placeholder="Reply to the agent"></textarea>' +
    '<div class="acts">' +
    composerTools(id) +
    composerHint("save") +
    "<button data-reply-save>Save reply</button>" +
    '<button class="primary" data-ask-note' +
    (state.agent ? "" : " hidden") +
    ">Save &amp; ask AI</button></div>";
  const ta: any = box.querySelector("textarea");
  ta.dataset.nid = id;
  wrap.replaceWith(box);
  wireComposer(box, ta, id, {
    save: () => send(false),
    cancel: () => shut(),
    focus: false,
  });
  const shut = () => {
    ta.value = "";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.removeAttribute("data-navigation-active");
    ta.blur();
    finishEditor(ta);
  };
  const activate = () => {
    const other = activeEditor();
    if (other && other !== ta && busyEditor()) return;
    ta.setAttribute("data-navigation-active", "");
    trackEditor(
      "reply:" + refOf(id),
      ta,
      shut,
      () => sending || !!box.closest("[data-web-busy]"),
    );
  };
  ta.addEventListener("focus", activate);
  // The button disables itself, but enter still reaches the textarea mid-flight: one send at a time,
  // or a quick double enter would append the same message to the review file twice.
  let sending = false;
  const send = async (ask = false) => {
    if (sending || box.closest(".nbox")?.hasAttribute("data-web-busy")) return;
    const body = [
      ta.value.trim(),
      box.__web ? webReviewLines(box.__web).slice(2).join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!body) {
      if (!ask) return;
      const note = state.notes.get(id);
      if (!note) return;
      sending = true;
      box.dataset.sending = "";
      try {
        const data = await submitNote(note, true, true);
        state.noteDelivery.set(id, data?.delivery || { state: "saved" });
      } catch (error) {
        alert(
          "Could not ask the agent: " +
            (error instanceof Error ? error.message : String(error)),
        );
      } finally {
        sending = false;
        delete box.dataset.sending;
        done();
      }
      return;
    }
    sending = true;
    box.dataset.sending = "";
    ta.disabled = true;
    const buttons = [...box.querySelectorAll("button")];
    buttons.forEach((button: any) => (button.disabled = true));
    const ok = await tell(
      id,
      "/api/reply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, body, ask }),
      },
      "send the reply",
    );
    if (!ok) {
      sending = false;
      delete box.dataset.sending;
      ta.disabled = false;
      buttons.forEach((button: any) => (button.disabled = false));
      return;
    }
    // Keep the capture gesture blocked until the consumed draft is gone.
    const draftId = box.dataset.draftId;
    if (draftId) {
      await fetch("/api/web/draft", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId }),
      }).catch(() => {});
    }
    sending = false;
    delete box.dataset.sending;
    ta.disabled = false;
    buttons.forEach((button: any) => (button.disabled = false));
    setReplyEvidence(box.closest(".nbox"), null);
    shut();
    done();
    document.dispatchEvent(new CustomEvent("lcr:reply-sent", { detail: id }));
  };
  box.querySelector("[data-reply-save]").onclick = () => send(false);
  box.querySelector("[data-ask-note]").onclick = () => send(true);
}

/**
 * Hands a change to a thread to the server, which writes it into the review file the agent is
 * reading, and takes the thread back from what the file then holds. Sending, rewording, and
 * withdrawing all go this way, because all three are the same thing: the file said something else,
 * and the page reads it again rather than guessing what it now says.
 */
async function tell(id: string, url: string, init: any, what: string) {
  try {
    const response = await fetch(url, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.status);
    setThread(id, data.note && data.note.messages);
    adoptAgent(data);
    const note = state.notes.get(id);
    if (note) markRead(note); // your own message is not news to you
    save();
    if (data.delivery?.state === "failed") {
      alert(
        "Your reply was saved, but could not reach " +
          (state.agent || "the agent") +
          ": " +
          (data.delivery.error || "Check the agent session.") +
          "\n\nRetry from this note once the agent is ready.",
      );
    }
    return true;
  } catch (error) {
    alert(
      "Could not " +
        what +
        ": " +
        (error instanceof Error ? error.message : String(error)),
    );
    return false;
  }
}

/** Replaces one note's thread with what the review file now holds. */
export function setThread(id: string, messages: any) {
  state.msgs.set(id, Array.isArray(messages) ? messages : []);
  rememberPage();
}
