import { attachButton, wireAttach } from "./attach.ts";
import { NOTE_MAX, autogrow } from "./autogrow.ts";
import { editorAction } from "./keys.ts";
import { refButton, wireRefButton } from "../notes/ref-picker.ts";
import { saveKeyHint, state } from "../app/state.ts";

export const composerTools = (id: string) => attachButton() + refButton(id);
export const composerHint = (action: "save" | "send") =>
  '<span class="spacer"></span><span class="tip">' +
  saveKeyHint() +
  " " +
  action +
  " &middot; esc cancel</span>";

/** Mount after inserting the textarea and setting its value. The caller owns commits, cancellation and busy state. */
export function wireComposer(
  host: HTMLElement,
  ta: HTMLTextAreaElement,
  id: string,
  actions: { save: () => void; cancel: () => void; focus?: boolean },
) {
  ta.classList.add("composer-input");
  const fit = autogrow(ta, NOTE_MAX);
  wireRefButton(host, ta, id);
  // The host may survive several textarea mounts; wireAttach keeps the drop binding on that host once.
  wireAttach(host, ta);
  ta.onkeydown = (e) => {
    const action = editorAction(e, state.cfg.enterSaves);
    if (action === "save") {
      e.preventDefault();
      actions.save();
    }
    if (action === "cancel") {
      e.preventDefault();
      actions.cancel();
    }
  };
  if (actions.focus !== false) ta.focus();
  return fit;
}

/** Idle, always-visible reply inputs are not active editors and must not hold live updates. */
export function activeEditor(host: ParentNode = document) {
  return [...host.querySelectorAll<HTMLTextAreaElement>(".nbox textarea")].find(
    (ta) =>
      !ta.closest(".reply") ||
      ta.hasAttribute("data-navigation-active") ||
      !!ta.value.trim() ||
      ta.closest(".reply")?.matches("[data-sending],[data-evidence]"),
  );
}
