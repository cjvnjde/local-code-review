import {
  ANNOTATION_LIMITS,
  type AnnotationMark,
  type AnnotationNode,
  type AnnotationPoint,
} from "../../../shared/web-annotation.ts";

export type AnnotationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type AnnotationHandle =
  | {
      kind: "resize";
      edge: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
      x: number;
      y: number;
    }
  | { kind: "endpoint"; end: "from" | "to"; x: number; y: number }
  | { kind: "target"; x: number; y: number }
  | { kind: "node"; index: number; x: number; y: number }
  | {
      kind: "control";
      index: number;
      side: "in" | "out";
      x: number;
      y: number;
    };

type CanvasSize = { width: number; height: number; padding?: number };
type MeasureText = (text: string, size: number) => number;
type PathMark = Extract<AnnotationMark, { tool: "path" }>;
type ResizeHandle = Extract<AnnotationHandle, { kind: "resize" }>;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const distance = (a: AnnotationPoint, b: AnnotationPoint) =>
  Math.hypot(b.x - a.x, b.y - a.y);
const mix = (a: AnnotationPoint, b: AnnotationPoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const boundedPoint = (at: AnnotationPoint, canvas: CanvasSize) => ({
  x: clamp(at.x, 0, canvas.width),
  y: clamp(at.y, 0, canvas.height),
});

function pointBounds(points: Iterable<AnnotationPoint>): AnnotationBounds {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of points) {
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return x === Infinity
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x, y, width: right - x, height: bottom - y };
}

type TextMark = Extract<AnnotationMark, { tool: "text" }>;
const textPadding = (mark: TextMark) =>
  mark.background ? Math.max(4, mark.size * 0.2) : 0;
const textWidth = (text: string, size: number, measure?: MeasureText) =>
  measure?.(text, size) ?? Array.from(text).length * size;

/** Wrap using the same measured font as painting; retain explicit empty lines. */
export function textLines(
  mark: Pick<TextMark, "text" | "size" | "wrap">,
  measure?: MeasureText,
): string[] {
  if (!mark.wrap) return mark.text.split("\n");
  const lines: string[] = [];
  for (const paragraph of mark.text.split("\n")) {
    let line = "";
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (textWidth(line + token, mark.size, measure) <= mark.wrap) {
        line += token;
        continue;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (/^\s+$/u.test(token)) continue;
      for (const char of token) {
        if (line && textWidth(line + char, mark.size, measure) > mark.wrap) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function calloutLabel(
  mark: Extract<AnnotationMark, { tool: "callout" }>,
  measure?: MeasureText,
) {
  const size = mark.size * 0.5,
    padding = mark.size / 6;
  const lines = textLines(
    { text: mark.label, size, wrap: mark.size * 10 },
    measure,
  );
  return {
    size,
    padding,
    lines,
    x: mark.from.x + mark.size / 2 + padding,
    y: mark.from.y - size * 0.625 - padding,
    width:
      Math.max(1, ...lines.map((line) => textWidth(line, size, measure))) +
      padding * 2,
    height: lines.length * size * 1.25 + padding * 2,
  };
}

/** Editable coordinate bounds, excluding stroke thickness. Controls stay selectable. */
export function markBounds(
  mark: AnnotationMark,
  measure?: MeasureText,
): AnnotationBounds {
  if (mark.tool === "text") {
    const lines = textLines(mark, measure),
      padding = textPadding(mark);
    return {
      x: mark.at.x,
      y: mark.at.y,
      width:
        Math.max(
          1,
          ...lines.map((line) => textWidth(line, mark.size, measure)),
        ) +
        padding * 2,
      height: lines.length * mark.size * 1.25 + padding * 2,
    };
  }
  if (mark.tool === "magnifier")
    return {
      x: mark.at.x,
      y: mark.at.y,
      width: Math.abs(mark.to.x - mark.from.x) * mark.scale,
      height: Math.abs(mark.to.y - mark.from.y) * mark.scale,
    };
  if (mark.tool === "callout") {
    const radius = mark.size / 2,
      label = calloutLabel(mark, measure);
    return pointBounds([
      { x: mark.from.x - radius, y: mark.from.y - radius },
      { x: mark.from.x + radius, y: mark.from.y + radius },
      mark.to,
      ...(mark.label
        ? [
            { x: label.x, y: label.y },
            { x: label.x + label.width, y: label.y + label.height },
          ]
        : []),
    ]);
  }
  if (mark.tool === "path") {
    const nodes = mark.nodes;
    function* points() {
      for (const node of nodes) {
        yield node;
        if (node.in) yield node.in;
        if (node.out) yield node.out;
      }
    }
    return pointBounds(points());
  }
  return pointBounds(
    mark.tool === "pen" || mark.tool === "highlighter"
      ? mark.points
      : [mark.from, mark.to],
  );
}

export function markHandles(
  mark: AnnotationMark,
  measure?: MeasureText,
): AnnotationHandle[] {
  if (mark.tool === "line" || mark.tool === "arrow" || mark.tool === "callout")
    return [
      { kind: "endpoint", end: "from", ...mark.from },
      { kind: "endpoint", end: "to", ...mark.to },
    ];
  if (mark.tool === "path") {
    const handles: AnnotationHandle[] = mark.nodes.map((node, index) => ({
      kind: "node",
      index,
      x: node.x,
      y: node.y,
    }));
    mark.nodes.forEach((node, index) => {
      if (node.in)
        handles.push({ kind: "control", index, side: "in", ...node.in });
      if (node.out)
        handles.push({ kind: "control", index, side: "out", ...node.out });
    });
    return handles;
  }
  const { x, y, width, height } = markBounds(mark, measure);
  const handles: AnnotationHandle[] = [
    { kind: "resize", edge: "nw", x, y },
    { kind: "resize", edge: "n", x: x + width / 2, y },
    { kind: "resize", edge: "ne", x: x + width, y },
    { kind: "resize", edge: "e", x: x + width, y: y + height / 2 },
    { kind: "resize", edge: "se", x: x + width, y: y + height },
    { kind: "resize", edge: "s", x: x + width / 2, y: y + height },
    { kind: "resize", edge: "sw", x, y: y + height },
    { kind: "resize", edge: "w", x, y: y + height / 2 },
  ];
  if (mark.tool === "text" && mark.target)
    handles.unshift({ kind: "target", ...mark.target });
  if (mark.tool === "magnifier")
    handles.unshift(
      { kind: "endpoint", end: "from", ...mark.from },
      { kind: "endpoint", end: "to", ...mark.to },
    );
  return handles;
}

function mapNode(
  node: AnnotationNode,
  map: (point: AnnotationPoint) => AnnotationPoint,
): AnnotationNode {
  return {
    ...node,
    ...map(node),
    ...(node.in ? { in: map(node.in) } : {}),
    ...(node.out ? { out: map(node.out) } : {}),
  };
}

// Oversize text cannot be made to fit by translation; keep its origin on canvas.
function moveDelta(value: number, start: number, size: number, limit: number) {
  return clamp(start + value, 0, Math.max(0, limit - size)) - start;
}

export function moveMark(
  mark: AnnotationMark,
  dx: number,
  dy: number,
  canvas: CanvasSize,
  measure?: MeasureText,
): AnnotationMark {
  const bounds = markBounds(mark, measure);
  dx = moveDelta(dx, bounds.x, bounds.width, canvas.width);
  dy = moveDelta(dy, bounds.y, bounds.height, canvas.height);
  const translate = (point: AnnotationPoint) => ({
    x: point.x + dx,
    y: point.y + dy,
  });
  if (mark.tool === "text" || mark.tool === "magnifier")
    return { ...mark, at: translate(mark.at) };
  if (mark.tool === "pen" || mark.tool === "highlighter")
    return { ...mark, points: mark.points.map(translate) };
  if (mark.tool === "path")
    return {
      ...mark,
      nodes: mark.nodes.map((node) => mapNode(node, translate)),
    };
  return { ...mark, from: translate(mark.from), to: translate(mark.to) };
}

/** Shorten a ray, rather than clamping its axes independently and breaking tangency. */
function rayPoint(
  at: AnnotationPoint,
  dx: number,
  dy: number,
  length: number,
  canvas: CanvasSize,
): AnnotationPoint {
  const magnitude = Math.hypot(dx, dy);
  if (!magnitude) return { x: at.x, y: at.y };
  dx /= magnitude;
  dy /= magnitude;
  if (dx > 0) length = Math.min(length, (canvas.width - at.x) / dx);
  if (dx < 0) length = Math.min(length, -at.x / dx);
  if (dy > 0) length = Math.min(length, (canvas.height - at.y) / dy);
  if (dy < 0) length = Math.min(length, -at.y / dy);
  return boundedPoint({ x: at.x + dx * length, y: at.y + dy * length }, canvas);
}

function resizeText(
  mark: Extract<AnnotationMark, { tool: "text" }>,
  handle: ResizeHandle,
  at: AnnotationPoint,
  canvas: CanvasSize,
  measure?: MeasureText,
): AnnotationMark {
  const bounds = markBounds(mark, measure),
    west = handle.edge.includes("w"),
    east = handle.edge.includes("e"),
    north = handle.edge.includes("n"),
    south = handle.edge.includes("s"),
    horizontal = west || east,
    vertical = north || south;
  const anchorX = west ? bounds.x + bounds.width : bounds.x,
    anchorY = north ? bounds.y + bounds.height : bounds.y;
  const width = horizontal ? Math.abs(at.x - anchorX) : bounds.width,
    height = vertical ? Math.abs(at.y - anchorY) : bounds.height;
  const ratio = Math.min(
    horizontal ? width / bounds.width : Infinity,
    vertical ? height / bounds.height : Infinity,
  );
  // Crossing the fixed anchor changes placement, never mirrors the glyphs.
  const left = horizontal ? at.x < anchorX : false,
    above = vertical ? at.y < anchorY : false;
  const availableWidth = left ? anchorX : canvas.width - anchorX,
    availableHeight = above ? anchorY : canvas.height - anchorY;
  let size = clamp(mark.size * ratio, 1, ANNOTATION_LIMITS.maxTextSize);
  let resized = {
    ...mark,
    size,
    ...(mark.wrap === undefined
      ? {}
      : { wrap: Math.min(canvas.width, (mark.wrap * size) / mark.size) }),
  };
  let next = markBounds(resized, measure);
  size = clamp(
    size *
      Math.min(1, availableWidth / next.width, availableHeight / next.height),
    1,
    ANNOTATION_LIMITS.maxTextSize,
  );
  resized = {
    ...mark,
    size,
    ...(mark.wrap === undefined
      ? {}
      : { wrap: Math.min(canvas.width, (mark.wrap * size) / mark.size) }),
  };
  next = markBounds(resized, measure);
  return {
    ...resized,
    at: {
      x: clamp(
        left ? anchorX - next.width : anchorX,
        0,
        Math.max(0, canvas.width - next.width),
      ),
      y: clamp(
        above ? anchorY - next.height : anchorY,
        0,
        Math.max(0, canvas.height - next.height),
      ),
    },
  };
}

export function editHandle(
  mark: AnnotationMark,
  handle: AnnotationHandle,
  at: AnnotationPoint,
  canvas: CanvasSize,
  measure?: MeasureText,
): AnnotationMark {
  at = boundedPoint(at, canvas);
  if (handle.kind === "target")
    return mark.tool === "text" ? { ...mark, target: at } : mark;
  if (handle.kind === "endpoint") {
    if (mark.tool === "magnifier") {
      const padding = canvas.padding ?? 0,
        other = mark[handle.end === "from" ? "to" : "from"];
      const maxWidth = Math.min(
          canvas.width - padding * 2,
          (canvas.width - mark.at.x) / mark.scale,
        ),
        maxHeight = Math.min(
          canvas.height - padding * 2,
          (canvas.height - mark.at.y) / mark.scale,
        );
      // Keep source corners distinct while allowing reversed source rectangles.
      const sourceAxis = (
        value: number,
        anchor: number,
        max: number,
        limit: number,
      ) => {
        const low = Math.max(padding, anchor - max),
          high = Math.min(limit - padding, anchor + max);
        const next = clamp(value, low, high),
          minimum = Math.min(1, max);
        if (Math.abs(next - anchor) >= minimum) return next;
        return anchor + minimum <= high ? anchor + minimum : anchor - minimum;
      };
      return {
        ...mark,
        [handle.end]: {
          x: sourceAxis(at.x, other.x, maxWidth, canvas.width),
          y: sourceAxis(at.y, other.y, maxHeight, canvas.height),
        },
      };
    }
    if (
      mark.tool !== "line" &&
      mark.tool !== "arrow" &&
      mark.tool !== "callout"
    )
      return mark;
    return { ...mark, [handle.end]: at };
  }
  if (handle.kind === "node" || handle.kind === "control") {
    if (mark.tool !== "path") return mark;
    const node = mark.nodes[handle.index];
    if (!node) return mark;
    let changed: AnnotationNode;
    if (handle.kind === "node") {
      const bounds = pointBounds([
        node,
        ...(node.in ? [node.in] : []),
        ...(node.out ? [node.out] : []),
      ]);
      const dx = moveDelta(at.x - node.x, bounds.x, bounds.width, canvas.width),
        dy = moveDelta(at.y - node.y, bounds.y, bounds.height, canvas.height);
      changed = mapNode(node, (point) => ({
        x: point.x + dx,
        y: point.y + dy,
      }));
    } else {
      const opposite = handle.side === "in" ? "out" : "in";
      changed = { ...node, [handle.side]: at };
      if (node.kind === "smooth" && node[opposite]) {
        const length = distance(node, node[opposite]);
        if (distance(node, at) > 0)
          changed[opposite] = rayPoint(
            node,
            node.x - at.x,
            node.y - at.y,
            length,
            canvas,
          );
      }
    }
    return {
      ...mark,
      nodes: mark.nodes.map((value, index) =>
        index === handle.index ? changed : value,
      ),
    };
  }
  if (mark.tool === "magnifier") {
    const bounds = markBounds(mark),
      west = handle.edge.includes("w"),
      north = handle.edge.includes("n"),
      horizontal = west || handle.edge.includes("e"),
      vertical = north || handle.edge.includes("s"),
      anchorX = west ? bounds.x + bounds.width : bounds.x,
      anchorY = north ? bounds.y + bounds.height : bounds.y,
      sourceWidth = Math.abs(mark.to.x - mark.from.x),
      sourceHeight = Math.abs(mark.to.y - mark.from.y);
    const scale = clamp(
      Math.min(
        horizontal ? Math.abs(at.x - anchorX) / sourceWidth : Infinity,
        vertical ? Math.abs(at.y - anchorY) / sourceHeight : Infinity,
        (horizontal && at.x < anchorX ? anchorX : canvas.width - anchorX) /
          sourceWidth,
        (vertical && at.y < anchorY ? anchorY : canvas.height - anchorY) /
          sourceHeight,
      ),
      1,
      ANNOTATION_LIMITS.maxMagnifierScale,
    );
    return {
      ...mark,
      scale,
      at: {
        x: clamp(
          west ? anchorX - sourceWidth * scale : anchorX,
          0,
          canvas.width - sourceWidth * scale,
        ),
        y: clamp(
          north ? anchorY - sourceHeight * scale : anchorY,
          0,
          canvas.height - sourceHeight * scale,
        ),
      },
    };
  }
  if (mark.tool === "text")
    return resizeText(mark, handle, at, canvas, measure);
  if (
    mark.tool !== "pen" &&
    mark.tool !== "highlighter" &&
    mark.tool !== "rectangle" &&
    mark.tool !== "ellipse" &&
    mark.tool !== "triangle"
  )
    return mark;
  const bounds = markBounds(mark, measure);
  let left = bounds.x,
    right = bounds.x + bounds.width,
    top = bounds.y,
    bottom = bounds.y + bounds.height;
  if (handle.edge.includes("w")) left = at.x;
  if (handle.edge.includes("e")) right = at.x;
  if (handle.edge.includes("n")) top = at.y;
  if (handle.edge.includes("s")) bottom = at.y;
  const transform = (point: AnnotationPoint) => ({
    x: bounds.width
      ? left + ((point.x - bounds.x) / bounds.width) * (right - left)
      : left,
    y: bounds.height
      ? top + ((point.y - bounds.y) / bounds.height) * (bottom - top)
      : top,
  });
  if (mark.tool === "pen" || mark.tool === "highlighter")
    return { ...mark, points: mark.points.map(transform) };
  // Give collapsed boxes distinct endpoints so they can expand again.
  const from = transform(mark.from),
    to = transform(mark.to);
  if (!bounds.width) to.x = right;
  if (!bounds.height) to.y = bottom;
  if (mark.tool === "rectangle")
    return {
      ...mark,
      from,
      to,
      radius: Math.min(
        mark.radius,
        Math.abs(right - left) / 2,
        Math.abs(bottom - top) / 2,
      ),
    };
  return { ...mark, from, to };
}

export function smoothNode(
  mark: PathMark,
  index: number,
  smooth: boolean,
  canvas: CanvasSize,
): PathMark {
  const node = mark.nodes[index];
  if (!node) return mark;
  let changed: AnnotationNode;
  if (!smooth) {
    changed = { x: node.x, y: node.y, kind: "corner" };
  } else {
    const count = mark.nodes.length,
      previous =
        index > 0
          ? mark.nodes[index - 1]
          : mark.closed
            ? mark.nodes[count - 1]
            : undefined,
      next =
        index + 1 < count
          ? mark.nodes[index + 1]
          : mark.closed
            ? mark.nodes[0]
            : undefined;
    let dx = (next ?? node).x - (previous ?? node).x,
      dy = (next ?? node).y - (previous ?? node).y;
    if (!Math.hypot(dx, dy)) {
      dx = (next ?? node).x - node.x || node.x - (previous ?? node).x;
      dy = (next ?? node).y - node.y || node.y - (previous ?? node).y;
    }
    changed = { x: node.x, y: node.y, kind: "smooth" };
    if (previous)
      changed.in = rayPoint(
        node,
        -dx,
        -dy,
        distance(previous, node) / 3,
        canvas,
      );
    if (next)
      changed.out = rayPoint(node, dx, dy, distance(node, next) / 3, canvas);
  }
  return {
    ...mark,
    nodes: mark.nodes.map((value, position) =>
      position === index ? changed : value,
    ),
  };
}

export function insertPathNode(
  mark: PathMark,
  index: number,
  t: number,
): PathMark {
  const count = mark.nodes.length;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count ||
    (!mark.closed && index === count - 1) ||
    count < 2
  )
    return mark;
  t = Number.isNaN(t) ? 0 : clamp(t, 0, 1);
  const end = (index + 1) % count,
    from = mark.nodes[index]!,
    to = mark.nodes[end]!;
  const nodes = mark.nodes.slice();
  let inserted: AnnotationNode;
  if (!from.out && !to.in) {
    inserted = { ...mix(from, to, t), kind: "corner" };
  } else {
    const a = mix(from, from.out ?? from, t),
      b = mix(from.out ?? from, to.in ?? to, t),
      c = mix(to.in ?? to, to, t),
      d = mix(a, b, t),
      e = mix(b, c, t);
    inserted = { ...mix(d, e, t), kind: "smooth", in: d, out: e };
    nodes[index] = { ...from, out: a };
    nodes[end] = { ...to, in: c };
  }
  nodes.splice(index + 1, 0, inserted);
  return { ...mark, nodes };
}

function segmentParameter(
  at: AnnotationPoint,
  from: AnnotationPoint,
  to: AnnotationPoint,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    square = dx * dx + dy * dy;
  return square
    ? clamp(((at.x - from.x) * dx + (at.y - from.y) * dy) / square, 0, 1)
    : 0;
}

function segmentDistance(
  at: AnnotationPoint,
  from: AnnotationPoint,
  to: AnnotationPoint,
) {
  const t = segmentParameter(at, from, to);
  return Math.hypot(
    at.x - from.x - t * (to.x - from.x),
    at.y - from.y - t * (to.y - from.y),
  );
}

function hitCubic(
  at: AnnotationPoint,
  a: AnnotationPoint,
  b: AnnotationPoint,
  c: AnnotationPoint,
  d: AnnotationPoint,
  radius: number,
  accuracy: number,
  depth = 0,
): boolean {
  // A control-point hull cheaply rejects distant curves, including loops.
  if (
    at.x < Math.min(a.x, b.x, c.x, d.x) - radius ||
    at.x > Math.max(a.x, b.x, c.x, d.x) + radius ||
    at.y < Math.min(a.y, b.y, c.y, d.y) - radius ||
    at.y > Math.max(a.y, b.y, c.y, d.y) + radius
  )
    return false;
  if (
    depth === 16 ||
    Math.max(segmentDistance(b, a, d), segmentDistance(c, a, d)) <= accuracy
  )
    return segmentDistance(at, a, d) <= radius;
  const ab = mix(a, b, 0.5),
    bc = mix(b, c, 0.5),
    cd = mix(c, d, 0.5),
    abc = mix(ab, bc, 0.5),
    bcd = mix(bc, cd, 0.5),
    middle = mix(abc, bcd, 0.5);
  return (
    hitCubic(at, a, ab, abc, middle, radius, accuracy, depth + 1) ||
    hitCubic(at, middle, bcd, cd, d, radius, accuracy, depth + 1)
  );
}

/** Find an insertion parameter on the centerline, independent of zoom and stroke width. */
export function nearestPathSegment(
  mark: PathMark,
  at: AnnotationPoint,
  tolerance: number,
): { index: number; t: number } | null {
  tolerance = Math.max(0, tolerance);
  const accuracy = Math.max(1e-8, Math.min(1e-4, tolerance / 64));
  let nearest: { index: number; t: number } | null = null,
    best = tolerance;
  function consider(index: number, t: number, point: AnnotationPoint) {
    const separation = distance(at, point);
    if (separation <= best) {
      best = separation;
      nearest = { index, t };
    }
  }
  function visit(
    index: number,
    a: AnnotationPoint,
    b: AnnotationPoint,
    c: AnnotationPoint,
    d: AnnotationPoint,
    start: number,
    end: number,
    depth: number,
  ) {
    const dx = Math.max(
        Math.min(a.x, b.x, c.x, d.x) - at.x,
        0,
        at.x - Math.max(a.x, b.x, c.x, d.x),
      ),
      dy = Math.max(
        Math.min(a.y, b.y, c.y, d.y) - at.y,
        0,
        at.y - Math.max(a.y, b.y, c.y, d.y),
      );
    if (Math.hypot(dx, dy) > best) return;
    const t = segmentParameter(at, a, d),
      abAt = mix(a, b, t),
      bcAt = mix(b, c, t),
      cdAt = mix(c, d, t);
    consider(
      index,
      start + (end - start) * t,
      mix(mix(abAt, bcAt, t), mix(bcAt, cdAt, t), t),
    );
    // Geometric flatness alone loses t on collinear, non-uniform cubics.
    // Bound the error against a linearly parameterized chord instead.
    if (
      depth === 24 ||
      Math.max(distance(b, mix(a, d, 1 / 3)), distance(c, mix(a, d, 2 / 3))) <=
        accuracy
    )
      return;
    const ab = mix(a, b, 0.5),
      bc = mix(b, c, 0.5),
      cd = mix(c, d, 0.5),
      abc = mix(ab, bc, 0.5),
      bcd = mix(bc, cd, 0.5),
      middle = mix(abc, bcd, 0.5),
      half = (start + end) / 2;
    if (distance(at, a) <= distance(at, d)) {
      visit(index, a, ab, abc, middle, start, half, depth + 1);
      visit(index, middle, bcd, cd, d, half, end, depth + 1);
    } else {
      visit(index, middle, bcd, cd, d, half, end, depth + 1);
      visit(index, a, ab, abc, middle, start, half, depth + 1);
    }
  }
  for (
    let index = 0;
    index < mark.nodes.length - (mark.closed ? 0 : 1);
    index++
  ) {
    const from = mark.nodes[index]!,
      to = mark.nodes[(index + 1) % mark.nodes.length]!;
    if (from.out || to.in)
      visit(index, from, from.out ?? from, to.in ?? to, to, 0, 1, 0);
    else {
      const t = segmentParameter(at, from, to);
      consider(index, t, mix(from, to, t));
    }
  }
  return nearest;
}

function arrowHead(
  mark: { from: AnnotationPoint; to: AnnotationPoint; width: number },
  sourceScale = 1,
) {
  const angle = Math.atan2(mark.to.y - mark.from.y, mark.to.x - mark.from.x),
    length = Math.min(
      distance(mark.from, mark.to),
      Math.max(10 * sourceScale, mark.width * 4),
    );
  return [
    {
      x: mark.to.x - length * Math.cos(angle - Math.PI / 6),
      y: mark.to.y - length * Math.sin(angle - Math.PI / 6),
    },
    {
      x: mark.to.x - length * Math.cos(angle + Math.PI / 6),
      y: mark.to.y - length * Math.sin(angle + Math.PI / 6),
    },
  ] as const;
}

function insidePolygon(
  at: AnnotationPoint,
  points: AnnotationPoint[],
): boolean {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    const cross = (b.x - a.x) * (at.y - a.y) - (at.x - a.x) * (b.y - a.y);
    if (a.y <= at.y && b.y > at.y && cross > 0) winding++;
    else if (a.y > at.y && b.y <= at.y && cross < 0) winding--;
  }
  return winding !== 0;
}

function pathPolygon(mark: PathMark, accuracy: number): AnnotationPoint[] {
  const points: AnnotationPoint[] = [];
  function flatten(
    a: AnnotationPoint,
    b: AnnotationPoint,
    c: AnnotationPoint,
    d: AnnotationPoint,
    depth = 0,
  ) {
    if (
      depth === 16 ||
      Math.max(segmentDistance(b, a, d), segmentDistance(c, a, d)) <= accuracy
    ) {
      points.push(d);
      return;
    }
    const ab = mix(a, b, 0.5),
      bc = mix(b, c, 0.5),
      cd = mix(c, d, 0.5),
      abc = mix(ab, bc, 0.5),
      bcd = mix(bc, cd, 0.5),
      middle = mix(abc, bcd, 0.5);
    flatten(a, ab, abc, middle, depth + 1);
    flatten(middle, bcd, cd, d, depth + 1);
  }
  if (mark.nodes[0]) points.push(mark.nodes[0]);
  for (let i = 0; i < mark.nodes.length - (mark.closed ? 0 : 1); i++) {
    const a = mark.nodes[i]!,
      d = mark.nodes[(i + 1) % mark.nodes.length]!;
    flatten(a, a.out ?? a, d.in ?? d, d);
  }
  return points;
}

export function hitMark(
  mark: AnnotationMark,
  at: AnnotationPoint,
  tolerance: number,
  measure?: MeasureText,
  sourceScale = 1,
): boolean {
  tolerance = Math.max(0, tolerance);
  if (mark.tool === "text") {
    const bounds = markBounds(mark, measure);
    return (
      (mark.target !== undefined &&
        segmentDistance(at, mark.target, {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        }) <=
          tolerance + Math.max(1, sourceScale)) ||
      (at.x >= bounds.x - tolerance &&
        at.x <= bounds.x + bounds.width + tolerance &&
        at.y >= bounds.y - tolerance &&
        at.y <= bounds.y + bounds.height + tolerance)
    );
  }
  const radius = tolerance + mark.width / 2,
    accuracy = Math.max(0.01, Math.min(0.25, radius / 4));
  const hit = (a: AnnotationPoint, b: AnnotationPoint) =>
    segmentDistance(at, a, b) <= radius;
  if (mark.tool === "callout") {
    const [left, right] = arrowHead(mark, sourceScale);
    if (hit(left, mark.to) || hit(mark.to, right)) return true;
    if (
      distance(at, mark.from) <= mark.size / 2 + tolerance ||
      hit(mark.from, mark.to)
    )
      return true;
    if (!mark.label) return false;
    const label = calloutLabel(mark, measure);
    return (
      at.x >= label.x - tolerance &&
      at.x <= label.x + label.width + tolerance &&
      at.y >= label.y - tolerance &&
      at.y <= label.y + label.height + tolerance
    );
  }
  if (mark.tool === "magnifier") {
    const bounds = markBounds(mark),
      source = pointBounds([mark.from, mark.to]),
      center = {
        x: source.x + source.width / 2,
        y: source.y + source.height / 2,
      },
      destination = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
    if (
      at.x >= bounds.x - tolerance &&
      at.x <= bounds.x + bounds.width + tolerance &&
      at.y >= bounds.y - tolerance &&
      at.y <= bounds.y + bounds.height + tolerance
    )
      return true;
    if (hit(center, destination)) return true;
    return (
      hit(
        { x: source.x, y: source.y },
        { x: source.x + source.width, y: source.y },
      ) ||
      hit(
        { x: source.x + source.width, y: source.y },
        { x: source.x + source.width, y: source.y + source.height },
      ) ||
      hit(
        { x: source.x, y: source.y + source.height },
        { x: source.x + source.width, y: source.y + source.height },
      ) ||
      hit(
        { x: source.x, y: source.y },
        { x: source.x, y: source.y + source.height },
      )
    );
  }
  if (mark.tool === "pen" || mark.tool === "highlighter") {
    if (mark.points.length === 1)
      return distance(at, mark.points[0]!) <= radius;
    for (let i = 1; i < mark.points.length; i++)
      if (hit(mark.points[i - 1]!, mark.points[i]!)) return true;
    return false;
  }
  if (mark.tool === "path") {
    const count = mark.nodes.length;
    if (
      mark.fill &&
      (mark.opacity ?? 1) > 0 &&
      insidePolygon(at, pathPolygon(mark, accuracy))
    )
      return true;
    if (count === 1) return distance(at, mark.nodes[0]!) <= radius;
    for (let i = 0; i < count - (mark.closed ? 0 : 1); i++) {
      const from = mark.nodes[i]!,
        to = mark.nodes[(i + 1) % count]!;
      if (from.out || to.in) {
        if (
          hitCubic(
            at,
            from,
            from.out ?? from,
            to.in ?? to,
            to,
            radius,
            accuracy,
          )
        )
          return true;
      } else if (hit(from, to)) return true;
    }
    return false;
  }
  if (mark.tool === "line" || mark.tool === "arrow") {
    if (hit(mark.from, mark.to)) return true;
    if (mark.tool === "line") return false;
    const [left, right] = arrowHead(mark, sourceScale);
    return hit(left, mark.to) || hit(mark.to, right);
  }
  const { x, y, width, height } = markBounds(mark),
    right = x + width,
    bottom = y + height;
  if (mark.tool === "triangle") {
    const top = { x: x + width / 2, y },
      left = { x, y: bottom },
      end = { x: right, y: bottom };
    if (
      mark.fill &&
      (mark.opacity ?? 1) > 0 &&
      insidePolygon(at, [top, left, end])
    )
      return true;
    return hit(top, left) || hit(left, end) || hit(end, top);
  }
  if (mark.tool === "ellipse") {
    if (!width || !height) return hit({ x, y }, { x: right, y: bottom });
    const rx = width / 2,
      ry = height / 2,
      cx = x + rx,
      cy = y + ry;
    if (
      mark.fill &&
      (mark.opacity ?? 1) > 0 &&
      ((at.x - cx) / rx) ** 2 + ((at.y - cy) / ry) ** 2 <= 1
    )
      return true;
    // Sagitta-bounded sampling keeps eccentric and large ellipses selectable.
    const steps = Math.max(
      16,
      Math.ceil(
        Math.PI / Math.acos(1 - Math.min(1, accuracy / Math.max(rx, ry))),
      ),
    );
    let previous = { x: right, y: cy };
    for (let i = 1; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2,
        next = { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
      if (hit(previous, next)) return true;
      previous = next;
    }
    return false;
  }
  const corner = Math.min(mark.radius, width / 2, height / 2);
  if (
    mark.fill &&
    (mark.opacity ?? 1) > 0 &&
    at.x >= x &&
    at.x <= right &&
    at.y >= y &&
    at.y <= bottom
  ) {
    const cx = clamp(at.x, x + corner, right - corner),
      cy = clamp(at.y, y + corner, bottom - corner);
    if (Math.hypot(at.x - cx, at.y - cy) <= corner) return true;
  }
  if (
    hit({ x: x + corner, y }, { x: right - corner, y }) ||
    hit({ x: right, y: y + corner }, { x: right, y: bottom - corner }) ||
    hit({ x: right - corner, y: bottom }, { x: x + corner, y: bottom }) ||
    hit({ x, y: bottom - corner }, { x, y: y + corner })
  )
    return true;
  if (!corner) return false;
  const cx = at.x < x + width / 2 ? x + corner : right - corner,
    cy = at.y < y + height / 2 ? y + corner : bottom - corner;
  const onArc =
    (at.x <= x + corner || at.x >= right - corner) &&
    (at.y <= y + corner || at.y >= bottom - corner);
  return onArc && Math.abs(Math.hypot(at.x - cx, at.y - cy) - corner) <= radius;
}

function contrastInk(color: string): string {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

function paintFill(
  ctx: CanvasRenderingContext2D,
  mark: { fill?: string; opacity?: number },
) {
  if (!mark.fill) return;
  ctx.save();
  ctx.fillStyle = mark.fill;
  ctx.globalAlpha *= mark.opacity ?? 1;
  ctx.fill();
  ctx.restore();
}

/** Draw only saved geometry: selection handles and control guides are editor-only. */
export function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: AnnotationMark,
  sourceScale = 1,
  source?: { image: CanvasImageSource; padding: number },
): void {
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (mark.tool === "text") {
    const measure: MeasureText = (line) => ctx.measureText(line).width;
    ctx.font = mark.size + "px sans-serif";
    ctx.textBaseline = "top";
    const bounds = markBounds(mark, measure),
      padding = textPadding(mark);
    if (mark.target) {
      ctx.lineWidth = Math.max(1, sourceScale);
      ctx.beginPath();
      ctx.moveTo(mark.target.x, mark.target.y);
      ctx.lineTo(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      ctx.stroke();
    }
    if (mark.background) {
      ctx.fillStyle = mark.background;
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
    ctx.fillStyle = mark.color;
    textLines(mark, measure).forEach((line, index) => {
      const x = mark.at.x + padding,
        y = mark.at.y + padding + index * mark.size * 1.25;
      if (mark.outline) {
        ctx.strokeStyle = contrastInk(mark.color);
        ctx.lineWidth = Math.max(2 * sourceScale, mark.size * 0.12);
        ctx.strokeText(line, x, y);
      }
      ctx.fillText(line, x, y);
    });
  } else if (mark.tool === "callout") {
    ctx.lineWidth = mark.width;
    ctx.beginPath();
    ctx.moveTo(mark.from.x, mark.from.y);
    ctx.lineTo(mark.to.x, mark.to.y);
    const [left, right] = arrowHead(mark, sourceScale);
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(mark.to.x, mark.to.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mark.from.x, mark.from.y, mark.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = contrastInk(mark.color);
    ctx.font = "bold " + mark.size * 0.5 + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      String(mark.number),
      mark.from.x,
      mark.from.y,
      mark.size * 0.85,
    );
    if (mark.label) {
      ctx.font = mark.size * 0.5 + "px sans-serif";
      const label = calloutLabel(mark, (line) => ctx.measureText(line).width);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(label.x, label.y, label.width, label.height);
      ctx.strokeRect(label.x, label.y, label.width, label.height);
      ctx.fillStyle = "#111111";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      label.lines.forEach((line, index) =>
        ctx.fillText(
          line,
          label.x + label.padding,
          label.y + label.padding + index * label.size * 1.25,
        ),
      );
    }
  } else if (mark.tool === "magnifier") {
    const crop = pointBounds([mark.from, mark.to]),
      destination = markBounds(mark);
    ctx.lineWidth = mark.width;
    ctx.beginPath();
    ctx.moveTo(crop.x + crop.width / 2, crop.y + crop.height / 2);
    ctx.lineTo(
      destination.x + destination.width / 2,
      destination.y + destination.height / 2,
    );
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([5 * sourceScale, 3 * sourceScale]);
    ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    if (source)
      ctx.drawImage(
        source.image,
        crop.x - source.padding,
        crop.y - source.padding,
        crop.width,
        crop.height,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
      );
    ctx.strokeRect(
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );
  } else {
    ctx.lineWidth = mark.width;
    ctx.beginPath();
    if (mark.tool === "pen" || mark.tool === "highlighter") {
      if (mark.tool === "highlighter") ctx.globalAlpha *= mark.opacity;
      const first = mark.points[0];
      if (first && mark.points.length === 1) {
        ctx.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (first) {
        ctx.moveTo(first.x, first.y);
        for (let index = 1; index < mark.points.length; index++) {
          const point = mark.points[index]!;
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
    } else if (mark.tool === "path") {
      const first = mark.nodes[0];
      if (first) {
        ctx.moveTo(first.x, first.y);
        for (
          let index = 0;
          index < mark.nodes.length - (mark.closed ? 0 : 1);
          index++
        ) {
          const from = mark.nodes[index]!,
            to = mark.nodes[(index + 1) % mark.nodes.length]!;
          if (from.out || to.in)
            ctx.bezierCurveTo(
              (from.out ?? from).x,
              (from.out ?? from).y,
              (to.in ?? to).x,
              (to.in ?? to).y,
              to.x,
              to.y,
            );
          else ctx.lineTo(to.x, to.y);
        }
        if (mark.closed) ctx.closePath();
        paintFill(ctx, mark);
        ctx.stroke();
      }
    } else if (mark.tool === "line" || mark.tool === "arrow") {
      ctx.moveTo(mark.from.x, mark.from.y);
      ctx.lineTo(mark.to.x, mark.to.y);
      if (mark.tool === "arrow") {
        const [left, right] = arrowHead(mark, sourceScale);
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(mark.to.x, mark.to.y);
        ctx.lineTo(right.x, right.y);
      }
      ctx.stroke();
    } else {
      const { x, y, width, height } = markBounds(mark);
      if (mark.tool === "rectangle")
        ctx.roundRect(
          x,
          y,
          width,
          height,
          Math.min(mark.radius, width / 2, height / 2),
        );
      else if (mark.tool === "ellipse") {
        if (!width || !height) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + width, y + height);
        } else
          ctx.ellipse(
            x + width / 2,
            y + height / 2,
            width / 2,
            height / 2,
            0,
            0,
            Math.PI * 2,
          );
      } else {
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x + width, y + height);
        ctx.lineTo(x, y + height);
        ctx.closePath();
      }
      paintFill(ctx, mark);
      ctx.stroke();
    }
  }
  ctx.restore();
}
