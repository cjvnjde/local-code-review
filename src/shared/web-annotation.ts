export type AnnotationPoint = { x: number; y: number };
export type AnnotationNode = AnnotationPoint & {
  kind: "corner" | "smooth";
  in?: AnnotationPoint;
  out?: AnnotationPoint;
};
type AnnotationFill = { fill?: string; opacity?: number };
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
      tool: "line";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
    }
  | ({
      tool: "ellipse";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
    } & AnnotationFill)
  | ({
      tool: "triangle";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
    } & AnnotationFill)
  | ({
      tool: "path";
      color: string;
      width: number;
      nodes: AnnotationNode[];
      closed: boolean;
    } & AnnotationFill)
  | ({
      tool: "rectangle";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
      radius: number;
    } & AnnotationFill)
  | {
      tool: "text";
      color: string;
      at: AnnotationPoint;
      text: string;
      size: number;
      wrap?: number;
      background?: string;
      outline?: boolean;
      target?: AnnotationPoint;
    }
  | {
      tool: "highlighter";
      color: string;
      width: number;
      points: AnnotationPoint[];
      opacity: number;
    }
  | {
      tool: "callout";
      id: string;
      number: number;
      label: string;
      color: string;
      width: number;
      size: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
    }
  | {
      tool: "magnifier";
      color: string;
      width: number;
      from: AnnotationPoint;
      to: AnnotationPoint;
      at: AnnotationPoint;
      scale: number;
    };
export interface WebAnnotation {
  image: string;
  width: number;
  height: number;
  padding: number;
  marks: AnnotationMark[];
}

/** Limits apply to the padded canvas; pen points, path nodes and controls share one budget. */
export const ANNOTATION_LIMITS = {
  maxDimension: 16384,
  maxPixels: 16777216,
  maxPadding: 2048,
  maxMarks: 500,
  maxPoints: 50000,
  maxText: 4000,
  maxWidth: 128,
  maxTextSize: 512,
  maxCalloutLabel: 200,
  maxMagnifierScale: 8,
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
  const ids = new Set<string>(),
    numbers = new Set<number>();
  let points = 0;
  for (const mark of value.marks) {
    if (
      !record(mark) ||
      typeof mark.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(mark.color)
    )
      return null;
    const color = mark.color;
    const fill: AnnotationFill = {};
    if (
      ["rectangle", "ellipse", "triangle", "path"].includes(String(mark.tool))
    ) {
      if (mark.fill !== undefined) {
        if (typeof mark.fill !== "string" || !/^#[0-9a-f]{6}$/i.test(mark.fill))
          return null;
        fill.fill = mark.fill;
      }
      if (mark.opacity !== undefined) {
        if (!bounded(mark.opacity, 0, 1)) return null;
        fill.opacity = mark.opacity;
      }
    }
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
      const clean: Extract<AnnotationMark, { tool: "text" }> = {
        tool: "text",
        color,
        at,
        text: mark.text,
        size: mark.size,
      };
      if (mark.wrap !== undefined) {
        if (!bounded(mark.wrap, Number.MIN_VALUE, limits.maxDimension))
          return null;
        clean.wrap = mark.wrap;
      }
      if (mark.background !== undefined) {
        if (
          typeof mark.background !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(mark.background)
        )
          return null;
        clean.background = mark.background;
      }
      if (mark.outline !== undefined) {
        if (typeof mark.outline !== "boolean") return null;
        clean.outline = mark.outline;
      }
      if (mark.target !== undefined) {
        const target = point(mark.target);
        if (!target) return null;
        clean.target = target;
      }
      marks.push(clean);
      continue;
    }
    if (!bounded(mark.width, 1, limits.maxWidth)) return null;
    if (mark.tool === "callout") {
      const from = point(mark.from),
        to = point(mark.to);
      if (
        !from ||
        !to ||
        typeof mark.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          mark.id,
        ) ||
        ids.has(mark.id.toLowerCase()) ||
        !bounded(mark.number, 1, limits.maxMarks) ||
        !Number.isInteger(mark.number) ||
        numbers.has(mark.number) ||
        typeof mark.label !== "string" ||
        mark.label.length > limits.maxCalloutLabel ||
        !bounded(mark.size, 1, limits.maxTextSize)
      )
        return null;
      ids.add(mark.id.toLowerCase());
      numbers.add(mark.number);
      marks.push({
        tool: "callout",
        id: mark.id,
        number: mark.number,
        label: mark.label,
        color,
        width: mark.width,
        size: mark.size,
        from,
        to,
      });
    } else if (mark.tool === "magnifier") {
      const from = point(mark.from),
        to = point(mark.to),
        at = point(mark.at);
      if (
        !from ||
        !to ||
        !at ||
        !bounded(mark.scale, 1, limits.maxMagnifierScale)
      )
        return null;
      const left = Math.min(from.x, to.x),
        top = Math.min(from.y, to.y),
        right = Math.max(from.x, to.x),
        bottom = Math.max(from.y, to.y);
      if (
        left < value.padding ||
        top < value.padding ||
        right > value.padding + value.width ||
        bottom > value.padding + value.height ||
        right <= left ||
        bottom <= top ||
        at.x + (right - left) * mark.scale > width ||
        at.y + (bottom - top) * mark.scale > height
      )
        return null;
      marks.push({
        tool: "magnifier",
        color,
        width: mark.width,
        from,
        to,
        at,
        scale: mark.scale,
      });
    } else if (mark.tool === "pen" || mark.tool === "highlighter") {
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
      if (mark.tool === "highlighter") {
        if (!bounded(mark.opacity, 0, 1)) return null;
        marks.push({
          tool: "highlighter",
          color,
          width: mark.width,
          points: clean,
          opacity: mark.opacity,
        });
      } else
        marks.push({ tool: "pen", color, width: mark.width, points: clean });
    } else if (mark.tool === "path") {
      if (
        typeof mark.closed !== "boolean" ||
        !Array.isArray(mark.nodes) ||
        mark.nodes.length < (mark.closed ? 3 : 2) ||
        (points += mark.nodes.length) > limits.maxPoints
      )
        return null;
      const nodes: AnnotationNode[] = [];
      for (const input of mark.nodes) {
        const at = point(input);
        if (
          !at ||
          !record(input) ||
          (input.kind !== "corner" && input.kind !== "smooth")
        )
          return null;
        const node: AnnotationNode = { ...at, kind: input.kind };
        for (const side of ["in", "out"] as const) {
          if (input[side] === undefined) continue;
          const control = point(input[side]);
          if (!control || ++points > limits.maxPoints) return null;
          node[side] = control;
        }
        nodes.push(node);
      }
      marks.push({
        tool: "path",
        color,
        width: mark.width,
        nodes,
        closed: mark.closed,
        ...fill,
      });
    } else if (
      mark.tool === "arrow" ||
      mark.tool === "line" ||
      mark.tool === "ellipse" ||
      mark.tool === "triangle" ||
      mark.tool === "rectangle"
    ) {
      const from = point(mark.from),
        to = point(mark.to);
      if (!from || !to) return null;
      if (mark.tool === "arrow" || mark.tool === "line")
        marks.push({ tool: mark.tool, color, width: mark.width, from, to });
      else if (mark.tool !== "rectangle")
        marks.push({
          tool: mark.tool,
          color,
          width: mark.width,
          from,
          to,
          ...fill,
        });
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
          ...fill,
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
