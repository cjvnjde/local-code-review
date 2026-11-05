import { webAnnotation, type WebAnnotation } from "./web-annotation.ts";
import { contextLink, contextRef, type ContextRef } from "./context.ts";

/** Evidence is immutable; another capture adds an observation rather than replacing the before. */
export interface WebCapture {
  url: string;
  title: string;
  at: string;
  mode: "element" | "block" | "area" | "point";
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number; dpr: number };
  scroll: { x: number; y: number };
  /** Point selections carry metadata only; other modes retain both screenshots. */
  page?: string;
  area?: string;
  annotation?: WebAnnotation;
  /** Immutable optional evidence; persisted captures keep only their compact subject. */
  context?: ContextRef;
  /** Annotated PNG retained when editable drawing geometry lives in the context bundle. */
  proposal?: string;
  selector?: string;
  element?: {
    tag: string;
    text: string;
    attributes: Record<string, string>;
    styles: Record<string, string>;
  };
  components: {
    framework: "React" | "Vue";
    name: string;
    file?: string;
    line?: number;
  }[];
  selections?: {
    rect: WebCapture["rect"];
    selector?: string;
    element?: WebCapture["element"];
    components: WebCapture["components"];
  }[];
}
export interface WebReview {
  before: WebCapture;
  after: WebCapture[];
  additional?: WebCapture[];
}
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const ref = (v: unknown): v is string =>
  typeof v === "string" && /^images\/[a-z0-9][a-z0-9._-]*\.png$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function localWebUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("--web requires a localhost HTTP(S) URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(
      "--web requires a localhost HTTP(S) URL without credentials.",
    );
  return url.href;
}
export function webCapture(value: unknown): WebCapture | null {
  if (
    !record(value) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at)) ||
    typeof value.mode !== "string" ||
    !["element", "block", "area", "point"].includes(value.mode)
  )
    return null;
  try {
    localWebUrl(value.url);
  } catch {
    return null;
  }
  const r = value.rect,
    v = value.viewport,
    s = value.scroll;
  if (
    !record(v) ||
    !record(s) ||
    !finite(v.width) ||
    !finite(v.height) ||
    !finite(v.dpr) ||
    !finite(s.x) ||
    !finite(s.y) ||
    v.width <= 0 ||
    v.height <= 0 ||
    v.dpr <= 0
  )
    return null;
  const hasImages = ref(value.page) && ref(value.area);
  if (
    !hasImages &&
    (value.mode !== "point" ||
      value.page !== undefined ||
      value.area !== undefined)
  )
    return null;
  const width = v.width,
    height = v.height;
  const rect = (r: unknown): r is WebCapture["rect"] =>
    record(r) &&
    finite(r.x) &&
    finite(r.y) &&
    finite(r.width) &&
    finite(r.height) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= width + 1 &&
    r.y + r.height <= height + 1;
  const strings = (value: unknown): value is Record<string, string> =>
    record(value) &&
    Object.entries(value).length <= 50 &&
    Object.values(value).every(
      (x) => typeof x === "string" && x.length <= 4000,
    );
  const metadata = (
    target: unknown,
  ): target is Pick<WebCapture, "selector" | "element" | "components"> => {
    if (!record(target)) return false;
    const element = target.element;
    if (
      element != null &&
      (!record(element) ||
        typeof element.tag !== "string" ||
        typeof element.text !== "string" ||
        !strings(element.attributes) ||
        !strings(element.styles))
    )
      return false;
    if (target.selector != null && typeof target.selector !== "string")
      return false;
    return (
      Array.isArray(target.components) &&
      target.components.length <= 30 &&
      Array.from(target.components).every(
        (c: unknown) =>
          record(c) &&
          typeof c.framework === "string" &&
          ["React", "Vue"].includes(c.framework) &&
          typeof c.name === "string" &&
          (c.file == null || typeof c.file === "string") &&
          (c.line == null ||
            (typeof c.line === "number" &&
              Number.isSafeInteger(c.line) &&
              c.line >= 0)),
      )
    );
  };
  if (!rect(r) || !metadata(value)) return null;
  const annotation =
    value.annotation === undefined
      ? undefined
      : webAnnotation(value.annotation);
  if (annotation === null || (annotation && !hasImages)) return null;
  const context =
    value.context === undefined ? undefined : contextRef(value.context);
  if (
    context === null ||
    (value.proposal !== undefined &&
      (!hasImages || !context || !ref(value.proposal)))
  )
    return null;
  const cleanMetadata = (
    target: Pick<WebCapture, "selector" | "element" | "components">,
  ) => ({
    ...(target.selector ? { selector: target.selector } : {}),
    ...(target.element
      ? {
          element: {
            tag: target.element.tag,
            text: target.element.text,
            attributes: target.element.attributes,
            styles: target.element.styles,
          },
        }
      : {}),
    components: target.components.map((c) => ({
      framework: c.framework,
      name: c.name,
      ...(c.file ? { file: c.file } : {}),
      ...(c.line != null ? { line: c.line } : {}),
    })),
  });
  const selections: NonNullable<WebCapture["selections"]> = [];
  if (value.selections !== undefined) {
    if (
      !Array.isArray(value.selections) ||
      value.selections.length < 1 ||
      value.selections.length > 100
    )
      return null;
    for (const selection of value.selections) {
      if (!record(selection) || !metadata(selection) || !rect(selection.rect))
        return null;
      const r = selection.rect;
      selections.push({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        ...cleanMetadata(selection),
      });
    }
  }
  // Detach and whitelist, including nested records, before asynchronous storage or rendering.
  return JSON.parse(
    JSON.stringify({
      url: value.url,
      title: value.title,
      at: value.at,
      mode: value.mode,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: v.width, height: v.height, dpr: v.dpr },
      scroll: { x: s.x, y: s.y },
      page: value.page,
      area: value.area,
      ...cleanMetadata(value),
      ...(value.selections !== undefined ? { selections } : {}),
      ...(annotation ? { annotation } : {}),
      ...(context ? { context } : {}),
      ...(value.proposal ? { proposal: value.proposal } : {}),
    }),
  );
}
export function webReview(value: unknown): WebReview | null {
  if (!record(value)) return null;
  const before = webCapture(value.before);
  if (!before || !Array.isArray(value.after) || value.after.length > 100)
    return null;
  const after = Array.from(value.after, webCapture);
  if (!after.every((capture): capture is WebCapture => capture !== null))
    return null;
  if (value.additional === undefined) return { before, after };
  if (!Array.isArray(value.additional) || value.additional.length > 100)
    return null;
  const additional = Array.from(value.additional, webCapture);
  return additional.every((capture): capture is WebCapture => capture !== null)
    ? { before, after, additional }
    : null;
}

/** The durable subject is small; the immutable bundle owns selectors, DOM hints and drawing marks. */
export function compactWebCapture(capture: WebCapture): WebCapture {
  if (!capture.context) return capture;
  const proposal = capture.annotation?.image ?? capture.proposal;
  return {
    url: capture.url,
    title: capture.title,
    at: capture.at,
    mode: capture.mode,
    rect: capture.rect,
    viewport: capture.viewport,
    scroll: capture.scroll,
    page: capture.page,
    area: capture.area,
    components: [],
    context: capture.context,
    ...(proposal ? { proposal } : {}),
  };
}
export function compactWebReview(web: WebReview): WebReview {
  return {
    before: compactWebCapture(web.before),
    after: web.after.map(compactWebCapture),
    ...(web.additional
      ? { additional: web.additional.map(compactWebCapture) }
      : {}),
  };
}
/** Stable identity for an entire selected capture, not its automatic DOM metadata rows. */
export function webSelectionKey(capture: WebCapture): string {
  return JSON.stringify(
    capture.page && capture.area
      ? [capture.url, capture.at, capture.page, capture.area]
      : [
          capture.url,
          capture.at,
          capture.mode,
          capture.rect,
          capture.viewport,
          capture.scroll,
        ],
  );
}
export class WebSelectionConflict extends Error {}
export interface WebAnnotationTarget {
  kind: "selection" | "after";
  index: number;
  key: string;
  expected: string;
}
export class WebAnnotationInvalid extends Error {}
export function webAnnotationTarget(
  value: unknown,
): WebAnnotationTarget | null {
  if (
    !record(value) ||
    (value.kind !== "selection" && value.kind !== "after") ||
    typeof value.index !== "number" ||
    !Number.isInteger(value.index) ||
    value.index < 0 ||
    value.index > 100 ||
    typeof value.key !== "string" ||
    value.key.length > 32768 ||
    typeof value.expected !== "string" ||
    (value.expected !== "" &&
      (!ref(value.expected) || value.expected.length > 255))
  )
    return null;
  return {
    kind: value.kind,
    index: value.index,
    key: value.key,
    expected: value.expected,
  };
}
/** Compare identity and previous annotation atomically; never replace original capture evidence. */
export function setWebAnnotation(
  web: WebReview,
  target: WebAnnotationTarget,
  annotation: WebAnnotation | null,
): WebReview {
  const cleanTarget = webAnnotationTarget(target),
    clean = annotation === null ? null : webAnnotation(annotation);
  if (!cleanTarget || (annotation !== null && !clean))
    throw new WebAnnotationInvalid("Invalid screenshot annotation.");
  const next = webReview(web);
  if (!next) throw new WebAnnotationInvalid("Invalid UI evidence.");
  const capture =
    cleanTarget.kind === "after"
      ? next.after[cleanTarget.index]
      : cleanTarget.index === 0
        ? next.before
        : next.additional?.[cleanTarget.index - 1];
  if (!capture)
    throw new WebSelectionConflict(
      "That capture no longer exists. Reload the note and try again.",
    );
  if (
    webSelectionKey(capture) !== cleanTarget.key ||
    (capture.annotation?.image ?? "") !== cleanTarget.expected
  )
    throw new WebSelectionConflict(
      "That capture or annotation changed. Reload the note and try again.",
    );
  if (!capture.area || !capture.page)
    throw new WebAnnotationInvalid(
      "Metadata-only Point selections have no screenshot to annotate.",
    );
  if (capture.proposal && !capture.annotation)
    throw new WebSelectionConflict(
      "The drawing context is unavailable. Restore its context bundle before editing it.",
    );
  if (clean) capture.annotation = clean;
  else delete capture.annotation;
  delete capture.proposal;
  return next;
}
/** Remove only the selection the editor saw; comparisons belong to the original first capture. */
export function dropWebSelection(
  web: WebReview,
  index: number,
  key: string,
): WebReview | null {
  const additional = web.additional ?? [];
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 100 ||
    index > additional.length
  )
    throw new WebSelectionConflict(
      "That selection no longer exists. Reload the note and try again.",
    );
  const capture = index === 0 ? web.before : additional[index - 1]!;
  if (webSelectionKey(capture) !== key)
    throw new WebSelectionConflict(
      "That selection changed. Reload the note and try again.",
    );
  if (index === 0) {
    if (!additional.length) return null;
    const [before, ...rest] = additional;
    return {
      before: before!,
      after: [],
      ...(rest.length ? { additional: rest } : {}),
    };
  }
  const rest = additional.filter((_, i) => i !== index - 1);
  return {
    before: web.before,
    after: web.after,
    ...(rest.length ? { additional: rest } : {}),
  };
}
/** Human-readable evidence and a sealed machine-readable copy both travel in ordinary Markdown. */
export function webReviewLines(web: WebReview): string[] {
  web = webReview(web)!;
  const json = JSON.stringify(compactWebReview(web)).replace(
    /[<>&]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  const lines = [
    "<!-- lcr:web " + json + " -->",
    "",
    "UI capture: " +
      web.before.mode +
      (web.before.page && web.before.area
        ? " selection. Metadata and screenshots record the page at capture time."
        : " selection. Metadata records the page at capture time; no screenshot was captured."),
    "",
  ];
  const captures = [
    { capture: web.before, label: "Before" },
    ...(web.additional ?? []).map((capture, i) => ({
      capture,
      label: "Selection " + (i + 2),
    })),
    ...web.after.map((capture, i) => ({ capture, label: "After " + (i + 1) })),
  ];
  captures.forEach(({ capture: c, label }) => {
    if (c.context) {
      const imageLabel = label.startsWith("After ") ? "After" : label;
      lines.push(
        label + " capture:",
        "",
        "UI selection: " +
          c.mode +
          " at " +
          JSON.stringify(c.url) +
          ", captured " +
          JSON.stringify(c.at) +
          ".",
        ...(c.area
          ? ["", "![" + imageLabel + " — selected area](" + c.area + ")", ""]
          : ["", "Metadata only — no screenshot was captured.", ""]),
      );
      const proposal = c.annotation?.image ?? c.proposal;
      if (proposal)
        lines.push(
          "Annotated proposal — reviewer intent, not captured page content. Its margin is drawing space.",
          "",
          "![" + imageLabel + " — annotated proposal](" + proposal + ")",
          "",
        );
      lines.push(contextLink(c.context), "");
      return;
    }
    const annotation = c.annotation;
    // Old sealed blocks are matched byte-for-byte by the review parser.
    const enhancedGeometry = annotation?.marks.some(
      (mark) =>
        mark.tool === "callout" ||
        mark.tool === "highlighter" ||
        mark.tool === "magnifier" ||
        (mark.tool === "text" &&
          (mark.wrap !== undefined ||
            mark.background !== undefined ||
            mark.outline !== undefined ||
            mark.target !== undefined)) ||
        ("fill" in mark && mark.fill !== undefined) ||
        ("opacity" in mark && mark.opacity !== undefined),
    );
    const vectorGeometry = annotation?.marks.some(
      (mark) =>
        ["line", "ellipse", "triangle", "path"].includes(mark.tool) ||
        enhancedGeometry,
    );
    const summary = annotation
      ? {
          image: annotation.image,
          width: annotation.width,
          height: annotation.height,
          padding: annotation.padding,
          toolCounts: Object.fromEntries(
            [
              "pen",
              "arrow",
              "rectangle",
              "text",
              ...(vectorGeometry
                ? ["line", "ellipse", "triangle", "path"]
                : []),
              ...(enhancedGeometry
                ? ["callout", "highlighter", "magnifier"]
                : []),
            ].map((tool) => [
              tool,
              annotation.marks.filter((mark) => mark.tool === tool).length,
            ]),
          ),
          textPreviews: annotation.marks.flatMap((mark) =>
            mark.tool === "text"
              ? [
                  mark.text.length > 200
                    ? mark.text.slice(0, 200) + "…"
                    : mark.text,
                ]
              : [],
          ),
          ...(vectorGeometry ? { marks: annotation.marks } : {}),
        }
      : undefined;
    const data = JSON.stringify(
      {
        ...c,
        page: undefined,
        area: undefined,
        ...(annotation ? { annotation: summary } : {}),
      },
      null,
      2,
    );
    const fence = "`".repeat(
      Math.max(3, ...(data.match(/`+/g) || []).map((s) => s.length + 1)),
    );
    const imageLabel = label.startsWith("After ") ? "After" : label;
    lines.push(
      label === "Before"
        ? "Before capture:"
        : label.startsWith("After ")
          ? "After capture " + label.slice(6) + ":"
          : label + ":",
      "",
      fence + "json",
      data,
      fence,
      "",
      ...(c.page && c.area
        ? [
            "![" + imageLabel + " — page](" + c.page + ")",
            "",
            "![" + imageLabel + " — selected area](" + c.area + ")",
            "",
          ]
        : ["Metadata only — no screenshot was captured.", ""]),
    );
    if (c.annotation)
      lines.push(
        label +
          " original selected area is the unmodified screenshot above. Annotated proposal below adds reviewer drawings, not captured page content.",
        "The proposal has " +
          c.annotation.padding +
          " px of blank white padding on each side; padding is not page context.",
        ...(vectorGeometry
          ? [
              "Drawing geometry uses output-image pixels with (0, 0) at the padded canvas top-left; x increases right and y down. The original screenshot starts at (" +
                c.annotation.padding +
                ", " +
                c.annotation.padding +
                "); output size is " +
                (c.annotation.width + 2 * c.annotation.padding) +
                " × " +
                (c.annotation.height + 2 * c.annotation.padding) +
                " px. Stroke widths and text sizes are also output-image pixels.",
              "Marks are listed in paint order. Line and arrow use from/to endpoints; rectangle, ellipse and triangle use the normalized from/to bounding box. Rectangle radius rounds its corners; an ellipse is inscribed in its box; a triangle joins the top-center apex to the two bottom corners. Pen points form a polyline; text starts at at.",
              "Path nodes are ordered anchors. Each segment runs from one node to the next using the first node's out and next node's in as absolute cubic Bézier controls (a missing control equals its anchor); no controls means a straight segment. closed joins the last node back to the first. Smooth nodes keep tangent handles aligned during editing; corner handles move independently. The listed coordinates, including controls, are the exact saved geometry.",
              ...(enhancedGeometry
                ? [
                    "Callouts have stable UUID id values and unique number values; from is the numbered badge center, to is its leader target (equal points omit the leader), size is badge diameter, and label is optional explanatory reviewer text. Highlighter points are a translucent polyline with opacity applied to the whole stroke. Shape fill and opacity affect only the interior, never the outline.",
                    "Text wrap is the maximum measured line width; explicit newlines are preserved and long words split. background adds padded contrast behind the text and outline adds contrasting glyph edges. target is an independent leader endpoint that stays anchored when the text moves.",
                    "Magnifier from/to is a source rectangle entirely within the original screenshot (subtract padding to obtain original-image coordinates); at is the destination inset top-left and scale enlarges the original crop. Insets sample only original pixels, never other annotations. Moving an inset changes at, not its source rectangle.",
                  ]
                : []),
            ]
          : []),
        "",
        "![" +
          imageLabel +
          " — annotated proposal](" +
          c.annotation.image +
          ")",
        "",
      );
  });
  return lines.join("\n").split("\n");
}
