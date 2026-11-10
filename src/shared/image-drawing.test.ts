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
