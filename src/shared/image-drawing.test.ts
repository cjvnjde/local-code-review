import { expect, test } from "bun:test";
import {
  decodeImageDrawing,
  encodeImageDrawing,
  type ImageDrawing,
} from "./image-drawing.ts";

const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
);
const drawing: ImageDrawing = {
  source: "images/original.png",
  annotation: {
    image: "images/rendered.png",
    width: 1,
    height: 1,
    padding: 64,
    marks: [
      {
        tool: "text",
        at: { x: 5, y: 5 },
        text: "Fix this →",
        size: 20,
        color: "#ef4444",
      },
    ],
  },
};

test("editable drawings travel with PNG pixels and the current Markdown ref wins", () => {
  const encoded = encodeImageDrawing(png, drawing);
  expect(decodeImageDrawing(encoded, "images/saved.png")).toEqual({
    ...drawing,
    annotation: { ...drawing.annotation, image: "images/saved.png" },
  });
  expect(encoded.slice(0, png.length - 12)).toEqual(png.slice(0, -12));
  expect(encoded.slice(-12)).toEqual(png.slice(-12));
  // Re-encoding replaces the metadata instead of accumulating old drawings.
  expect(encodeImageDrawing(encoded, drawing)).toEqual(encoded);
});

test("ordinary PNGs and other image formats have no editable marks", () => {
  expect(decodeImageDrawing(png, "images/source.png")).toBeNull();
  expect(
    decodeImageDrawing(new Uint8Array([255, 216, 255]), "images/source.jpg"),
  ).toBeNull();
});

test("damaged or incomplete drawings cannot silently reopen as flattened images", () => {
  const encoded = encodeImageDrawing(png, drawing);
  encoded[png.length + 10] ^= 1;
  expect(() => decodeImageDrawing(encoded, "images/saved.png")).toThrow(
    "damaged",
  );
  expect(() =>
    decodeImageDrawing(png.slice(0, -2), "images/source.png"),
  ).toThrow("incomplete");
});

test("metadata accepts only bounded editable marks and local original attachments", () => {
  for (const source of [
    "https://example.com/a.png",
    "images/../a.png",
    "/tmp/a.png",
    "images/sub/a.png",
    "images/a.png?x",
    "images/a.json",
  ]) {
    expect(() => encodeImageDrawing(png, { ...drawing, source })).toThrow(
      "Invalid",
    );
  }
  expect(() =>
    encodeImageDrawing(png, {
      ...drawing,
      annotation: { ...drawing.annotation, width: 1e9 },
    }),
  ).toThrow("Invalid");
  expect(() => encodeImageDrawing(new Uint8Array([1, 2]), drawing)).toThrow(
    "PNG",
  );
});

test("versioned pressure strokes roundtrip in the existing PNG chunk without changing source pixels", () => {
  const pressure: ImageDrawing = {
    ...drawing,
    annotation: {
      ...drawing.annotation,
      marks: [
        {
          tool: "pen",
          color: "#ef4444",
          width: 12,
          points: [
            { x: 12, y: 24 },
            { x: 36, y: 48 },
          ],
          stroke: {
            algorithm: "perfect-freehand",
            version: 1,
            libraryVersion: "1.2.3",
            pressure: "pointer",
            pressures: [0.15, 0.85],
            thinning: 0.65,
            smoothing: 0.5,
            streamline: 0.5,
            taperStart: 1,
            taperEnd: 2,
          },
        },
      ],
    },
  };
  const encoded = encodeImageDrawing(png, pressure);
  expect(decodeImageDrawing(encoded, pressure.annotation.image)).toEqual(
    pressure,
  );
  expect(encoded.slice(0, png.length - 12)).toEqual(png.slice(0, -12));
  expect(encodeImageDrawing(encoded, pressure)).toEqual(encoded);
  const invalid = structuredClone(pressure);
  const mark = invalid.annotation.marks[0]!;
  if (mark.tool !== "pen" || !mark.stroke)
    throw new Error("Expected pressure pen");
  mark.stroke.pressures.pop();
  expect(() => encodeImageDrawing(png, invalid)).toThrow("Invalid");
});
