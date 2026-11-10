import {
  decodeImageDrawing,
  type ImageDrawing,
} from "../../../shared/image-drawing.ts";
import { attachSrc, imageTokens } from "./attach.ts";
import { openAnnotation } from "./annotation-editor.ts";
import { openImagePreview } from "./image-preview.ts";

let restoring = false;
const drawings = new Map<string, ImageDrawing | null>();

/** Image controls follow the Markdown, so deleting a link also removes its card. */
export function wireImageEditor(
  host: HTMLElement,
  ta: HTMLTextAreaElement,
  id: string,
) {
  const cards = document.createElement("div");
  cards.className = "composer-images";
  cards.setAttribute("aria-label", "Attached images");
  ta.after(cards);
  const context =
    id +
    ":" +
    (ta.closest(".msg")?.getAttribute("data-at") ||
      (ta.closest(".reply") ? "reply" : "note"));
  ta.dataset.imageEditor = context;
  let signature = "";
  const refresh = () => {
    const images = imageTokens(ta.value);
    const next = JSON.stringify(images);
    if (next === signature) return;
    signature = next;
    cards.replaceChildren();
    cards.hidden = !images.length;
    images.forEach((shot, index) => {
      const card = document.createElement("div");
      card.className = "composer-image";
      const img = document.createElement("img");
      img.src = attachSrc(shot.ref);
      img.alt = shot.label;
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "composer-image-preview";
      preview.setAttribute("aria-label", "Preview " + shot.label);
      preview.append(img);
      const draw = document.createElement("button");
      draw.type = "button";
      draw.textContent = "Draw / edit";
      const route = "image:" + JSON.stringify([context, index]);
      draw.dataset.imageDraw = route;
      const error = document.createElement("span");
      error.setAttribute("role", "alert");
      const edit = async () => {
        if (ta.disabled || ta.hasAttribute("data-image-busy")) return;
        ta.dataset.imageBusy = "";
        draw.disabled = true;
        error.textContent = "";
        try {
          if (!drawings.has(shot.ref)) {
            const response = await fetch(attachSrc(shot.ref));
            if (!response.ok)
              throw new Error(
                "Could not load this image. Try again when the server is available.",
              );
            drawings.set(
              shot.ref,
              decodeImageDrawing(
                new Uint8Array(await response.arrayBuffer()),
                shot.ref,
              ),
            );
          }
          const data = drawings.get(shot.ref);
          if (!ta.isConnected) return;
          await openAnnotation(
            route,
            {
              image: data?.source ?? shot.ref,
              annotation: data?.annotation,
            },
            async (annotation) => {
              if (
                !ta.isConnected ||
                ta.value.slice(shot.from, shot.to) !== shot.token
              )
                throw new Error(
                  "This image link changed while the drawing was open. Close and reopen the drawing.",
                );
              const ref = annotation?.image ?? data?.source ?? shot.ref;
              // Replace only the URL; wording, other images and surrounding Markdown stay intact.
              const token =
                shot.token.slice(0, shot.refFrom) +
                ref +
                shot.token.slice(shot.refFrom + shot.ref.length);
              const start = ta.selectionStart,
                end = ta.selectionEnd,
                direction = ta.selectionDirection;
              ta.value =
                ta.value.slice(0, shot.from) + token + ta.value.slice(shot.to);
              const delta = token.length - shot.token.length;
              const shifted = (at: number) =>
                at <= shot.from
                  ? at
                  : at >= shot.to
                    ? at + delta
                    : shot.from + token.length;
              ta.setSelectionRange(shifted(start), shifted(end), direction);
              ta.dispatchEvent(new Event("input", { bubbles: true }));
            },
          );
          if (ta.isConnected) ta.focus({ preventScroll: true });
        } catch (reason) {
          error.textContent =
            reason instanceof Error ? reason.message : String(reason);
        } finally {
          delete ta.dataset.imageBusy;
          draw.disabled = false;
        }
      };
      draw.onclick = () => void edit();
      preview.onclick = () =>
        openImagePreview(shot.ref, shot.label, () => void edit());
      card.append(preview, draw, error);
      cards.append(card);
    });
  };
  ta.addEventListener("input", refresh);
  refresh();
  if (!restoring) {
    restoring = true;
    document.addEventListener("lcr:annotation-restore", (event) => {
      const route = (event as CustomEvent).detail?.route;
      if (typeof route !== "string" || !route.startsWith("image:")) return;
      [...document.querySelectorAll<HTMLButtonElement>("[data-image-draw]")]
        .find((button) => button.dataset.imageDraw === route)
        ?.click();
    });
  }
}
