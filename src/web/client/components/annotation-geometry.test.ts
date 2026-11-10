import { describe, expect, test } from "bun:test";
import {
  ANNOTATION_LIMITS,
  type AnnotationMark,
  type AnnotationNode,
  type AnnotationPoint,
} from "../../../shared/web-annotation.ts";
import {
  drawMark,
  editHandle,
  hitMark,
  insertPathNode,
  markBounds,
  markHandles,
  moveMark,
  nearestPathSegment,
  smoothNode,
  textLines,
  type AnnotationHandle,
} from "./annotation-geometry.ts";

type PathMark = Extract<AnnotationMark, { tool: "path" }>;
const canvas = { width: 200, height: 150 };
const color = "#ef4444";
const path = (nodes: AnnotationNode[], closed = false): PathMark => ({
  tool: "path",
  color,
  width: 2,
  nodes,
  closed,
});
const node = (x: number, y: number): AnnotationNode => ({
  x,
  y,
  kind: "corner",
});
const resize = (
  edge: Extract<AnnotationHandle, { kind: "resize" }>["edge"],
): AnnotationHandle => ({
  kind: "resize",
  edge,
  x: 0,
  y: 0,
});
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}
function expectPoint(actual: AnnotationPoint, expected: AnnotationPoint) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}
function expectInside(mark: AnnotationMark, size = canvas) {
  const bounds = markBounds(mark);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
}
// An independent Bernstein evaluation detects changes to the whole curve, not
// merely whether the split inserted a point lying somewhere on it.
function cubic(
  from: AnnotationNode,
  to: AnnotationNode,
  t: number,
): AnnotationPoint {
  const a = from.out ?? from,
    b = to.in ?? to,
    s = 1 - t;
  return {
    x:
      s ** 3 * from.x +
      3 * s ** 2 * t * a.x +
      3 * s * t ** 2 * b.x +
      t ** 3 * to.x,
    y:
      s ** 3 * from.y +
      3 * s ** 2 * t * a.y +
      3 * s * t ** 2 * b.y +
      t ** 3 * to.y,
  };
}

const rectangle: Extract<AnnotationMark, { tool: "rectangle" }> = {
  tool: "rectangle",
  color,
  width: 2,
  radius: 8,
  from: { x: 20, y: 30 },
  to: { x: 80, y: 70 },
};
const text: Extract<AnnotationMark, { tool: "text" }> = {
  tool: "text",
  color,
  at: { x: 20, y: 30 },
  size: 10,
  text: "abcd\nxy",
};

describe("editable bounds and handle ordering", () => {
  test("boxes and directional endpoints normalize reversed coordinates", () => {
    for (const tool of [
      "rectangle",
      "ellipse",
      "triangle",
      "line",
      "arrow",
    ] as const) {
      const mark = {
        ...rectangle,
        tool,
        from: rectangle.to,
        to: rectangle.from,
      };
      expect(markBounds(mark)).toEqual({ x: 20, y: 30, width: 60, height: 40 });
      const handles = markHandles(mark);
      if (tool === "line" || tool === "arrow") {
        expect(handles).toEqual([
          { kind: "endpoint", end: "from", x: 80, y: 70 },
          { kind: "endpoint", end: "to", x: 20, y: 30 },
        ]);
      } else {
        expect(handles).toEqual([
          { kind: "resize", edge: "nw", x: 20, y: 30 },
          { kind: "resize", edge: "n", x: 50, y: 30 },
          { kind: "resize", edge: "ne", x: 80, y: 30 },
          { kind: "resize", edge: "e", x: 80, y: 50 },
          { kind: "resize", edge: "se", x: 80, y: 70 },
          { kind: "resize", edge: "s", x: 50, y: 70 },
          { kind: "resize", edge: "sw", x: 20, y: 70 },
          { kind: "resize", edge: "w", x: 20, y: 50 },
        ]);
      }
    }
  });

  test("path bounds include absolute controls and node handles take precedence", () => {
    const mark = frozen(
      path([
        { ...node(40, 40), in: { x: 10, y: 20 }, out: { x: 40, y: 40 } },
        { ...node(80, 70), in: { x: 110, y: 100 } },
      ]),
    );
    expect(markBounds(mark)).toEqual({ x: 10, y: 20, width: 100, height: 80 });
    expect(markHandles(mark)).toEqual([
      { kind: "node", index: 0, x: 40, y: 40 },
      { kind: "node", index: 1, x: 80, y: 70 },
      { kind: "control", index: 0, side: "in", x: 10, y: 20 },
      { kind: "control", index: 0, side: "out", x: 40, y: 40 },
      { kind: "control", index: 1, side: "in", x: 110, y: 100 },
    ]);
  });

  test("multiline text uses measured longest line and line height", () => {
    expect(markBounds(text)).toEqual({ x: 20, y: 30, width: 40, height: 25 });
    expect(markBounds(text, (line, size) => (line.length * size) / 2)).toEqual({
      x: 20,
      y: 30,
      width: 20,
      height: 25,
    });
    expect(markHandles(text)).toHaveLength(8);
    expect(markBounds({ ...text, text: "\n" })).toEqual({
      x: 20,
      y: 30,
      width: 1,
      height: 25,
    });
  });

  test("pen bounds include every sample and empty or collapsed geometry stays finite", () => {
    const pen = {
      tool: "pen",
      color,
      width: 2,
      points: [
        { x: 70, y: 10 },
        { x: 5, y: 90 },
        { x: 20, y: 20 },
      ],
    } as const;
    expect(markBounds({ ...pen, points: [...pen.points] })).toEqual({
      x: 5,
      y: 10,
      width: 65,
      height: 80,
    });
    for (const mark of [
      path([]),
      { tool: "pen", color, width: 2, points: [] } as AnnotationMark,
    ]) {
      expect(markBounds(mark)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(hitMark(mark, { x: 0, y: 0 }, 3)).toBe(false);
    }
    expect(markHandles({ ...rectangle, to: rectangle.from })).toHaveLength(8);
  });
});

describe("immutable movement within the output canvas", () => {
  test("all box tools and endpoints retain geometry at each canvas boundary", () => {
    for (const tool of [
      "rectangle",
      "ellipse",
      "triangle",
      "line",
      "arrow",
    ] as const) {
      const mark = frozen({ ...rectangle, tool });
      const moved = moveMark(mark, 1000, -1000, canvas);
      expect(markBounds(moved)).toEqual({
        x: 140,
        y: 0,
        width: 60,
        height: 40,
      });
      expectInside(moved);
      expect(mark.from).toEqual({ x: 20, y: 30 });
      expect(mark.to).toEqual({ x: 80, y: 70 });
    }
  });

  test("moving a path clamps the complete control hull, not just the nodes", () => {
    const mark = frozen(
      path([
        { ...node(30, 50), in: { x: 10, y: 20 }, out: { x: 60, y: 90 } },
        { ...node(90, 50), in: { x: 120, y: 40 } },
      ]),
    );
    const moved = moveMark(mark, -1000, 1000, canvas) as PathMark;
    expect(markBounds(moved)).toEqual({ x: 0, y: 80, width: 110, height: 70 });
    expect(moved.nodes[0]).toEqual({
      x: 20,
      y: 110,
      kind: "corner",
      in: { x: 0, y: 80 },
      out: { x: 50, y: 150 },
    });
    expect(moved.nodes[1]!.in).toEqual({ x: 110, y: 100 });
    expectInside(moved);
    expect(mark.nodes[0]!.in).toEqual({ x: 10, y: 20 });
  });

  test("pen shape and text layout are translated without resampling or resizing", () => {
    const mark = frozen({
      tool: "pen",
      color,
      width: 4,
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 10, y: 20 },
      ],
    } as AnnotationMark);
    const moved = moveMark(mark, 13, 17, canvas);
    expect(moved).toEqual({
      ...mark,
      points: [
        { x: 23, y: 37 },
        { x: 43, y: 57 },
        { x: 23, y: 37 },
      ],
    });
    expect(moveMark(frozen(text), 1000, 1000, canvas)).toEqual({
      ...text,
      at: { x: 160, y: 125 },
    });
    expect(
      moveMark(
        text,
        1000,
        1000,
        canvas,
        (line, size) => (line.length * size) / 2,
      ),
    ).toEqual({ ...text, at: { x: 180, y: 125 } });
  });

  test("oversize text stays anchored rather than acquiring negative coordinates", () => {
    const oversized = { ...text, text: "abcdefghij", size: 50 };
    const moved = moveMark(oversized, 1000, 1000, { width: 20, height: 20 });
    expect(moved).toEqual({ ...oversized, at: { x: 0, y: 0 } });
  });
});

describe("endpoint and bounding-box editing", () => {
  test("line and arrow endpoints edit independently and clamp to the canvas", () => {
    for (const tool of ["line", "arrow"] as const) {
      const mark = frozen({ ...rectangle, tool });
      expect(
        editHandle(
          mark,
          { kind: "endpoint", end: "from", x: 20, y: 30 },
          { x: -10, y: 200 },
          canvas,
        ),
      ).toEqual({
        ...mark,
        from: { x: 0, y: 150 },
      });
      expect(
        editHandle(
          mark,
          { kind: "endpoint", end: "to", x: 80, y: 70 },
          { x: 300, y: -10 },
          canvas,
        ),
      ).toEqual({
        ...mark,
        to: { x: 200, y: 0 },
      });
    }
  });

  test("every box edge keeps the opposite edge fixed, even across reversals", () => {
    const cases = [
      ["nw", { x: 100, y: 90 }, { x: 80, y: 70, width: 20, height: 20 }],
      ["n", { x: 1, y: 90 }, { x: 20, y: 70, width: 60, height: 20 }],
      ["ne", { x: 10, y: 90 }, { x: 10, y: 70, width: 10, height: 20 }],
      ["e", { x: 10, y: 1 }, { x: 10, y: 30, width: 10, height: 40 }],
      ["se", { x: 10, y: 20 }, { x: 10, y: 20, width: 10, height: 10 }],
      ["s", { x: 1, y: 20 }, { x: 20, y: 20, width: 60, height: 10 }],
      ["sw", { x: 100, y: 20 }, { x: 80, y: 20, width: 20, height: 10 }],
      ["w", { x: 100, y: 1 }, { x: 80, y: 30, width: 20, height: 40 }],
    ] as const;
    for (const tool of ["rectangle", "ellipse", "triangle"] as const) {
      for (const [edge, at, expected] of cases) {
        for (const reversed of [false, true]) {
          const mark = frozen({
            ...rectangle,
            tool,
            from: reversed ? rectangle.to : rectangle.from,
            to: reversed ? rectangle.from : rectangle.to,
          });
          const edited = editHandle(mark, resize(edge), at, canvas);
          expect(markBounds(edited)).toEqual(expected);
          expectInside(edited);
          if (edited.tool === "rectangle")
            expect(edited.radius).toBe(
              Math.min(8, expected.width / 2, expected.height / 2),
            );
        }
      }
    }
  });

  test("box resize clamps pointer coordinates and preserves reversed orientation", () => {
    const mark = frozen({
      ...rectangle,
      from: rectangle.to,
      to: rectangle.from,
    });
    const edited = editHandle(mark, resize("se"), { x: 500, y: -20 }, canvas);
    expect(edited).toEqual({
      ...mark,
      from: { x: 200, y: 0 },
      to: { x: 20, y: 30 },
      radius: 8,
    });
    expectInside(edited);
  });

  test("pen resize applies one affine transformation to every point and supports reflection", () => {
    const mark: AnnotationMark = frozen({
      tool: "pen",
      color,
      width: 5,
      points: [
        { x: 20, y: 30 },
        { x: 50, y: 40 },
        { x: 80, y: 70 },
      ],
    });
    expect(editHandle(mark, resize("se"), { x: 140, y: 110 }, canvas)).toEqual({
      ...mark,
      points: [
        { x: 20, y: 30 },
        { x: 80, y: 50 },
        { x: 140, y: 110 },
      ],
    });
    expect(editHandle(mark, resize("e"), { x: 0, y: 100 }, canvas)).toEqual({
      ...mark,
      points: [
        { x: 20, y: 30 },
        { x: 10, y: 40 },
        { x: 0, y: 70 },
      ],
    });
  });

  test("zero-size boxes expand and collapsed pen samples never produce NaN", () => {
    const collapsed = frozen({
      ...rectangle,
      from: { x: 20, y: 30 },
      to: { x: 20, y: 30 },
      radius: 0,
    });
    const edited = editHandle(
      collapsed,
      resize("se"),
      { x: 80, y: 70 },
      canvas,
    );
    expect(edited).toEqual({ ...collapsed, to: { x: 80, y: 70 } });
    const dot: AnnotationMark = frozen({
      tool: "pen",
      color,
      width: 4,
      points: [{ x: 20, y: 30 }],
    });
    const resized = editHandle(dot, resize("nw"), { x: -10, y: 80 }, canvas);
    expect(resized).toEqual({ ...dot, points: [{ x: 0, y: 80 }] });
    expectInside(resized);
  });

  test("text corner resize fits both dragged dimensions with a uniform font scale", () => {
    const edited = editHandle(
      frozen(text),
      resize("se"),
      { x: 100, y: 80 },
      canvas,
    );
    expect(edited).toEqual({ ...text, size: 20 });
    const constrained = editHandle(
      text,
      resize("se"),
      { x: 100, y: 55 },
      canvas,
    );
    expect(constrained).toEqual(text);
    const measured = editHandle(
      text,
      resize("e"),
      { x: 60, y: 55 },
      canvas,
      (line, size) => (line.length * size) / 2,
    );
    expect(measured).toEqual({ ...text, size: 20 });
  });

  test("text opposite corner is fixed through crossing and edge resizes", () => {
    const smaller = editHandle(text, resize("nw"), { x: 40, y: 42.5 }, canvas);
    expect(smaller).toEqual({ ...text, at: { x: 40, y: 42.5 }, size: 5 });
    const crossed = editHandle(text, resize("nw"), { x: 100, y: 80 }, canvas);
    expect(crossed).toEqual({ ...text, at: { x: 60, y: 55 }, size: 10 });
    expect(editHandle(text, resize("n"), { x: 0, y: 42.5 }, canvas)).toEqual({
      ...text,
      at: { x: 20, y: 42.5 },
      size: 5,
    });
    expect(editHandle(text, resize("w"), { x: 40, y: 0 }, canvas)).toEqual({
      ...text,
      at: { x: 40, y: 30 },
      size: 5,
    });
  });

  test("text font limits and output boundaries constrain resizing", () => {
    const tiny = editHandle(text, resize("se"), text.at, canvas);
    expect(tiny.tool === "text" && tiny.size).toBe(1);
    const large = { ...text, text: "x", size: 10, at: { x: 0, y: 0 } };
    const edited = editHandle(
      large,
      resize("se"),
      { x: 10000, y: 10000 },
      { width: 20000, height: 20000 },
    );
    expect(edited.tool === "text" && edited.size).toBe(
      ANNOTATION_LIMITS.maxTextSize,
    );
    const constrained = editHandle(
      text,
      resize("e"),
      { x: 200, y: 30 },
      canvas,
    );
    expectInside(constrained);
    expect(constrained.tool === "text" && constrained.size).toBe(45);
  });
});

describe("Bezier node and tangent editing", () => {
  test("node movement translates its controls together, limited by the control hull", () => {
    const mark = frozen(
      path([
        {
          ...node(40, 40),
          kind: "smooth",
          in: { x: 10, y: 20 },
          out: { x: 70, y: 60 },
        },
        node(100, 100),
      ]),
    );
    const edited = editHandle(
      mark,
      { kind: "node", index: 0, x: 40, y: 40 },
      { x: -100, y: 200 },
      canvas,
    ) as PathMark;
    expect(edited.nodes[0]).toEqual({
      x: 30,
      y: 130,
      kind: "smooth",
      in: { x: 0, y: 110 },
      out: { x: 60, y: 150 },
    });
    expect(edited.nodes[1]).toEqual(mark.nodes[1]);
    expectInside(edited);
  });

  test("corner controls move independently and clamp", () => {
    const mark = frozen(
      path([
        { ...node(50, 50), in: { x: 20, y: 50 }, out: { x: 70, y: 50 } },
        node(100, 100),
      ]),
    );
    const edited = editHandle(
      mark,
      { kind: "control", index: 0, side: "out", x: 70, y: 50 },
      { x: 300, y: -10 },
      canvas,
    ) as PathMark;
    expect(edited.nodes[0]).toEqual({
      ...mark.nodes[0],
      out: { x: 200, y: 0 },
    });
    expect(mark.nodes[0]!.out).toEqual({ x: 70, y: 50 });
  });

  test("smooth handles mirror direction while preserving the opposite handle's own length", () => {
    const mark = frozen(
      path([
        {
          ...node(80, 60),
          kind: "smooth",
          in: { x: 50, y: 60 },
          out: { x: 100, y: 60 },
        },
        node(150, 100),
      ]),
    );
    const edited = editHandle(
      mark,
      { kind: "control", index: 0, side: "out", x: 100, y: 60 },
      { x: 80, y: 90 },
      canvas,
    ) as PathMark;
    expectPoint(edited.nodes[0]!.in!, { x: 80, y: 30 });
    expect(edited.nodes[0]!.out).toEqual({ x: 80, y: 90 });
    const reverse = editHandle(
      mark,
      { kind: "control", index: 0, side: "in", x: 50, y: 60 },
      { x: 50, y: 100 },
      canvas,
    ) as PathMark;
    expectPoint(reverse.nodes[0]!.out!, { x: 92, y: 44 });
  });

  test("canvas clipping shortens mirrored controls without bending their tangent axis", () => {
    const mark = frozen(
      path([
        {
          ...node(10, 10),
          kind: "smooth",
          in: { x: 100, y: 10 },
          out: { x: 20, y: 10 },
        },
        node(150, 100),
      ]),
    );
    const edited = editHandle(
      mark,
      { kind: "control", index: 0, side: "out", x: 20, y: 10 },
      { x: 20, y: 30 },
      canvas,
    ) as PathMark;
    expectPoint(edited.nodes[0]!.in!, { x: 5, y: 0 });
    expectInside(edited);
    const collapsed = editHandle(
      mark,
      { kind: "control", index: 0, side: "out", x: 20, y: 10 },
      { x: 10, y: 10 },
      canvas,
    ) as PathMark;
    expect(collapsed.nodes[0]!.in).toEqual(mark.nodes[0]!.in);
    expect(collapsed.nodes[0]!.out).toEqual({ x: 10, y: 10 });
  });

  test("smoothing interior nodes derives collinear controls from neighboring anchors", () => {
    const mark = frozen(path([node(10, 50), node(60, 50), node(110, 50)]));
    const smoothed = smoothNode(mark, 1, true, canvas);
    expect(smoothed.nodes[1]!.kind).toBe("smooth");
    expectPoint(smoothed.nodes[1]!.in!, { x: 60 - 50 / 3, y: 50 });
    expectPoint(smoothed.nodes[1]!.out!, { x: 60 + 50 / 3, y: 50 });
    expect(smoothNode(frozen(smoothed), 1, false, canvas)).toEqual(mark);
    expect(mark.nodes[1]).toEqual(node(60, 50));
  });

  test("open endpoints get only connected tangents while closed endpoints wrap", () => {
    const mark = frozen(path([node(40, 40), node(100, 40), node(100, 100)]));
    const first = smoothNode(mark, 0, true, canvas).nodes[0]!;
    expect(first.in).toBeUndefined();
    expectPoint(first.out!, { x: 60, y: 40 });
    const last = smoothNode(mark, 2, true, canvas).nodes[2]!;
    expect(last.out).toBeUndefined();
    expectPoint(last.in!, { x: 100, y: 80 });
    const closed = smoothNode({ ...mark, closed: true }, 0, true, canvas);
    expectPoint(closed.nodes[0]!.out!, { x: 40, y: 20 });
    expectPoint(closed.nodes[0]!.in!, {
      x: 40,
      y: 40 + Math.hypot(60, 60) / 3,
    });
  });

  test("smoothing at boundaries and repeated anchors never creates off-canvas or nonfinite controls", () => {
    for (const mark of [
      path([node(0, 0), node(50, 0), node(0, 50)], true),
      path([node(50, 50), node(50, 50), node(50, 50)]),
      path([node(50, 50), node(100, 100), node(50, 50)]),
    ]) {
      for (let index = 0; index < mark.nodes.length; index++) {
        const edited = smoothNode(frozen(mark), index, true, canvas);
        expectInside(edited);
        for (const handle of markHandles(edited)) {
          expect(Number.isFinite(handle.x)).toBe(true);
          expect(Number.isFinite(handle.y)).toBe(true);
        }
      }
    }
  });

  test("invalid node indices and incompatible handles leave the drawing unchanged", () => {
    const mark = frozen(path([node(20, 20), node(50, 50)]));
    expect(smoothNode(mark, 5, true, canvas)).toBe(mark);
    expect(
      editHandle(
        mark,
        { kind: "node", index: -1, x: 0, y: 0 },
        { x: 10, y: 10 },
        canvas,
      ),
    ).toBe(mark);
    expect(
      editHandle(
        rectangle,
        { kind: "node", index: 0, x: 0, y: 0 },
        { x: 10, y: 10 },
        canvas,
      ),
    ).toBe(rectangle);
    expect(editHandle(mark, resize("se"), { x: 10, y: 10 }, canvas)).toBe(mark);
  });
});

describe("exact immutable path subdivision", () => {
  const curve = frozen(
    path([
      {
        ...node(10, 20),
        kind: "smooth",
        in: { x: 0, y: 10 },
        out: { x: 180, y: 140 },
      },
      {
        ...node(150, 30),
        kind: "smooth",
        in: { x: 20, y: 130 },
        out: { x: 170, y: 10 },
      },
    ]),
  );

  test("De Casteljau insertion preserves every point on the original cubic", () => {
    for (const split of [0.13, 0.5, 0.87]) {
      const divided = insertPathNode(curve, 0, split);
      expect(divided.nodes).toHaveLength(3);
      expect(divided.nodes[1]!.kind).toBe("smooth");
      expect(divided.nodes[0]!.in).toEqual(curve.nodes[0]!.in);
      expect(divided.nodes[2]!.out).toEqual(curve.nodes[1]!.out);
      for (let step = 0; step <= 100; step++) {
        const t = step / 100;
        const actual =
          t <= split
            ? cubic(divided.nodes[0]!, divided.nodes[1]!, t / split)
            : cubic(
                divided.nodes[1]!,
                divided.nodes[2]!,
                (t - split) / (1 - split),
              );
        expectPoint(actual, cubic(curve.nodes[0]!, curve.nodes[1]!, t));
      }
      expectInside(divided);
    }
  });

  test("one-sided cubics are preserved, not silently converted into straight lines", () => {
    for (const nodes of [
      [{ ...node(10, 10), out: { x: 100, y: 140 } }, node(180, 10)],
      [node(10, 10), { ...node(180, 10), in: { x: 100, y: 140 } }],
    ]) {
      const mark = frozen(path(nodes));
      const divided = insertPathNode(mark, 0, 0.4);
      for (let step = 0; step <= 20; step++) {
        const t = step / 20;
        expectPoint(
          t <= 0.4
            ? cubic(divided.nodes[0]!, divided.nodes[1]!, t / 0.4)
            : cubic(divided.nodes[1]!, divided.nodes[2]!, (t - 0.4) / 0.6),
          cubic(nodes[0]!, nodes[1]!, t),
        );
      }
    }
  });

  test("straight segments insert a linear corner without inventing controls", () => {
    const mark = frozen(path([node(20, 30), node(100, 70)]));
    expect(insertPathNode(mark, 0, 0.25)).toEqual(
      path([node(20, 30), node(40, 40), node(100, 70)]),
    );
    expect(insertPathNode(mark, 0, -10).nodes[1]).toEqual(node(20, 30));
    expect(insertPathNode(mark, 0, 10).nodes[1]).toEqual(node(100, 70));
    expect(mark.nodes).toHaveLength(2);
  });

  test("closed final segments split without reordering the original first anchor", () => {
    const mark = frozen(
      path(
        [
          { ...node(20, 20), in: { x: 20, y: 80 } },
          node(140, 20),
          { ...node(100, 100), out: { x: 60, y: 130 } },
        ],
        true,
      ),
    );
    const divided = insertPathNode(mark, 2, 0.35);
    expect(divided.closed).toBe(true);
    expect(divided.nodes).toHaveLength(4);
    expectPoint(divided.nodes[0]!, mark.nodes[0]!);
    expect(divided.nodes[1]).toEqual(mark.nodes[1]);
    for (let step = 0; step <= 20; step++) {
      const t = step / 20;
      const actual =
        t <= 0.35
          ? cubic(divided.nodes[2]!, divided.nodes[3]!, t / 0.35)
          : cubic(divided.nodes[3]!, divided.nodes[0]!, (t - 0.35) / 0.65);
      expectPoint(actual, cubic(mark.nodes[2]!, mark.nodes[0]!, t));
    }
    expect(
      hitMark(divided, cubic(mark.nodes[2]!, mark.nodes[0]!, 0.35), 1),
    ).toBe(true);
  });

  test("endpoint splits retain the entire cubic and degenerate segments remain finite", () => {
    for (const t of [0, 1]) {
      const divided = insertPathNode(curve, 0, t);
      expectPoint(divided.nodes[1]!, curve.nodes[t]!);
      const segment = t === 0 ? 1 : 0;
      for (let step = 0; step <= 20; step++)
        expectPoint(
          cubic(
            divided.nodes[segment]!,
            divided.nodes[segment + 1]!,
            step / 20,
          ),
          cubic(curve.nodes[0]!, curve.nodes[1]!, step / 20),
        );
    }
    const mark = frozen(
      path([
        { ...node(30, 30), out: { x: 30, y: 30 } },
        { ...node(30, 30), in: { x: 30, y: 30 } },
      ]),
    );
    const divided = insertPathNode(mark, 0, 0.5);
    expect(divided.nodes[1]).toEqual({
      ...node(30, 30),
      kind: "smooth",
      in: { x: 30, y: 30 },
      out: { x: 30, y: 30 },
    });
    expectInside(divided);
  });

  test("invalid or nonsegment indices do not modify an open path", () => {
    for (const index of [-1, 0.5, 1, 2, 100])
      expect(insertPathNode(curve, index, 0.5)).toBe(curve);
  });
});

describe("stroke-aware selection", () => {
  test("diagonal lines and pen strokes do not select their empty bounding-box corners", () => {
    const line: AnnotationMark = {
      tool: "line",
      color,
      width: 4,
      from: { x: 20, y: 20 },
      to: { x: 100, y: 100 },
    };
    const pen: AnnotationMark = {
      tool: "pen",
      color,
      width: 4,
      points: [
        { x: 20, y: 20 },
        { x: 100, y: 100 },
        { x: 120, y: 30 },
      ],
    };
    for (const mark of [line, pen]) {
      expect(hitMark(mark, { x: 60, y: 60 }, 0)).toBe(true);
      expect(hitMark(mark, { x: 20, y: 90 }, 2)).toBe(false);
      expect(hitMark(mark, { x: 18, y: 20 }, 0)).toBe(true);
      expect(hitMark(mark, { x: 17, y: 20 }, 0)).toBe(false);
      expect(hitMark(mark, { x: 17, y: 20 }, 1)).toBe(true);
    }
  });

  test("hollow boxes, triangles and ellipses reject interiors but select real edges", () => {
    for (const mark of [
      { ...rectangle, radius: 0 },
      { ...rectangle, tool: "ellipse" } as AnnotationMark,
      { ...rectangle, tool: "triangle" } as AnnotationMark,
    ]) {
      expect(hitMark(mark, { x: 50, y: 50 }, 0)).toBe(false);
      expect(hitMark(mark, { x: 50, y: 70 }, 0)).toBe(true);
      expect(hitMark(mark, { x: 50, y: 30 }, 0)).toBe(true);
      expect(hitMark(mark, { x: 20, y: 30 }, 0)).toBe(
        mark.tool === "rectangle",
      );
    }
    const triangle: AnnotationMark = { ...rectangle, tool: "triangle" };
    expect(hitMark(triangle, { x: 35, y: 50 }, 0)).toBe(true);
    const ellipse: AnnotationMark = { ...rectangle, tool: "ellipse" };
    expect(hitMark(ellipse, { x: 80, y: 50 }, 0)).toBe(true);
  });

  test("rounded corners use their arc, not the square corner or its interior", () => {
    const mark = { ...rectangle, radius: 20 };
    expect(hitMark(mark, { x: 20, y: 30 }, 0)).toBe(false);
    expect(hitMark(mark, { x: 40, y: 30 }, 0)).toBe(true);
    expect(
      hitMark(
        mark,
        { x: 40 - 20 / Math.sqrt(2), y: 50 - 20 / Math.sqrt(2) },
        0,
      ),
    ).toBe(true);
    expect(hitMark(mark, { x: 30, y: 40 }, 0)).toBe(false);
    expect(hitMark(mark, { x: 22, y: 32 }, 7)).toBe(true);
  });

  test("arrow wings select outside the shaft and endpoint coordinate bounds", () => {
    const mark: AnnotationMark = {
      tool: "arrow",
      color,
      width: 2,
      from: { x: 20, y: 50 },
      to: { x: 100, y: 50 },
    };
    expect(hitMark(mark, { x: 100 - 5 * Math.sqrt(3), y: 55 }, 0)).toBe(true);
    expect(hitMark(mark, { x: 80, y: 55 }, 0)).toBe(false);
    expect(
      hitMark(
        { ...mark, tool: "line" },
        { x: 100 - 5 * Math.sqrt(3), y: 55 },
        0,
      ),
    ).toBe(false);
  });

  test("Bezier selection follows the actual curve, never its controls or chord", () => {
    const mark = path([
      { ...node(20, 20), out: { x: 20, y: 120 } },
      { ...node(120, 20), in: { x: 120, y: 120 } },
    ]);
    expect(hitMark(mark, { x: 70, y: 95 }, 0)).toBe(true);
    expect(hitMark(mark, { x: 70, y: 20 }, 0)).toBe(false);
    expect(hitMark(mark, { x: 20, y: 120 }, 1)).toBe(false);
    expect(hitMark(mark, { x: 70, y: 98 }, 3)).toBe(true);
  });

  test("closed paths select their closing segment, but still not their interior", () => {
    const mark = path([node(20, 20), node(100, 20), node(100, 100)]);
    expect(hitMark(mark, { x: 60, y: 60 }, 0)).toBe(false);
    expect(hitMark({ ...mark, closed: true }, { x: 60, y: 60 }, 0)).toBe(true);
    expect(hitMark({ ...mark, closed: true }, { x: 80, y: 50 }, 0)).toBe(false);
  });

  test("loops and collinear backtracking controls are not flattened into endpoint chords", () => {
    const loop = path([
      { ...node(50, 50), out: { x: 150, y: 140 } },
      { ...node(50, 50), in: { x: 0, y: 140 } },
    ]);
    expect(hitMark(loop, cubic(loop.nodes[0]!, loop.nodes[1]!, 0.5), 0)).toBe(
      true,
    );
    expect(hitMark(loop, { x: 100, y: 50 }, 0)).toBe(false);
    const backtrack = path([
      { ...node(50, 50), out: { x: 200, y: 50 } },
      { ...node(60, 50), in: { x: 200, y: 50 } },
    ]);
    expect(
      hitMark(
        backtrack,
        cubic(backtrack.nodes[0]!, backtrack.nodes[1]!, 0.5),
        0,
      ),
    ).toBe(true);
  });

  test("text hit selection uses its multiline measured bounds", () => {
    expect(hitMark(text, { x: 59, y: 54 }, 0)).toBe(true);
    expect(hitMark(text, { x: 60, y: 55 }, 0)).toBe(true);
    expect(hitMark(text, { x: 61, y: 55 }, 0)).toBe(false);
    expect(hitMark(text, { x: 61, y: 55 }, 1)).toBe(true);
    expect(
      hitMark(
        text,
        { x: 50, y: 40 },
        0,
        (line, size) => (line.length * size) / 2,
      ),
    ).toBe(false);
  });

  test("dots and zero-axis geometry retain round-stroke selection", () => {
    const pen: AnnotationMark = {
      tool: "pen",
      color,
      width: 8,
      points: [{ x: 40, y: 50 }],
    };
    expect(hitMark(pen, { x: 44, y: 50 }, 0)).toBe(true);
    expect(hitMark(pen, { x: 44.1, y: 50 }, 0)).toBe(false);
    for (const tool of [
      "line",
      "arrow",
      "rectangle",
      "ellipse",
      "triangle",
    ] as const) {
      const mark = {
        ...rectangle,
        tool,
        radius: 0,
        from: { x: 40, y: 20 },
        to: { x: 40, y: 100 },
      };
      expect(hitMark(mark, { x: 40, y: 60 }, 0)).toBe(true);
      expect(hitMark(mark, { x: 45, y: 60 }, 1)).toBe(false);
    }
    expect(
      hitMark(path([node(30, 30), node(30, 30)]), { x: 30, y: 30 }, 0),
    ).toBe(true);
  });
});

describe("nearest insertion segment", () => {
  test("straight segment projection returns linear insertion t, not cubic easing t", () => {
    const mark = frozen(path([node(20, 30), node(180, 110)]));
    const nearest = nearestPathSegment(mark, { x: 60, y: 50 }, 0.01);
    expect(nearest).toEqual({ index: 0, t: 0.25 });
    expect(insertPathNode(mark, nearest!.index, nearest!.t).nodes[1]).toEqual(
      node(60, 50),
    );
    expect(nearestPathSegment(mark, { x: 16, y: 28 }, 5)).toEqual({
      index: 0,
      t: 0,
    });
    expect(nearestPathSegment(mark, { x: 184, y: 112 }, 5)).toEqual({
      index: 0,
      t: 1,
    });
    expect(nearestPathSegment(mark, { x: 60, y: 80 }, 1)).toBeNull();
  });

  test("long curved segments remain insertable at high zoom between fixed sample parameters", () => {
    const mark = frozen(
      path([
        { ...node(10, 10), out: { x: 200, y: 16000 } },
        { ...node(16000, 16000), in: { x: 16000, y: 200 } },
      ]),
    );
    for (const t of [0.00371829, 0.31415926, 0.74823917, 0.99712345]) {
      const at = cubic(mark.nodes[0]!, mark.nodes[1]!, t);
      const nearest = nearestPathSegment(mark, at, 0.0005);
      expect(nearest).not.toBeNull();
      expect(nearest!.index).toBe(0);
      expect(nearest!.t).toBeCloseTo(t, 7);
      const inserted = insertPathNode(mark, nearest!.index, nearest!.t)
        .nodes[1]!;
      expect(Math.hypot(inserted.x - at.x, inserted.y - at.y)).toBeLessThan(
        0.0005,
      );
    }
  });

  test("collinear cubic controls retain their nonuniform parameterization", () => {
    const mark = frozen(
      path([
        { ...node(10, 20), out: { x: 10, y: 20 } },
        { ...node(190, 20), in: { x: 190, y: 20 } },
      ]),
    );
    const at = cubic(mark.nodes[0]!, mark.nodes[1]!, 0.2);
    const nearest = nearestPathSegment(mark, at, 0.0001);
    expect(nearest).not.toBeNull();
    expect(nearest!.t).toBeCloseTo(0.2, 7);
    expect(Math.abs(nearest!.t - (at.x - 10) / 180)).toBeGreaterThan(0.09);
  });

  test("closed segments wrap to the first node and open paths omit that segment", () => {
    const mark = frozen(path([node(20, 20), node(100, 20), node(100, 100)]));
    expect(nearestPathSegment(mark, { x: 60, y: 60 }, 0.01)).toBeNull();
    expect(
      nearestPathSegment({ ...mark, closed: true }, { x: 60, y: 60 }, 0.01),
    ).toEqual({ index: 2, t: 0.5 });
    const curved = frozen(
      path(
        [
          { ...node(20, 20), in: { x: 20, y: 100 } },
          node(150, 20),
          { ...node(100, 120), out: { x: 40, y: 140 } },
        ],
        true,
      ),
    );
    const at = cubic(curved.nodes[2]!, curved.nodes[0]!, 0.37);
    const nearest = nearestPathSegment(curved, at, 0.001);
    expect(nearest).not.toBeNull();
    expect(nearest!.index).toBe(2);
    expect(nearest!.t).toBeCloseTo(0.37, 6);
  });

  test("nearest means nearest across all segments, including loops and zero-length segments", () => {
    const mark = frozen(
      path([node(20, 20), node(100, 20), node(100, 40), node(20, 40)]),
    );
    expect(nearestPathSegment(mark, { x: 60, y: 37 }, 20)).toEqual({
      index: 2,
      t: 0.5,
    });
    const repeated = frozen(path([node(30, 30), node(30, 30)]));
    expect(nearestPathSegment(repeated, { x: 30, y: 30 }, 0)).toEqual({
      index: 0,
      t: 0,
    });
    expect(nearestPathSegment(path([]), { x: 0, y: 0 }, 100)).toBeNull();
    expect(
      nearestPathSegment(path([node(30, 30)]), { x: 30, y: 30 }, 100),
    ).toBeNull();
    const loop = frozen(
      path([
        { ...node(50, 50), out: { x: 180, y: 130 } },
        { ...node(50, 50), in: { x: 0, y: 140 } },
      ]),
    );
    const at = cubic(loop.nodes[0]!, loop.nodes[1]!, 0.37);
    const nearest = nearestPathSegment(loop, at, 0.001);
    expect(nearest).not.toBeNull();
    expect(nearest!.t).toBeCloseTo(0.37, 6);
  });

  test("scaled arrow wings hit the same geometry rendered on high-DPR captures", () => {
    const mark: AnnotationMark = {
      tool: "arrow",
      color,
      width: 2,
      from: { x: 20, y: 50 },
      to: { x: 100, y: 50 },
    };
    const wing = { x: 100 - 10 * Math.sqrt(3), y: 60 };
    expect(hitMark(mark, wing, 0)).toBe(false);
    expect(hitMark(mark, wing, 0, undefined, 2)).toBe(true);
    expect(hitMark({ ...mark, tool: "line" }, wing, 0, undefined, 2)).toBe(
      false,
    );
  });
});

const callout: Extract<AnnotationMark, { tool: "callout" }> = {
  tool: "callout",
  id: "45a655ed-8e1e-4f42-a59c-8a9e69ba81f3",
  number: 7,
  label: "",
  color: "#ffff00",
  width: 2,
  size: 24,
  from: { x: 40, y: 40 },
  to: { x: 100, y: 100 },
};
const magnifier: Extract<AnnotationMark, { tool: "magnifier" }> = {
  tool: "magnifier",
  color,
  width: 2,
  from: { x: 20, y: 20 },
  to: { x: 40, y: 35 },
  at: { x: 70, y: 80 },
  scale: 3,
};

describe("enhanced drawing geometry", () => {
  test("word wrapping preserves newlines, empty paragraphs and Unicode long runs using measured widths", () => {
    const measure = (line: string) => Array.from(line).length * 5;
    const mark = {
      ...text,
      text: "one two\n\nabcdef",
      wrap: 20,
      background: "#ffffff",
      target: { x: 180, y: 140 },
    };
    expect(textLines(mark, measure)).toEqual(["one", "two", "", "abcd", "ef"]);
    expect(markBounds(mark, measure)).toEqual({
      x: 20,
      y: 30,
      width: 28,
      height: 70.5,
    });
    expect(textLines({ ...mark, text: "😀😀😀", wrap: 10 }, measure)).toEqual([
      "😀😀",
      "😀",
    ]);
    expect(textLines({ ...mark, text: "a\n\n", wrap: 10 }, measure)).toEqual([
      "a",
      "",
      "",
    ]);
    const moved = moveMark(frozen(mark), 1000, 1000, canvas, measure);
    expect(markBounds(moved, measure)).toEqual({
      x: 172,
      y: 79.5,
      width: 28,
      height: 70.5,
    });
    expect(moved).toMatchObject({ target: { x: 180, y: 140 } });
    const target = markHandles(mark, measure)[0]!;
    expect(target).toEqual({ kind: "target", x: 180, y: 140 });
    expect(
      editHandle(mark, target, { x: 500, y: -100 }, canvas, measure),
    ).toMatchObject({ target: { x: 200, y: 0 }, at: mark.at });
    expect(hitMark(mark, { x: 150, y: 123 }, 4, measure)).toBe(true);
  });

  test("text scaling retains wrapping and anchored leaders without modifying the original", () => {
    const mark = frozen({
      ...text,
      text: "abcd efgh",
      wrap: 40,
      target: { x: 180, y: 140 },
    });
    const resized = editHandle(mark, resize("se"), { x: 100, y: 80 }, canvas);
    expect(resized.tool).toBe("text");
    if (resized.tool !== "text") throw new Error("Expected text");
    expect(resized.wrap! / resized.size).toBeCloseTo(mark.wrap / mark.size);
    expect(resized.target).toEqual(mark.target);
    expectInside(resized);
    expect(mark.size).toBe(10);
  });

  test("filled interiors are selectable while transparent fills and hollow empty spaces are not", () => {
    for (const tool of ["rectangle", "ellipse", "triangle"] as const) {
      const mark = { ...rectangle, tool };
      expect(hitMark(mark, { x: 50, y: 50 }, 0)).toBe(false);
      expect(
        hitMark(
          { ...mark, fill: "#ffff00", opacity: 0.3 },
          { x: 50, y: 50 },
          0,
        ),
      ).toBe(true);
      expect(
        hitMark({ ...mark, fill: "#ffff00", opacity: 0 }, { x: 50, y: 50 }, 0),
      ).toBe(false);
      expect(hitMark({ ...mark, fill: "#ffff00" }, { x: 0, y: 0 }, 0)).toBe(
        false,
      );
    }
    expect(
      hitMark({ ...rectangle, fill: "#ffff00" }, { x: 20, y: 30 }, 0),
    ).toBe(false);
    const curved = {
      ...path([
        { ...node(20, 80), out: { x: 20, y: 0 } },
        { ...node(100, 80), in: { x: 100, y: 0 } },
      ]),
      fill: "#ffff00",
      opacity: 0.5,
    };
    expect(hitMark(curved, { x: 60, y: 40 }, 0)).toBe(true);
    expect(hitMark({ ...curved, fill: undefined }, { x: 60, y: 40 }, 0)).toBe(
      false,
    );
    expect(hitMark(curved, { x: 60, y: 0 }, 0)).toBe(false);
  });

  test("highlighters retain sampled geometry and opacity under movement and resizing", () => {
    const mark = frozen({
      tool: "highlighter",
      color,
      width: 20,
      opacity: 0.25,
      points: [
        { x: 20, y: 30 },
        { x: 80, y: 50 },
      ],
    } as const);
    const mutable = { ...mark, points: [...mark.points] };
    expect(hitMark(mutable, { x: 50, y: 48 }, 0)).toBe(true);
    expect(hitMark(mutable, { x: 50, y: 70 }, 0)).toBe(false);
    expect(moveMark(mutable, 5, 10, canvas)).toMatchObject({
      opacity: 0.25,
      points: [
        { x: 25, y: 40 },
        { x: 85, y: 60 },
      ],
    });
    expect(
      editHandle(mutable, resize("se"), { x: 140, y: 70 }, canvas),
    ).toMatchObject({
      opacity: 0.25,
      points: [
        { x: 20, y: 30 },
        { x: 140, y: 70 },
      ],
    });
  });

  test("callout badge and leader select independently of empty bounding-box space and IDs survive edits", () => {
    expect(markHandles(callout)).toEqual([
      { kind: "endpoint", end: "from", x: 40, y: 40 },
      { kind: "endpoint", end: "to", x: 100, y: 100 },
    ]);
    expect(hitMark(callout, { x: 30, y: 40 }, 0)).toBe(true);
    expect(hitMark(callout, { x: 80, y: 80 }, 0)).toBe(true);
    const horizontal = {
      ...callout,
      from: { x: 20, y: 40 },
      to: { x: 120, y: 40 },
    };
    expect(hitMark(horizontal, { x: 111.34, y: 35 }, 0)).toBe(true);
    expect(hitMark(horizontal, { x: 110, y: 28 }, 0)).toBe(false);
    expect(hitMark(callout, { x: 30, y: 90 }, 0)).toBe(false);
    expect(hitMark({ ...callout, label: "Label" }, { x: 65, y: 40 }, 0)).toBe(
      true,
    );
    const moved = moveMark(frozen(callout), -1000, -1000, canvas);
    expectInside(moved);
    expect(moved).toMatchObject({ id: callout.id, number: 7 });
    expect(
      editHandle(callout, markHandles(callout)[1]!, { x: 200, y: 150 }, canvas),
    ).toMatchObject({
      id: callout.id,
      number: 7,
      from: callout.from,
      to: { x: 200, y: 150 },
    });
  });

  test("magnifier bounds describe the inset, movement preserves source, and source handles enforce padding and destination fit", () => {
    expect(markBounds(magnifier)).toEqual({
      x: 70,
      y: 80,
      width: 60,
      height: 45,
    });
    expect(markHandles(magnifier)).toHaveLength(10);
    const moved = moveMark(frozen(magnifier), 1000, -1000, canvas);
    expect(moved).toMatchObject({
      at: { x: 140, y: 0 },
      from: magnifier.from,
      to: magnifier.to,
      scale: 3,
    });
    expect(hitMark(magnifier, { x: 100, y: 100 }, 0)).toBe(true);
    expect(hitMark(magnifier, { x: 20, y: 25 }, 0)).toBe(true);
    expect(hitMark(magnifier, { x: 25, y: 25 }, 0)).toBe(false);
    const edited = editHandle(
      magnifier,
      markHandles(magnifier)[1]!,
      { x: 1000, y: 1000 },
      { ...canvas, padding: 20 },
    );
    if (edited.tool !== "magnifier") throw new Error("Expected magnifier");
    expect(edited.to.x).toBeCloseTo(20 + 130 / 3);
    expect(edited.to.y).toBeCloseTo(20 + 70 / 3);
    expectInside(edited);
    const origin = editHandle(
      magnifier,
      markHandles(magnifier)[0]!,
      { x: 0, y: 0 },
      { ...canvas, padding: 20 },
    );
    expect(origin).toMatchObject({ from: { x: 20, y: 20 } });
    const collapsed = editHandle(
      magnifier,
      markHandles(magnifier)[1]!,
      magnifier.from,
      { ...canvas, padding: 20 },
    );
    expect(collapsed).toMatchObject({ to: { x: 21, y: 21 } });
  });

  test("magnifier resize clamps enlargement and never changes or distorts the source rectangle", () => {
    for (const edge of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const) {
      const changed = editHandle(
        frozen(magnifier),
        resize(edge),
        { x: 1000, y: 1000 },
        canvas,
      );
      if (changed.tool !== "magnifier") throw new Error("Expected magnifier");
      expect(changed.from).toEqual(magnifier.from);
      expect(changed.to).toEqual(magnifier.to);
      expect(changed.scale).toBeGreaterThanOrEqual(1);
      expect(changed.scale).toBeLessThanOrEqual(8);
      expectInside(changed);
      expect(
        markBounds(changed).width / markBounds(changed).height,
      ).toBeCloseTo(20 / 15);
    }
  });
});

type PaintOperation = {
  name: string;
  args: unknown[];
  alpha: number;
  fill: unknown;
  stroke: unknown;
  lineWidth: unknown;
};
function recordingContext() {
  const operations: PaintOperation[] = [],
    stack: Record<string, unknown>[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
  };
  const ctx = new Proxy(state, {
    get(target, name: string) {
      if (name in target) return target[name];
      if (name === "measureText")
        return (line: string) => ({
          width:
            (Array.from(line).length *
              Number(String(target.font).match(/[\d.]+/)?.[0] ?? 10)) /
            2,
        });
      return (...args: unknown[]) => {
        operations.push({
          name,
          args,
          alpha: Number(target.globalAlpha),
          fill: target.fillStyle,
          stroke: target.strokeStyle,
          lineWidth: target.lineWidth,
        });
        if (name === "save") stack.push({ ...target });
        if (name === "restore") Object.assign(target, stack.pop());
      };
    },
    set(target, name: string, value: unknown) {
      target[name] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, operations, state };
}

describe("enhanced drawing painting", () => {
  test("shape transparency affects fill only and highlighter opacity affects the complete stroke", () => {
    const { ctx, operations, state } = recordingContext();
    drawMark(ctx, { ...rectangle, fill: "#ffff00", opacity: 0.25 });
    expect(operations.find((op) => op.name === "fill")).toMatchObject({
      alpha: 0.25,
      fill: "#ffff00",
    });
    expect(operations.find((op) => op.name === "stroke")).toMatchObject({
      alpha: 1,
      stroke: color,
    });
    drawMark(ctx, {
      tool: "highlighter",
      color: "#ffff00",
      width: 20,
      opacity: 0.4,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 30 },
      ],
    });
    expect(
      operations.filter((op) => op.name === "stroke").at(-1),
    ).toMatchObject({ alpha: 0.4 });
    expect(state.globalAlpha).toBe(1);
    drawMark(ctx, {
      tool: "highlighter",
      color: "#ffff00",
      width: 20,
      opacity: 0.2,
      points: [{ x: 10, y: 10 }],
    });
    expect(operations.filter((op) => op.name === "fill").at(-1)).toMatchObject({
      alpha: 0.2,
    });
  });

  test("text painting and bounds use identical wrapping and include background, contrast outline and leader", () => {
    const { ctx, operations } = recordingContext();
    const mark = {
      ...text,
      text: "one two\n\nabcdef",
      wrap: 20,
      background: "#ffffff",
      outline: true,
      target: { x: 180, y: 140 },
    };
    drawMark(ctx, mark, 2);
    const painted = operations.filter((op) => op.name === "fillText");
    expect(painted.map((op) => op.args[0])).toEqual([
      "one",
      "two",
      "",
      "abcd",
      "ef",
    ]);
    expect(painted[0]!.args.slice(1)).toEqual([24, 34]);
    expect(painted.at(-1)!.args.slice(1)).toEqual([24, 84]);
    expect(operations.find((op) => op.name === "fillRect")!.args).toEqual([
      20, 30, 28, 70.5,
    ]);
    expect(operations.find((op) => op.name === "moveTo")!.args).toEqual([
      180, 140,
    ]);
    expect(operations.filter((op) => op.name === "strokeText")).toHaveLength(5);
    expect(operations.find((op) => op.name === "strokeText")).toMatchObject({
      lineWidth: 4,
      stroke: "#000000",
    });
  });

  test("callout numbers contrast with their badge and labels render as readable text", () => {
    for (const [color, ink] of [
      ["#ffff00", "#000000"],
      ["#000088", "#ffffff"],
    ] as const) {
      const { ctx, operations } = recordingContext();
      drawMark(ctx, { ...callout, color, label: "Readable label" });
      expect(operations.find((op) => op.name === "fillText")).toMatchObject({
        fill: ink,
        args: ["7", 40, 40, 20.4],
      });
      expect(
        operations
          .filter((op) => op.name === "fillText")
          .slice(1)
          .map((op) => op.args[0]),
      ).toEqual(["Readable label"]);
      expect(operations.some((op) => op.name === "fillRect")).toBe(true);
    }
  });

  test("magnifiers draw one original-only crop using padding-correct coordinates, border and source guide", () => {
    const { ctx, operations } = recordingContext(),
      image = {} as CanvasImageSource;
    drawMark(ctx, { ...magnifier, from: magnifier.to, to: magnifier.from }, 2, {
      image,
      padding: 20,
    });
    expect(operations.filter((op) => op.name === "drawImage")).toHaveLength(1);
    expect(operations.find((op) => op.name === "drawImage")!.args).toEqual([
      image,
      0,
      0,
      20,
      15,
      70,
      80,
      60,
      45,
    ]);
    expect(
      operations.filter((op) => op.name === "strokeRect").map((op) => op.args),
    ).toEqual([
      [20, 20, 20, 15],
      [70, 80, 60, 45],
    ]);
    expect(operations.find((op) => op.name === "setLineDash")!.args).toEqual([
      [10, 6],
    ]);
  });
});
