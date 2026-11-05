import {
  compactWebCapture,
  webCapture,
  type WebCapture,
  type WebReview,
} from "../shared/web-review.ts";
import type { ContextPart } from "../shared/context.ts";
import type { ReviewDoc } from "./thread.ts";
import {
  readContext,
  readContextPart,
  saveContext,
  type ContextPartInput,
} from "./context.ts";

const OWN_PARTS = new Set([
  "capture",
  "elements",
  "styles",
  "viewport",
  "selected-area",
  "proposal",
]);
const captures = (web: WebReview) => [
  web.before,
  ...(web.additional ?? []),
  ...web.after,
];
const subject = (capture: WebCapture) =>
  JSON.stringify(compactWebCapture(capture));
const compact = (capture: WebCapture) =>
  JSON.stringify(capture) === subject(capture);

function record(capture: WebCapture): WebCapture {
  const { context: _context, proposal: _proposal, ...value } = capture;
  const clean = webCapture(value);
  if (!clean) throw new Error("Invalid captured context.");
  return clean;
}

async function copyPart(
  repoRoot: string,
  outDir: string,
  id: string,
  part: ContextPart,
): Promise<ContextPartInput> {
  const { name, label, type, status, truncated, detail, attachment } = part;
  const input: ContextPartInput = {
    name,
    label,
    type,
    status,
    truncated,
    detail,
  };
  if (status !== "available") return input;
  if (attachment) return { ...input, attachment };
  const stored = await readContextPart(repoRoot, outDir, id, name);
  if (!stored)
    throw new Error(
      `Context part ${name} is unavailable. Restore the bundle before changing its capture.`,
    );
  return { ...input, data: stored.bytes };
}

/** Publish evidence before its reference can reach a review or a queued task. */
export async function saveWebContext(
  repoRoot: string,
  outDir: string,
  capture: WebCapture,
  extras: ContextPartInput[] = [],
): Promise<WebCapture> {
  const clean = record(capture);
  const encoded = JSON.stringify(clean);
  const inherited: ContextPartInput[] = [];
  if (capture.context) {
    const previous = await readContext(repoRoot, outDir, capture.context.id);
    if (!previous)
      throw new Error(
        "The captured context is unavailable. Restore its bundle before changing it.",
      );
    const snapshot = await readContextPart(
      repoRoot,
      outDir,
      capture.context.id,
      "capture",
    );
    if (!snapshot)
      throw new Error(
        "The capture snapshot is unavailable. Restore its context bundle.",
      );
    if (!extras.length && new TextDecoder().decode(snapshot.bytes) === encoded)
      return { ...clean, context: { id: previous.id, label: previous.label } };
    const replaced = new Set(extras.map((part) => part.name));
    for (const part of previous.parts) {
      if (!OWN_PARTS.has(part.name) && !replaced.has(part.name))
        inherited.push(await copyPart(repoRoot, outDir, previous.id, part));
    }
  }
  const targets = clean.selections ?? [
    {
      rect: clean.rect,
      selector: clean.selector,
      element: clean.element,
      components: clean.components,
    },
  ];
  const elements = targets.map(({ rect, selector, element, components }) => ({
    rect,
    selector,
    ...(element
      ? { tag: element.tag, text: element.text, attributes: element.attributes }
      : {}),
    components,
  }));
  const styles = targets.map(({ rect, selector, element }) => ({
    rect,
    selector,
    styles: element?.styles ?? {},
  }));
  const parts: ContextPartInput[] = [
    {
      name: "capture",
      label: "Complete capture and editable drawing",
      type: "application/json",
      data: encoded,
    },
    {
      name: "elements",
      label: "Selected elements, selectors and component hints",
      type: "application/json",
      data: JSON.stringify(elements, null, 2),
    },
    {
      name: "styles",
      label: "Selected computed styles",
      type: "application/json",
      data: JSON.stringify(styles, null, 2),
    },
    {
      name: "viewport",
      label: "Captured viewport",
      type: "image/png",
      attachment: clean.page,
      ...(!clean.page
        ? {
            status: "excluded" as const,
            detail: "Point selections contain metadata only.",
          }
        : {}),
    },
    {
      name: "selected-area",
      label: "Original selected area",
      type: "image/png",
      attachment: clean.area,
      ...(!clean.area
        ? {
            status: "excluded" as const,
            detail: "Point selections contain metadata only.",
          }
        : {}),
    },
    ...(clean.annotation
      ? [
          {
            name: "proposal",
            label: "Annotated proposal (reviewer intent)",
            type: "image/png",
            attachment: clean.annotation.image,
          },
        ]
      : []),
    ...inherited,
    ...extras,
  ];
  const label = `${clean.title || new URL(clean.url).pathname} — ${clean.mode}`
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const context = await saveContext(repoRoot, outDir, {
    label,
    at: clean.at,
    source: { url: clean.url, title: clean.title, captureAt: clean.at },
    parts,
  });
  return { ...clean, context };
}

/** Rehydrate only the exact saved subject, never a newer page or a different capture. */
export async function hydrateWebContexts(
  repoRoot: string,
  outDir: string,
  web: WebReview,
): Promise<WebReview> {
  const next = {
    ...web,
    before: web.before,
    after: [...web.after],
    ...(web.additional ? { additional: [...web.additional] } : {}),
  };
  const read = async (capture: WebCapture): Promise<WebCapture> => {
    if (!capture.context) return capture;
    try {
      const stored = await readContextPart(
        repoRoot,
        outDir,
        capture.context.id,
        "capture",
      );
      const value =
        stored &&
        webCapture(JSON.parse(new TextDecoder().decode(stored.bytes)));
      if (!value || value.context) return compactWebCapture(capture);
      const hydrated = { ...value, context: capture.context };
      return subject(hydrated) === subject(capture)
        ? hydrated
        : compactWebCapture(capture);
    } catch {
      // The summary and references remain readable; the context inspector reports the missing part.
      return compactWebCapture(capture);
    }
  };
  next.before = await read(web.before);
  for (let i = 0; i < next.after.length; i++)
    next.after[i] = await read(next.after[i]!);
  for (let i = 0; i < (next.additional?.length ?? 0); i++)
    next.additional![i] = await read(next.additional![i]!);
  return next;
}

/** Annotation edits create a new bundle; unchanged and unavailable historical references stay put. */
export async function preserveWebContexts(
  repoRoot: string,
  outDir: string,
  web: WebReview,
): Promise<WebReview> {
  const next = {
    ...web,
    before: web.before,
    after: [...web.after],
    ...(web.additional ? { additional: [...web.additional] } : {}),
  };
  const keep = async (capture: WebCapture) => {
    if (!capture.context || compact(capture)) return capture;
    return saveWebContext(repoRoot, outDir, capture);
  };
  next.before = await keep(web.before);
  for (let i = 0; i < next.after.length; i++)
    next.after[i] = await keep(next.after[i]!);
  for (let i = 0; i < (next.additional?.length ?? 0); i++)
    next.additional![i] = await keep(next.additional![i]!);
  return next;
}

export async function hydrateContextDoc(
  repoRoot: string,
  outDir: string,
  doc: ReviewDoc,
): Promise<ReviewDoc> {
  for (const note of doc.notes) {
    if (note.web && captures(note.web).some((capture) => capture.context))
      note.web = await hydrateWebContexts(repoRoot, outDir, note.web);
  }
  return doc;
}
