import {
  findColors,
  parseColor,
  replaceColor,
  type ColorLiteral,
} from "./color-literals.ts";
import { copyText } from "./clipboard.ts";

// Match the drawing editor's small starter palette without importing its canvas/editor lifecycle.
const DEFAULTS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#111111",
  "#ffffff",
];
const STORAGE_KEY = "lcr:message-colors";
let savedColors: string[] = [];
let lastEditor: HTMLTextAreaElement | null = null;
let dismissPicker: (() => void) | null = null;

function paletteColors() {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]",
    );
    if (Array.isArray(stored))
      savedColors = [
        ...new Set([
          ...stored
            .slice(-24)
            .filter((v): v is string => typeof v === "string")
            .map(parseColor)
            .filter((v): v is string => v !== null),
          ...savedColors,
        ]),
      ].slice(-24);
  } catch {}
  return [...new Set([...DEFAULTS, ...savedColors])];
}

function swatch(value: string, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "color-swatch";
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.style.setProperty("--message-color", parseColor(value)!);
  return button;
}

function editable(ta: HTMLTextAreaElement | null): ta is HTMLTextAreaElement {
  return (
    !!ta?.isConnected &&
    !ta.disabled &&
    !ta.readOnly &&
    !ta.hasAttribute("data-context-busy")
  );
}

type ColorWrite = (value: string) => boolean;
function openPicker(
  trigger: HTMLElement,
  initial: string,
  write?: ColorWrite,
  reply?: HTMLTextAreaElement | null,
  editor?: HTMLTextAreaElement,
) {
  dismissPicker?.();
  const dialog = document.createElement("dialog");
  let returnFocus = trigger;
  let closed = false;
  function closePicker() {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    if (dismissPicker === closePicker) dismissPicker = null;
    if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  dismissPicker = closePicker;
  dialog.className = "message-color-picker";
  dialog.setAttribute(
    "aria-label",
    write ? "Edit message color" : "Inspect message color",
  );
  dialog.innerHTML = `<form method="dialog">
    <div class="message-color-heading"><strong>${write ? "Message color" : "Inspect color"}</strong><button type="button" data-color-action="close" aria-label="Close color picker" data-tooltip="Close color picker">×</button></div>
    <p class="message-color-original"></p>
    <div class="message-color-controls"><span class="message-color-preview" aria-hidden="true"></span><label>Choose color<input type="color" aria-label="Choose color"></label></div>
    <label>CSS color / hex<input type="text" class="message-color-value" spellcheck="false" autocomplete="off" aria-label="CSS color or hex value"></label>
    <label>Opacity<input type="range" min="0" max="255" step="1" aria-label="Color opacity"><output></output></label>
    <div class="message-color-palette" role="group" aria-label="Saved colors"></div>
    <p class="message-color-status" role="status" aria-live="polite"></p>
    <div class="message-color-actions"><button type="button" data-color-action="save">Save color</button><button type="button" data-color-action="copy">Copy color</button>${reply ? '<button type="button" data-color-action="reply">Use in reply</button>' : ""}<span></span><button type="button" data-color-action="cancel">Cancel</button>${write ? '<button type="button" data-color-action="apply" class="primary">Apply color</button>' : ""}</div>
  </form>`;
  const value = dialog.querySelector<HTMLInputElement>(".message-color-value")!;
  const native = dialog.querySelector<HTMLInputElement>('input[type="color"]')!;
  const alpha = dialog.querySelector<HTMLInputElement>('input[type="range"]')!;
  const output = dialog.querySelector("output")!;
  const preview = dialog.querySelector<HTMLElement>(".message-color-preview")!;
  const palette = dialog.querySelector<HTMLElement>(".message-color-palette")!;
  const status = dialog.querySelector<HTMLElement>(".message-color-status")!;
  const original = dialog.querySelector<HTMLElement>(
    ".message-color-original",
  )!;
  original.textContent = "Original: " + initial;
  value.value = initial;
  const replySnapshot = reply?.value;
  const replyAt = reply?.selectionStart ?? 0;
  let canonical = parseColor(initial)!;
  function sync() {
    const parsed = parseColor(value.value.trim());
    value.setCustomValidity(
      parsed ? "" : "Enter a hex, rgb(), rgba(), hsl(), or hsla() color.",
    );
    value.setAttribute("aria-invalid", String(!parsed));
    dialog
      .querySelectorAll<HTMLButtonElement>(
        '[data-color-action="save"],[data-color-action="copy"],[data-color-action="apply"],[data-color-action="reply"]',
      )
      .forEach((button) => (button.disabled = !parsed));
    if (!parsed) {
      status.textContent = "Enter a valid CSS color literal.";
      return;
    }
    canonical = parsed;
    status.textContent = "";
    native.value = parsed.slice(0, 7);
    alpha.value = String(
      parsed.length === 9 ? parseInt(parsed.slice(7), 16) : 255,
    );
    output.textContent = Math.round((Number(alpha.value) / 255) * 100) + "%";
    preview.style.setProperty("--message-color", parsed);
    palette
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.color === parsed),
        ),
      );
  }
  function renderPalette() {
    palette.replaceChildren();
    for (const color of paletteColors()) {
      const button = swatch(color, "Use saved color " + color);
      button.dataset.color = color;
      button.setAttribute("aria-pressed", String(color === canonical));
      button.onclick = () => {
        value.value = color;
        sync();
      };
      palette.append(button);
    }
  }
  value.addEventListener("input", sync);
  native.addEventListener("input", () => {
    // Native color inputs are opaque. Retain the explicit alpha when only RGB changes.
    value.value =
      native.value + (canonical.length === 9 ? canonical.slice(7) : "");
    sync();
  });
  alpha.addEventListener("input", () => {
    value.value =
      native.value + Number(alpha.value).toString(16).padStart(2, "0");
    sync();
  });
  dialog.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-color-action]",
    );
    if (!button || button.disabled) return;
    const action = button.dataset.colorAction;
    if (action === "close" || action === "cancel") closePicker();
    else if (action === "copy") void copyText(button, value.value.trim());
    else if (action === "save") {
      savedColors = [
        ...new Set([
          ...paletteColors().filter(
            (color) => !DEFAULTS.includes(color) && color !== canonical,
          ),
          canonical,
        ]),
      ].slice(-24);
      let persisted = true;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedColors));
      } catch {
        persisted = false;
      }
      renderPalette();
      status.textContent = persisted
        ? "Color saved."
        : "Color saved for this session; browser storage is unavailable.";
    } else if (action === "apply" && write) {
      if (write(value.value.trim())) {
        returnFocus = editor ?? trigger;
        closePicker();
      } else
        status.textContent =
          "The draft changed or is no longer editable. Close the picker and try again.";
    } else if (action === "reply" && reply) {
      if (editable(reply) && reply.value === replySnapshot) {
        const written = replaceColor(
          reply.value,
          { from: replyAt, to: replyAt, value: "" },
          value.value.trim(),
        )!;
        reply.value = written.value;
        reply.focus();
        reply.setSelectionRange(written.from, written.to);
        reply.dispatchEvent(new Event("input", { bubbles: true }));
        returnFocus = reply;
        closePicker();
      } else
        status.textContent =
          "The reply changed or is no longer editable. Close the picker and try again.";
    }
  });
  // Enter must not submit the surrounding note or dismiss an unapplied edit.
  dialog
    .querySelector("form")!
    .addEventListener("submit", (event) => event.preventDefault());
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
    }
  });
  dialog.addEventListener("close", closePicker, { once: true });
  // A modal top-layer dialog stays inside the current document, including the embedded review iframe.
  document.body.append(dialog);
  renderPalette();
  sync();
  dialog.showModal();
  value.focus();
  value.select();
}

/** Add controls without rewriting text, highlighted spans, Markdown, or copyable code content. */
export function decorateColors(host: HTMLElement) {
  let nodes: Text[] = [];
  function flush() {
    const current = nodes;
    nodes = [];
    if (!current.length) return;
    const source = current.map((node) => node.data).join("");
    const colors = findColors(source);
    for (let k = colors.length - 1; k >= 0; k--) {
      const color = colors[k]!;
      let offset = 0;
      for (const node of current) {
        const end = offset + node.length;
        if (color.to <= end) {
          const split = color.to - offset;
          const next =
            split === node.length ? node.nextSibling : node.splitText(split);
          if (!(
            next instanceof Element && next.classList.contains("color-swatch")
          )) {
            const button = swatch(color.hex, "Inspect color " + color.value);
            button.onclick = (event) => {
              event.preventDefault();
              event.stopPropagation();
              const localReply =
                button
                  .closest(".nbox")
                  ?.querySelector<HTMLTextAreaElement>(".reply textarea") ??
                null;
              const reply =
                editable(lastEditor) && lastEditor.closest(".reply")
                  ? lastEditor
                  : editable(localReply)
                    ? localReply
                    : null;
              openPicker(button, color.value, undefined, reply);
            };
            node.parentNode!.insertBefore(button, next);
          }
          break;
        }
        offset = end;
      }
    }
  }
  function walk(parent: Node) {
    for (const child of [...parent.childNodes]) {
      if (child instanceof Text) nodes.push(child);
      else if (child instanceof HTMLElement) {
        // References, links, attachments and context cards keep their existing click behavior.
        if (child.matches("a,button,input,textarea,select,.context-card,.cm")) {
          flush();
          continue;
        }
        const boundary = child.matches(
          "p,pre,li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,td,th,div,br",
        );
        if (boundary) flush();
        walk(child);
        if (boundary) flush();
      }
    }
  }
  walk(host);
  flush();
}

/** Composer edits stay in the textarea and use the ordinary input/save lifecycle. */
export function wireColorComposer(host: HTMLElement, ta: HTMLTextAreaElement) {
  const add = host.querySelector<HTMLButtonElement>(".color-insert");
  if (!add) return;
  const list = document.createElement("div");
  list.className = "composer-colors";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Colors in this draft");
  ta.after(list);
  const remember = () => {
    lastEditor = ta;
  };
  ta.addEventListener("focus", remember);
  function choose(target?: ColorLiteral) {
    if (!editable(ta)) return;
    const snapshot = ta.value;
    const range = target ?? {
      from: ta.selectionStart,
      to: ta.selectionStart,
      value: "",
    };
    openPicker(
      target
        ? list.querySelector<HTMLButtonElement>(
            `[data-color-from="${target.from}"]`,
          )!
        : add!,
      target?.value ?? "#3b82f6",
      (value) => {
        if (!editable(ta) || ta.value !== snapshot) return false;
        const written = replaceColor(ta.value, range, value);
        if (!written) return false;
        ta.value = written.value;
        ta.focus();
        ta.setSelectionRange(written.from, written.to);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      undefined,
      ta,
    );
  }
  function selection() {
    list.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(
          ta.selectionStart >= Number(button.dataset.colorFrom) &&
            ta.selectionEnd <= Number(button.dataset.colorTo),
        ),
      );
    });
  }
  function render() {
    list.replaceChildren();
    const colors = findColors(ta.value);
    list.hidden = colors.length === 0;
    for (const color of colors) {
      const button = swatch(color.hex, "Edit color " + color.value);
      button.classList.add("composer-color");
      button.textContent = color.value;
      button.dataset.colorFrom = String(color.from);
      button.dataset.colorTo = String(color.to);
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => choose(color);
      list.append(button);
    }
    selection();
  }
  add.onmousedown = (event) => event.preventDefault();
  add.onclick = () => {
    const selected = findColors(ta.value).find(
      (color) => ta.selectionStart >= color.from && ta.selectionEnd <= color.to,
    );
    choose(selected);
  };
  ta.addEventListener("input", render);
  ta.addEventListener("select", selection);
  ta.addEventListener("keyup", selection);
  ta.addEventListener("pointerup", selection);
  render();
}
