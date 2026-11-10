import { attachSrc } from "./attach.ts";
import { registerView, setView } from "../navigation/ui-navigation.ts";

let current: {
  ref: string;
  close: (record?: boolean, focus?: boolean) => void;
} | null = null;

/** Drawing replaces the preview in the same history entry, without a pending Back traversal. */
export function closeImagePreviewForDrawing() {
  if (!current) return false;
  current.close(false, false);
  return true;
}
registerView(
  "image",
  {
    restore(ref) {
      if (current?.ref === ref) return;
      current?.close();
      if (ref) return openImagePreview(ref);
    },
  },
  25,
);

/** A shared, local-only viewer. Drawing is offered by the composer that owns the image. */
export function openImagePreview(
  ref: string,
  label = "Attached image",
  draw?: () => void,
): boolean {
  const src = attachSrc(ref);
  if (!src) return false;
  current?.close();
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const dialog = document.createElement("dialog");
  dialog.className = "image-viewer";
  dialog.setAttribute("aria-label", label);
  const tools = document.createElement("div");
  tools.className = "image-viewer-tools";
  const title = document.createElement("strong");
  title.textContent = label;
  tools.append(title);
  const command = (label: string, action: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = action;
    tools.append(button);
    return button;
  };
  const viewport = document.createElement("div");
  viewport.className = "image-viewer-viewport";
  const image = document.createElement("img");
  image.alt = label;
  image.src = src;
  viewport.append(image);
  let zoom = 0;
  const resize = () => {
    image.style.width = zoom ? image.naturalWidth * zoom + "px" : "";
    image.classList.toggle("actual", !!zoom);
  };
  command("−", () => {
    zoom = Math.max(
      0.1,
      (zoom || Math.min(1, image.clientWidth / image.naturalWidth)) / 1.25,
    );
    resize();
  });
  command("+", () => {
    zoom = Math.min(
      8,
      (zoom || Math.min(1, image.clientWidth / image.naturalWidth)) * 1.25,
    );
    resize();
  });
  command("Fit", () => {
    zoom = 0;
    resize();
  });
  command("100%", () => {
    zoom = 1;
    resize();
  });
  let restoreFocus = true;
  const close = (record = false, focus = true) => {
    restoreFocus = focus;
    dialog.close();
    if (record) setView("image", null, { close: true });
  };
  if (draw) command("Draw / edit", draw);
  const link = document.createElement("a");
  link.href = src;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = "Open image";
  tools.append(link);
  command("Close", () => close(true));
  const message = document.createElement("p");
  message.className = "image-viewer-error";
  message.hidden = true;
  image.onerror = () => {
    message.hidden = false;
    message.textContent =
      "Could not load this image. Close and reopen to retry.";
  };
  dialog.append(tools, message, viewport);
  const onKey = (event: KeyboardEvent) => {
    // Keep review navigation shortcuts from moving the page behind the modal.
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };
  window.addEventListener("keydown", onKey, true);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(true);
  });
  dialog.addEventListener(
    "close",
    () => {
      if (current?.close === close) current = null;
      window.removeEventListener("keydown", onKey, true);
      dialog.remove();
      if (restoreFocus && previous?.isConnected)
        previous.focus({ preventScroll: true });
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  current = { ref, close };
  setView("image", ref);
  return true;
}

/** Delegated once: note repaints and both review modes receive the same viewer. */
export function watchImagePreviews() {
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[data-image-preview]",
    );
    if (
      link &&
      openImagePreview(
        link.dataset.imagePreview!,
        link.querySelector("img")?.alt,
      )
    )
      event.preventDefault();
  });
}
