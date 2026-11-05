import {
  webReview,
  webSelectionKey,
  type WebCapture,
} from "../../../shared/web-review.ts";
import { attachSrc } from "../components/attach.ts";
import { esc, SVG } from "../app/state.ts";
import { contextCard } from "../components/context.ts";
import {
  captureComparisons,
  type ComparisonMessage,
} from "./capture-comparison.ts";
export function webCaptureHtml(
  value: unknown,
  removable = false,
  messages: ComparisonMessage[] = [],
) {
  const web = webReview(value);
  if (!web) return "";
  const picture = (ref: string, alt: string) =>
    '<a href="' +
    esc(attachSrc(ref)) +
    '" target="_blank" rel="noreferrer noopener"><img loading="lazy" src="' +
    esc(attachSrc(ref)) +
    '" alt="' +
    esc(alt) +
    '"></a>';
  const editablePicture = (
    c: WebCapture,
    ref: string,
    alt: string,
    index: number,
    kind: "selection" | "after",
  ) =>
    removable && (!c.proposal || c.annotation)
      ? '<button type="button" class="web-picture" data-web-annotate="' +
        index +
        '" data-web-kind="' +
        kind +
        '" data-web-key="' +
        esc(webSelectionKey(c)) +
        '" aria-label="Draw on ' +
        esc(alt.toLowerCase()) +
        '"><img loading="lazy" src="' +
        esc(attachSrc(ref)) +
        '" alt="' +
        esc(alt) +
        '"><span class="web-picture-action" aria-hidden="true">' +
        SVG.edit +
        (c.annotation ? "Edit drawing" : "Draw on capture") +
        "</span></button>"
      : picture(ref, alt);
  const capture = (
    c: WebCapture,
    label: string,
    index: number,
    kind: "selection" | "after",
  ) =>
    '<section class="web-observation" aria-label="' +
    esc(label + " capture") +
    '">' +
    (web.additional?.length || web.after.length
      ? '<div class="web-image-label">' + esc(label) + "</div>"
      : "") +
    (!c.area || !c.page
      ? '<p class="web-metadata-only">Point selection · metadata only — no screenshot was captured.</p>'
      : (c.annotation || c.proposal
          ? '<div class="web-image-label web-proposal-label">Annotated proposal · reviewer intent, not captured UI. Margin is drawing space.</div>' +
            (c.annotation
              ? editablePicture(
                  c,
                  c.annotation.image,
                  label + " annotated proposal",
                  index,
                  kind,
                )
              : picture(c.proposal!, label + " annotated proposal") +
                '<p class="context-status">Drawing marks are not loaded. Inspect saved context to retrieve the original annotation data.</p>') +
            "<details><summary>Original selected area</summary>" +
            editablePicture(
              c,
              c.area,
              label + " original selected area",
              index,
              kind,
            ) +
            "</details>"
          : editablePicture(c, c.area, label + " selected area", index, kind)) +
        "<details><summary>Page screenshot</summary>" +
        picture(c.page, label + " page screenshot") +
        "</details>") +
    (c.selections
      ? '<details class="web-targets"><summary>' +
        c.selections.length +
        (c.mode === "area"
          ? " elements in area (up to 100)"
          : " selected targets") +
        "</summary><ol>" +
        c.selections
          .map(
            (target) =>
              "<li><code>" +
              esc(target.selector || target.element?.tag || c.mode) +
              "</code>" +
              (target.element?.text ? " — " + esc(target.element.text) : "") +
              (target.components.length
                ? " <span>" +
                  esc(
                    target.components
                      .map((component) => component.name)
                      .join(" → "),
                  ) +
                  "</span>"
                : "") +
              "<pre>" +
              esc(JSON.stringify(target.rect)) +
              "</pre></li>",
          )
          .join("") +
        "</ol></details>"
      : "") +
    (c.context
      ? contextCard(c.context)
      : "<details><summary>Selection metadata</summary><pre>" +
        esc(
          JSON.stringify({ ...c, page: undefined, area: undefined }, null, 2),
        ) +
        "</pre></details>") +
    (removable && kind === "selection"
      ? '<div class="web-capture-actions"><button type="button" class="danger" data-web-remove="' +
        index +
        '" data-web-key="' +
        esc(webSelectionKey(c)) +
        '" aria-label="' +
        (index === 0
          ? "Remove first selection" +
            (web.after.length ? " and its comparisons" : "")
          : "Remove selection " + (index + 1)) +
        '">Remove</button></div>'
      : "") +
    "</section>";
  return (
    '<div class="web-capture" data-web-comparisons="' +
    esc(JSON.stringify(captureComparisons(web, messages))) +
    '"><div class="web-comparison">' +
    capture(web.before, "Before", 0, "selection") +
    (web.additional ?? [])
      .map((c, i) => capture(c, "Selection " + (i + 2), i + 1, "selection"))
      .join("") +
    web.after
      .map((c, i) => capture(c, "After " + (i + 1), i, "after"))
      .join("") +
    "</div></div>"
  );
}
