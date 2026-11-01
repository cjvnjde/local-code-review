export type AnnotationPoint = { x: number; y: number };
export type AnnotationMark =
  | { tool: "pen"; color: string; width: number; points: AnnotationPoint[] }
  | {
      tool: "arrow";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
    }
  | {
      tool: "rectangle";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
      radius: number;
    }
  | {
      tool: "text";
      color: string;
      at: AnnotationPoint;
      text: string;
      size: number;
    };
export interface WebAnnotation {
  image: string;
  width: number;
  height: number;
  padding: number;
  marks: AnnotationMark[];
}

/** Limits apply to the padded output canvas, including all editable pen points. */
export const ANNOTATION_LIMITS = {
  maxDimension: 16384,
  maxPixels: 16777216,
  maxPadding: 2048,
  maxMarks: 500,
  maxPoints: 50000,
  maxText: 4000,
  maxWidth: 128,
  maxTextSize: 512,
} as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

/** Validate, detach and whitelist editable metadata; the original capture is never part of it. */
export function webAnnotation(value: unknown): WebAnnotation | null {
  const limits = ANNOTATION_LIMITS;
  if (
    !record(value) ||
    typeof value.image !== "string" ||
    !/^images\/[a-z0-9][a-z0-9._-]*\.png$/i.test(value.image) ||
    value.image.length > 255 ||
    !bounded(value.width, 1, limits.maxDimension) ||
    !Number.isInteger(value.width) ||
    !bounded(value.height, 1, limits.maxDimension) ||
    !Number.isInteger(value.height) ||
    !bounded(value.padding, 0, limits.maxPadding) ||
    !Number.isInteger(value.padding)
  )
    return null;
  const width = value.width + value.padding * 2,
    height = value.height + value.padding * 2;
  if (
    width > limits.maxDimension ||
    height > limits.maxDimension ||
    width * height > limits.maxPixels ||
    !Array.isArray(value.marks) ||
    !value.marks.length ||
    value.marks.length > limits.maxMarks
  )
    return null;
  const point = (input: unknown): AnnotationPoint | null =>
    record(input) && bounded(input.x, 0, width) && bounded(input.y, 0, height)
      ? { x: input.x, y: input.y }
      : null;
  const marks: AnnotationMark[] = [];
  let points = 0;
  for (const mark of value.marks) {
    if (
      !record(mark) ||
      typeof mark.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(mark.color)
    )
      return null;
    const color = mark.color;
    if (mark.tool === "text") {
      const at = point(mark.at);
      if (
        !at ||
        typeof mark.text !== "string" ||
        !mark.text.trim() ||
        mark.text.length > limits.maxText ||
        !bounded(mark.size, 1, limits.maxTextSize)
      )
        return null;
      marks.push({ tool: "text", color, at, text: mark.text, size: mark.size });
      continue;
    }
    if (!bounded(mark.width, 1, limits.maxWidth)) return null;
    if (mark.tool === "pen") {
      if (
        !Array.isArray(mark.points) ||
        !mark.points.length ||
        (points += mark.points.length) > limits.maxPoints
      )
        return null;
      const clean: AnnotationPoint[] = [];
      for (const input of mark.points) {
        const p = point(input);
        if (!p) return null;
        clean.push(p);
      }
      marks.push({ tool: "pen", color, width: mark.width, points: clean });
    } else if (mark.tool === "arrow" || mark.tool === "rectangle") {
      const from = point(mark.from),
        to = point(mark.to);
      if (!from || !to) return null;
      if (mark.tool === "arrow")
        marks.push({ tool: "arrow", color, width: mark.width, from, to });
      else {
        if (
          !bounded(
            mark.radius,
            0,
            Math.min(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 2,
          )
        )
          return null;
        marks.push({
          tool: "rectangle",
          color,
          width: mark.width,
          from,
          to,
          radius: mark.radius,
        });
      }
    } else return null;
  }
  return {
    image: value.image,
    width: value.width,
    height: value.height,
    padding: value.padding,
    marks,
  };
}

/** The proposal must describe the exact original pixels and its own padded PNG, not renamed data. */
export async function webAnnotationImagesMatch(
  annotation: WebAnnotation,
  source: string,
  read: (name: string) => Promise<{ bytes: Uint8Array; type: string } | null>,
): Promise<boolean> {
  for (const [name, width, height] of [
    [source, annotation.width, annotation.height],
    [
      annotation.image,
      annotation.width + annotation.padding * 2,
      annotation.height + annotation.padding * 2,
    ],
  ] as const) {
    const image = await read(name);
    if (!image || image.type !== "image/png" || image.bytes.byteLength < 33)
      return false;
    const bytes = image.bytes,
      header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      header.getUint32(0) !== 0x89504e47 ||
      header.getUint32(4) !== 0x0d0a1a0a ||
      header.getUint32(8) !== 13 ||
      header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== width ||
      header.getUint32(20) !== height
    )
      return false;
  }
  return true;
}
