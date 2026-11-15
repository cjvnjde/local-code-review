import type { WebCapture } from "./web-review.ts";

export type RedactionRect = WebCapture["rect"];
export const REDACTION_OMISSION =
  "Omitted for screenshot privacy: pre-capture redaction removes DOM, text, styles, diagnostics, page identity and full-document context. Previously saved evidence is not retroactively sanitized.";
export interface CaptureRedaction {
  regions: RedactionRect[];
  omissionReason: string;
}

/** Viewport CSS coordinates; reject rather than silently dropping invalid masks. */
export function redactionRegions(
  value: unknown,
  viewport: WebCapture["viewport"],
): RedactionRect[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Invalid redaction regions (maximum 100).");
  if (
    ![viewport.width, viewport.height, viewport.dpr].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    viewport.dpr <= 0 ||
    viewport.dpr > 16
  )
    throw new Error("Invalid redaction viewport or device pixel ratio.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new Error("Invalid redaction rectangle.");
    const { x, y, width, height } = entry;
    if (
      ![x, y, width, height].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      ) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > viewport.width ||
      y + height > viewport.height
    )
      throw new Error(
        "Redaction rectangles must be inside the captured viewport. Re-select after moving or resizing the page.",
      );
    return { x, y, width, height };
  });
}

export function privateCapture(
  capture: WebCapture,
  regions: RedactionRect[],
): WebCapture {
  if (!regions.length) return capture;
  const {
    selector: _selector,
    element: _element,
    selections: _selections,
    context: _context,
    ...safe
  } = capture;
  return {
    ...safe,
    url: new URL(capture.url).origin + "/",
    title: "Redacted page",
    components: [],
    redaction: {
      regions: regions.map((r) => ({ ...r })),
      omissionReason: REDACTION_OMISSION,
    },
  };
}
