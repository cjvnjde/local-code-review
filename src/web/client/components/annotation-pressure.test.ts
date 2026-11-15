import { expect, test } from "bun:test";
import {
  webAnnotation,
  type AnnotationMark,
} from "../../../shared/web-annotation.ts";
import { editHandle, moveMark } from "./annotation-geometry.ts";
import { pressureOutline, pressureStroke } from "./annotation-pressure.ts";

const pen = (): Extract<AnnotationMark, { tool: "pen" }> => ({
  tool: "pen",
  color: "#123456",
  width: 12,
  points: [
    { x: 20, y: 30 },
    { x: 40, y: 40 },
    { x: 80, y: 50 },
  ],
  stroke: { ...pressureStroke("pointer", 0.2), pressures: [0.2, 0.85, 0.1] },
});
test("saved pressure strokes regenerate exactly the same finite outline", () => {
  const original = pen();
  const clean = webAnnotation(
    JSON.parse(
      JSON.stringify({
        image: "images/a.png",
        width: 300,
        height: 200,
        padding: 0,
        marks: [original],
      }),
    ),
  )!;
  const restored = clean.marks[0]!;
  if (restored.tool !== "pen") throw new Error("Expected a pen");
  const outline = pressureOutline(original);
  expect(outline.length).toBeGreaterThan(6);
  expect(outline.every(Number.isFinite)).toBe(true);
  expect(pressureOutline(restored)).toEqual(outline);
  const simulated = pen();
  simulated.stroke!.pressure = "simulated";
  expect(pressureOutline(simulated)).not.toEqual(outline);
  expect(pressureOutline({ ...original, stroke: undefined })).toEqual([]);
});
test("translation and resize preserve pressure samples/options without mutating history", () => {
  const original = pen(),
    before = structuredClone(original);
  const moved = moveMark(original, 10, 15, { width: 300, height: 200 });
  const resized = editHandle(
    original,
    { kind: "resize", edge: "se", x: 80, y: 50 },
    { x: 160, y: 100 },
    { width: 300, height: 200 },
  );
  expect(original).toEqual(before);
  for (const mark of [moved, resized]) {
    if (mark.tool !== "pen") throw new Error("Expected a pen");
    expect(mark.stroke).toEqual(original.stroke);
    expect(mark.points).not.toEqual(original.points);
    expect(pressureOutline(mark).every(Number.isFinite)).toBe(true);
  }
});
