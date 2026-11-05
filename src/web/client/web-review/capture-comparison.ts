import {
  webReview,
  webReviewLines,
  type WebCapture,
  type WebReview,
} from "../../../shared/web-review.ts";

/** Only untouched screenshots participate: drawings are proposals, never observations. */
export type ComparisonCapture = Pick<
  WebCapture,
  "url" | "at" | "mode" | "rect" | "viewport" | "scroll" | "area"
>;
export interface ComparisonEvidence {
  capture: ComparisonCapture;
  label: string;
}
export interface CaptureComparisons {
  originals: ComparisonEvidence[];
  evidence: ComparisonEvidence[];
}
export interface ComparisonMessage {
  body: string;
  role?: string;
  at?: string;
}
export function comparisonCapture(capture: WebCapture): ComparisonCapture {
  const { url, at, mode, rect, viewport, scroll, area } = capture;
  return { url, at, mode, rect, viewport, scroll, area };
}
export function canCompareCaptures(a: ComparisonCapture, b: ComparisonCapture) {
  return !!a.area && !!b.area && a.area !== b.area && a.url === b.url;
}
export function wipeMismatch(
  a: ComparisonCapture,
  b: ComparisonCapture,
): string | null {
  if (!canCompareCaptures(a, b))
    return "Two original screenshots of the same URL are required.";
  if (
    a.viewport.width !== b.viewport.width ||
    a.viewport.height !== b.viewport.height ||
    a.viewport.dpr !== b.viewport.dpr
  )
    return "Viewport size or device pixel ratio differs. Use side by side.";
  if (
    a.mode !== b.mode ||
    a.rect.x !== b.rect.x ||
    a.rect.y !== b.rect.y ||
    a.rect.width !== b.rect.width ||
    a.rect.height !== b.rect.height ||
    a.scroll.x !== b.scroll.x ||
    a.scroll.y !== b.scroll.y
  )
    return "Selection geometry or page scroll differs. Use side by side.";
  return null;
}
export function wipeImageMismatch(
  before: { width: number; height: number },
  after: { width: number; height: number },
): string | null {
  return before.width > 0 &&
    before.height > 0 &&
    before.width === after.width &&
    before.height === after.height
    ? null
    : "Screenshot dimensions differ or an image could not load. Use side by side.";
}

/** A marker in a code example is not capture evidence. Keep prose and ownership untouched. */
export function splitWebMessage(
  body: string,
): ({ text: string } | { web: WebReview })[] {
  const lines = body.split("\n");
  const found: ({ text: string } | { web: WebReview })[] = [];
  let textStart = 0;
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const delimiter = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) fence = delimiter[1]!;
      else if (
        delimiter[1]![0] === fence[0] &&
        delimiter[1]!.length >= fence.length &&
        !delimiter[2]!.trim()
      )
        fence = "";
      continue;
    }
    if (fence) continue;
    const marker = /^<!-- lcr:web (.+) -->$/.exec(line);
    if (!marker) continue;
    try {
      const web = webReview(JSON.parse(marker[1]!));
      if (!web) continue;
      const block = webReviewLines(web);
      if (lines.slice(i, i + block.length).join("\n") !== block.join("\n")) {
        // Reply persistence trims its body; only terminal blank lines may be absent.
        while (block.at(-1) === "") block.pop();
        if (
          i + block.length !== lines.length ||
          lines.slice(i).join("\n") !== block.join("\n")
        )
          continue;
      }
      if (i > textStart)
        found.push({ text: lines.slice(textStart, i).join("\n") + "\n" });
      found.push({ web });
      i += block.length - 1;
      textStart = i + 1;
    } catch {
      /* Invalid prose markers remain ordinary Markdown. */
    }
  }
  if (textStart < lines.length)
    found.push({ text: lines.slice(textStart).join("\n") });
  return found;
}
export function conversationWeb(body: string): WebReview[] {
  return splitWebMessage(body).flatMap((part) =>
    "web" in part ? [part.web] : [],
  );
}
export function captureComparisons(
  web: WebReview,
  messages: ComparisonMessage[] = [],
): CaptureComparisons {
  const selections = (value: WebReview, label: string) =>
    [value.before, ...(value.additional ?? [])].map((capture, i) => ({
      capture: comparisonCapture(capture),
      label: label + (i ? " · selection " + (i + 1) : "") + " · " + capture.at,
    }));
  return {
    originals: selections(web, "Original"),
    evidence: [
      ...web.after.map((capture, i) => ({
        capture: comparisonCapture(capture),
        label: "Saved after " + (i + 1) + " · " + capture.at,
      })),
      ...messages.flatMap((message, i) =>
        conversationWeb(message.body).flatMap((capture) => [
          ...selections(
            capture,
            (message.role === "agent" ? "Agent" : "Reviewer") +
              " reply " +
              (i + 1),
          ),
          ...capture.after.map((after, j) => ({
            capture: comparisonCapture(after),
            label:
              "Reply " +
              (i + 1) +
              " · saved after " +
              (j + 1) +
              " · " +
              after.at,
          })),
        ]),
      ),
    ],
  };
}
