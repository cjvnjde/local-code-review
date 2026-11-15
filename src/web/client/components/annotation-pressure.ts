import { getStroke } from "perfect-freehand";
import type {
  AnnotationMark,
  AnnotationPenStroke,
} from "../../../shared/web-annotation.ts";

export function pressureStroke(
  pressure: AnnotationPenStroke["pressure"],
  first: number,
): AnnotationPenStroke {
  return {
    algorithm: "perfect-freehand",
    version: 1,
    libraryVersion: "1.2.3",
    pressure,
    pressures: [first],
    thinning: 0.65,
    smoothing: 0.5,
    streamline: 0.5,
    taperStart: 1,
    taperEnd: 1,
  };
}

/** The same closed outline is consumed by Konva's scene, hit graph and PNG export. */
export function pressureOutline(
  mark: Extract<AnnotationMark, { tool: "pen" }>,
): number[] {
  const stroke = mark.stroke;
  if (!stroke) return [];
  return getStroke(
    mark.points.map((p, i) => [p.x, p.y, stroke.pressures[i]!]),
    {
      size: mark.width,
      thinning: stroke.thinning,
      smoothing: stroke.smoothing,
      streamline: stroke.streamline,
      simulatePressure: stroke.pressure === "simulated",
      start: { cap: true, taper: stroke.taperStart * mark.width },
      end: { cap: true, taper: stroke.taperEnd * mark.width },
      last: true,
    },
  ).flat();
}
