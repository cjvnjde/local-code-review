import { attachButton, wireAttach } from "./attach.ts";
import { NOTE_MAX, autogrow } from "./autogrow.ts";
import { editorAction } from "./keys.ts";
import { refButton, wireRefButton } from "../notes/ref-picker.ts";
import { saveKeyHint, state, SVG } from "../app/state.ts";
import { formatMarkdown, type MarkdownFormat } from "./markdown-edit.ts";

export const composerTools = (id: string) =>
  '<button type="button" class="format-toggle" aria-label="Formatting options" data-tooltip="Formatting options" aria-expanded="false">' +
  SVG.text +
  '</button><div class="composer-toolbar" role="toolbar" aria-label="Markdown formatting" hidden>' +
  [
    ["bold", "Bold", "<b>B</b>"],
    ["italic", "Italic", "<i>I</i>"],
    ["code", "Inline code", "&lt;/&gt;"],
    ["block", "Code block", "{ }"],
    ["link", "Insert link", "Link"],
  ]
    .map(
      ([format, label, content]) =>
        '<button type="button" data-format="' +
        format +
        '" aria-label="' +
        label +
        '" data-tooltip="' +
        label +
        '">' +
        content +
        "</button>",
    )
    .join("") +
  attachButton() +
  refButton(id) +
  "</div>";
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
  const toggle = host.querySelector<HTMLButtonElement>(".format-toggle");
  const toolbar = host.querySelector<HTMLElement>(".composer-toolbar");
  if (toggle && toolbar) {
    ta.before(toolbar);
    toggle.onclick = () => {
      toolbar.hidden = !toolbar.hidden;
      toggle.setAttribute("aria-expanded", String(!toolbar.hidden));
      fit();
    };
    toolbar
      .querySelectorAll<HTMLButtonElement>("[data-format]")
      .forEach((button) => {
        button.onmousedown = (event) => event.preventDefault();
        button.onclick = () => {
          if (ta.disabled) return;
          const written = formatMarkdown(
            ta.value,
            ta.selectionStart,
            ta.selectionEnd,
            button.dataset.format as MarkdownFormat,
          );
          ta.value = written.value;
          ta.focus();
          ta.setSelectionRange(written.from, written.to);
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        };
      });
  }
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
