import {
  ANNOTATION_LIMITS,
  webAnnotation,
  type AnnotationMark,
  type AnnotationPoint,
} from "../../../shared/web-annotation.ts";

export interface AnnotationDraftIdentity {
  repo: string;
  read: string;
  route: string;
  source: string;
  baseline: string;
  width: number;
  height: number;
  padding: number;
}

export type AnnotationDraftPath = Extract<AnnotationMark, { tool: "path" }>;
export interface AnnotationDraft {
  marks: AnnotationMark[];
  path: AnnotationDraftPath | null;
  pendingText: AnnotationPoint | null;
  text: string;
}

export interface AnnotationDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AnnotationDraftError {
  kind: "storage" | "invalid" | "conflict";
  message: string;
  cause?: unknown;
}
export type AnnotationDraftResult<T> =
  { ok: true; value: T } | { ok: false; error: AnnotationDraftError };

export interface AnnotationDraftStore {
  load(): AnnotationDraftResult<AnnotationDraft | null>;
  save(draft: AnnotationDraft): AnnotationDraftResult<void>;
  clear(): AnnotationDraftResult<void>;
}

/** Bound serialized metadata before parsing; captures and rendered pixels are never stored. */
export const ANNOTATION_DRAFT_MAX_LENGTH = 8 * 1024 * 1024;
const VERSION = 1;
const PREFIX = "lcr:annotation-draft:v1:";
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const success = <T>(value: T): AnnotationDraftResult<T> => ({
  ok: true,
  value,
});
const failure = (
  kind: AnnotationDraftError["kind"],
  message: string,
  cause?: unknown,
): { ok: false; error: AnnotationDraftError } => ({
  ok: false,
  error: { kind, message, ...(cause === undefined ? {} : { cause }) },
});

/** Compact lookup only; full identity equality, not this hash, authorizes access. */
function fingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return (
    (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0")
  );
}

function dimensions(identity: AnnotationDraftIdentity, marks: unknown) {
  return webAnnotation({
    image: "images/draft.png",
    width: identity.width,
    height: identity.height,
    padding: identity.padding,
    marks,
  });
}

function validIdentity(identity: AnnotationDraftIdentity): boolean {
  return (
    [identity.repo, identity.read, identity.route, identity.source].every(
      (part) => typeof part === "string" && part.length <= 16384,
    ) &&
    typeof identity.baseline === "string" &&
    identity.baseline.length <= ANNOTATION_DRAFT_MAX_LENGTH &&
    dimensions(identity, [
      {
        tool: "text",
        color: "#000000",
        at: { x: 0, y: 0 },
        text: ".",
        size: 1,
      },
    ]) !== null
  );
}

function sameIdentity(
  value: unknown,
  identity: AnnotationDraftIdentity,
): boolean {
  return (
    record(value) &&
    (Object.keys(identity) as (keyof AnnotationDraftIdentity)[]).every(
      (key) => value[key] === identity[key],
    )
  );
}

function pointCount(marks: AnnotationMark[]): number {
  let count = 0;
  for (const mark of marks) {
    if ("points" in mark) count += mark.points.length;
    else if (mark.tool === "path") {
      for (const node of mark.nodes)
        count +=
          1 + Number(node.in !== undefined) + Number(node.out !== undefined);
    }
  }
  return count;
}

/** Reuse applied-mark validation, while allowing an empty drawing and a one-node open path. */
function cleanDraft(
  value: unknown,
  identity: AnnotationDraftIdentity,
): AnnotationDraft | null {
  if (
    !record(value) ||
    !Array.isArray(value.marks) ||
    value.marks.length > ANNOTATION_LIMITS.maxMarks ||
    typeof value.text !== "string" ||
    value.text.length > ANNOTATION_LIMITS.maxText
  )
    return null;
  let marks: AnnotationMark[] = [];
  if (value.marks.length) {
    const annotation = dimensions(identity, value.marks);
    if (!annotation) return null;
    marks = annotation.marks;
  }
  let path: AnnotationDraftPath | null = null;
  if (value.path !== null) {
    const input = value.path;
    if (
      !record(input) ||
      input.tool !== "path" ||
      !Array.isArray(input.nodes) ||
      !input.nodes.length ||
      input.nodes.length > ANNOTATION_LIMITS.maxPoints ||
      typeof input.closed !== "boolean" ||
      (input.closed && input.nodes.length < 3) ||
      marks.length >= ANNOTATION_LIMITS.maxMarks
    )
      return null;
    const single = input.nodes.length === 1;
    const annotation = dimensions(identity, [
      {
        ...input,
        nodes: single ? [input.nodes[0], input.nodes[0]] : input.nodes,
      },
    ]);
    const clean = annotation?.marks[0];
    if (!clean || clean.tool !== "path") return null;
    if (single) clean.nodes.pop();
    path = clean;
    if (pointCount(marks) + pointCount([path]) > ANNOTATION_LIMITS.maxPoints)
      return null;
  }
  let pendingText: AnnotationPoint | null = null;
  if (value.pendingText !== null) {
    const point = value.pendingText;
    if (
      !record(point) ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > identity.width + identity.padding * 2 ||
      point.y > identity.height + identity.padding * 2
    )
      return null;
    pendingText = { x: point.x, y: point.y };
  }
  return { marks, path, pendingText, text: value.text };
}

/**
 * One store represents one editor lifetime. Load before offering recovery; save only
 * completed gestures or intentional unfinished path/text state. Writes and clears
 * compare the last observed record so an older tab cannot knowingly replace a newer
 * draft. localStorage has no atomic compare-and-swap: simultaneous writes can race.
 */
export function createAnnotationDraftStore(
  input: AnnotationDraftIdentity,
  storage: AnnotationDraftStorage,
): AnnotationDraftStore {
  const identity: AnnotationDraftIdentity = {
    repo: input.repo,
    read: input.read,
    route: input.route,
    source: input.source,
    baseline: input.baseline,
    width: input.width,
    height: input.height,
    padding: input.padding,
  };
  const valid = validIdentity(identity);
  const key = valid
    ? PREFIX +
      JSON.stringify([
        identity.repo,
        identity.read,
        identity.route,
        identity.source,
        fingerprint(identity.baseline),
        identity.width,
        identity.height,
        identity.padding,
      ])
    : "";
  let observed: string | null | undefined;
  let incompatible = false;

  function current(): AnnotationDraftResult<string | null> {
    if (!valid)
      return failure("invalid", "The annotation draft identity is invalid.");
    try {
      return success(storage.getItem(key));
    } catch (cause) {
      return failure(
        "storage",
        "Could not read the local annotation draft.",
        cause,
      );
    }
  }

  function writable(): AnnotationDraftResult<void> {
    const result = current();
    if (!result.ok) return result;
    if (incompatible)
      return failure(
        "conflict",
        "A different annotation draft occupies this local record. It was not changed.",
      );
    // Without a load, only a genuinely empty slot is safe to write or clear.
    if (result.value !== (observed === undefined ? null : observed))
      return failure(
        "conflict",
        "The annotation draft changed in another editor. Reopen it before replacing or discarding it.",
      );
    return success(undefined);
  }

  return {
    load() {
      const result = current();
      if (!result.ok) return result;
      observed = result.value;
      incompatible = false;
      if (result.value === null) return success(null);
      if (result.value.length > ANNOTATION_DRAFT_MAX_LENGTH)
        return failure(
          "invalid",
          "The local annotation draft is too large to restore.",
        );
      let saved: unknown;
      try {
        saved = JSON.parse(result.value);
      } catch (cause) {
        return failure(
          "invalid",
          "The local annotation draft is not valid JSON.",
          cause,
        );
      }
      if (!record(saved) || saved.version !== VERSION)
        return failure(
          "invalid",
          "The local annotation draft format is not supported.",
        );
      if (!sameIdentity(saved.identity, identity)) {
        incompatible = true;
        return failure(
          "conflict",
          "The local annotation draft belongs to different capture or applied drawing data.",
        );
      }
      const draft = cleanDraft(saved.draft, identity);
      return draft
        ? success(draft)
        : failure(
            "invalid",
            "The local annotation draft contains invalid drawing data.",
          );
    },
    save(draft) {
      if (!valid)
        return failure("invalid", "The annotation draft identity is invalid.");
      const clean = cleanDraft(draft, identity);
      if (!clean)
        return failure(
          "invalid",
          "The annotation draft contains invalid drawing data.",
        );
      const encoded = JSON.stringify({
        version: VERSION,
        identity,
        draft: clean,
      });
      if (encoded.length > ANNOTATION_DRAFT_MAX_LENGTH)
        return failure(
          "invalid",
          "The annotation draft is too large to save locally.",
        );
      const ready = writable();
      if (!ready.ok) return ready;
      try {
        storage.setItem(key, encoded);
        observed = encoded;
        return success(undefined);
      } catch (cause) {
        return failure(
          "storage",
          "Could not save the local annotation draft. Keep this editor open.",
          cause,
        );
      }
    },
    clear() {
      const ready = writable();
      if (!ready.ok) return ready;
      try {
        storage.removeItem(key);
        observed = null;
        return success(undefined);
      } catch (cause) {
        return failure(
          "storage",
          "Could not discard the local annotation draft.",
          cause,
        );
      }
    },
  };
}
