import { z } from "zod";
import { imageRegion } from "../shared/image-region.ts";
import { webAnnotation } from "../shared/web-annotation.ts";
import { webAnnotationTarget, webReview } from "../shared/web-review.ts";
import { parseThemeDraft } from "../shared/themes.ts";
import { boundedArray } from "./request.ts";

const KiB = 1024;
const MiB = KiB * KiB;
export const parserSetupRequestSchema = z.strictObject({
  action: z.enum(["install", "install-detected", "refresh"]),
});
export const JSON_LIMITS = {
  settings: 32 * KiB,
  theme: 32 * KiB,
  control: 64 * KiB,
  reply: 4 * MiB,
  annotation: 16 * MiB,
  note: 32 * MiB,
  submission: 64 * MiB,
} as const;

const id = z.string().min(1).max(32768);
const file = z.string().max(32768);
const text = z.string().max(4 * MiB);
const body = text.refine(
  (value) => !!value.trim(),
  "A non-empty message is required.",
);
const integer = z.number().int().nonnegative();

/** Bound opaque, versioned media metadata before its existing domain validator runs.
 * Those validators intentionally whitelist fields, preserving their portable metadata policy.
 */
function boundedMetadata(value: unknown): boolean {
  let remaining = 1_000_000;
  function visit(value: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 32) return false;
    if (typeof value === "string") return value.length <= 4 * MiB;
    if (Array.isArray(value)) {
      if (value.length > 50000) return false;
      for (const entry of value) if (!visit(entry, depth + 1)) return false;
    } else if (value !== null && typeof value === "object") {
      let keys = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (
          ++keys > 128 ||
          key.length > 32768 ||
          !visit((value as Record<string, unknown>)[key], depth + 1)
        )
          return false;
      }
    }
    return true;
  }
  return visit(value, 0);
}

function domainSchema<T>(parse: (value: unknown) => T | null, label: string) {
  return z
    .custom<unknown>(boundedMetadata, "Metadata exceeds its structural limits.")
    .transform((value, ctx) => {
      const parsed = parse(value);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: `Invalid ${label}.` });
        return z.NEVER;
      }
      return parsed;
    });
}

export const themeRequestSchema = z.unknown().transform((value, ctx) => {
  try {
    return parseThemeDraft(value);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
});

// Request envelopes and comments reject unknown fields instead of silently discarding typos.
const commentFields = {
  id: id.optional(),
  file,
  body,
  start: integer,
  end: integer,
  label: z.string().max(32768).optional(),
  side: z.enum(["new", "old"]).optional(),
  code: text.optional(),
  scope: z.enum(["file", "global"]).optional(),
  ca: integer.optional(),
  cb: integer.optional(),
  snippet: text.optional(),
  image: domainSchema(imageRegion, "image region").optional(),
  web: domainSchema(webReview, "web capture").optional(),
  triage: z.enum(["blocker", "bug", "suggestion", "question"]).optional(),
};
const ascending = (value: {
  start: number;
  end: number;
  ca?: number;
  cb?: number;
}) =>
  value.end >= value.start &&
  (value.ca === undefined || value.cb === undefined || value.cb >= value.ca);
export const reviewCommentSchema = z
  .strictObject(commentFields)
  .refine(ascending, "A valid ascending range is required.");
const savedCommentSchema = z
  .strictObject({ ...commentFields, id })
  .refine(ascending, "A valid ascending range is required.");
export type ReviewCommentInput = z.infer<typeof reviewCommentSchema>;
export const noteRequestSchema = z.strictObject({
  comment: savedCommentSchema,
  retry: z.boolean().optional(),
  replace: z.boolean().optional(),
  preserveTriage: z.boolean().optional(),
  ask: z.boolean().optional(),
});
export const submitRequestSchema = z.strictObject({
  comments: boundedArray(reviewCommentSchema, 10000),
  replace: z.boolean().optional(),
});
export const importRequestSchema = z.strictObject({
  from: z.strictObject({ file: file.min(1), id }),
  comment: savedCommentSchema,
});
export const replyRequestSchema = z.strictObject({
  id,
  at: z.string().max(128).optional(),
  body,
  ask: z.boolean().optional(),
});
export const openFileRequestSchema = z.strictObject({
  path: file.min(1),
  editor: z.string().max(32768).optional(),
});
export const reviewRequestSchema = z.strictObject({ file: file.min(1) });
export const queueRequestSchema = z.strictObject({
  action: z.string().min(1).max(128),
  id: id.optional(),
  option: z.string().max(32768).optional(),
});
export const webOpenRequestSchema = z.strictObject({});
export const webReviewRequestSchema = z.strictObject({ id: id.optional() });
export const webNoteRequestSchema = z.strictObject({ id });
export const webDraftRequestSchema = z.strictObject({ draftId: id });
const oneTarget = (value: { id?: string; draftId?: string }) =>
  (value.id !== undefined) !== (value.draftId !== undefined);
export const selectionRequestSchema = z
  .strictObject({
    id: id.optional(),
    draftId: id.optional(),
    index: integer.max(100),
    key: z.string().max(32768),
  })
  .refine(oneTarget, "Exactly one note or draft id is required.");
export const annotationRequestSchema = z
  .strictObject({
    id: id.optional(),
    draftId: id.optional(),
    target: domainSchema(webAnnotationTarget, "annotation target"),
    annotation: domainSchema(webAnnotation, "annotation").nullable(),
  })
  .refine(oneTarget, "Exactly one note or draft id is required.");
