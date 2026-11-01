import { describe, expect, test } from "bun:test";
import { imageRegion, imageRegionLines, regionRect } from "./image-region.ts";
import {
  applyComment,
  noteFromComment,
  parseReview,
} from "../review/thread.ts";
import { renderMarkdown } from "../review/render.ts";

const region = {
  side: "new" as const,
  x: 100,
  y: 4200,
  width: 300,
  height: 120,
  imageWidth: 1366,
  imageHeight: 6814,
  source: "abc123",
  capture: "images/012345.png",
};
const comment = {
  id: "screen.png|*|*|#area1",
  file: "screen.png",
  scope: "file" as const,
  start: 0,
  end: 0,
  body: "This spacing is too large.",
  image: region,
};

describe("screenshot region coordinates", () => {
  test("scales a reversed drag on a long image back into source pixels", () => {
    expect(
      regionRect(
        { x: 300, y: 2300 },
        { x: 100, y: 2100 },
        { width: 683, height: 3407 },
        { width: 1366, height: 6814 },
      ),
    ).toEqual({ x: 200, y: 4200, width: 400, height: 400 });
  });
  test("clamps a drag outside the image and keeps edge selections nonempty", () => {
    expect(
      regionRect(
        { x: -5, y: -5 },
        { x: 800, y: 4000 },
        { width: 683, height: 3407 },
        { width: 1366, height: 6814 },
      ),
    ).toEqual({ x: 0, y: 0, width: 1366, height: 6814 });
    expect(
      regionRect(
        { x: 683, y: 3407 },
        { x: 900, y: 3500 },
        { width: 683, height: 3407 },
        { width: 1366, height: 6814 },
      ),
    ).toEqual({ x: 1365, y: 6813, width: 1, height: 1 });
  });
  test("a click picks a bounded area, including images smaller than the default capture", () => {
    expect(
      regionRect(
        { x: 2, y: 2 },
        { x: 2, y: 2 },
        { width: 100, height: 100 },
        { width: 200, height: 200 },
      ),
    ).toEqual({ x: 0, y: 0, width: 96, height: 96 });
    expect(
      regionRect(
        { x: 20, y: 10 },
        { x: 20, y: 10 },
        { width: 32, height: 16 },
        { width: 32, height: 16 },
      ),
    ).toEqual({ x: 0, y: 0, width: 32, height: 16 });
  });
  test("rejects malformed coordinates, unsafe capture links and metadata strings", () => {
    for (const over of [
      { side: "other" },
      { x: -1 },
      { width: 0 },
      { x: 1360 },
      { y: NaN },
      { height: 1.5 },
      { capture: "images/../outside.png" },
      { capture: "https://example.com/image.png" },
      { source: "<script>" },
    ])
      expect(imageRegion({ ...region, ...over })).toBeNull();
  });

  test("every coordinate must be a safe integer and fit independently on each axis", () => {
    for (const field of [
      "x",
      "y",
      "width",
      "height",
      "imageWidth",
      "imageHeight",
    ]) {
      for (const bad of [
        NaN,
        Infinity,
        -Infinity,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
        null,
      ])
        expect(imageRegion({ ...region, [field]: bad })).toBeNull();
    }
    const edge = { ...region, x: 1365, y: 6813, width: 1, height: 1 };
    expect(imageRegion(edge)).toEqual(edge);
    expect(imageRegion({ ...edge, width: 2 })).toBeNull();
    expect(imageRegion({ ...edge, height: 2 })).toBeNull();
    expect(imageRegion({ ...edge, imageWidth: 1365 })).toBeNull();
    expect(imageRegion({ ...edge, imageHeight: 6813 })).toBeNull();
  });

  test("capture links cannot carry traversal, encoded separators or URL suffixes", () => {
    for (const capture of [
      "images/.hidden.png",
      "images/a/b.png",
      "images/a\\b.png",
      "images/%2e%2e.png",
      "images/a.png?download=1",
      "images/a.png#x",
      "/images/a.png",
      "images/a.svg",
      "images/a.png\n",
    ])
      expect(imageRegion({ ...region, capture })).toBeNull();
    const input = {
      ...region,
      side: "old",
      capture: "images/A-1_test.v2.PNG",
      ignored: "discard",
    };
    const clean = imageRegion(input)!;
    expect(clean).toEqual({ ...region, side: "old", capture: input.capture });
    input.x = 0;
    expect(clean.x).toBe(100);
  });

  test("drag reversal preserves pixel bounds and fractional edges round outward", () => {
    const view = { width: 40, height: 30 },
      size = { width: 101, height: 79 };
    const a = { x: 3.2, y: 4.1 },
      b = { x: 21.8, y: 18.2 };
    const rect = regionRect(a, b, view, size);
    expect(rect).toEqual({ x: 8, y: 10, width: 48, height: 38 });
    expect(regionRect(b, a, view, size)).toEqual(rect);
    expect(
      imageRegion({
        ...region,
        ...rect,
        imageWidth: size.width,
        imageHeight: size.height,
      }),
    ).not.toBeNull();
  });

  test("the click slack is strict on both axes and tiny images stay selectable", () => {
    const size = { width: 200, height: 200 };
    expect(
      regionRect({ x: 100, y: 100 }, { x: 103.99, y: 103.99 }, size, size),
    ).toEqual({ x: 52, y: 52, width: 96, height: 96 });
    expect(
      regionRect({ x: 100, y: 100 }, { x: 104, y: 101 }, size, size),
    ).toEqual({ x: 100, y: 100, width: 4, height: 1 });
    expect(
      regionRect({ x: 100, y: 100 }, { x: 101, y: 104 }, size, size),
    ).toEqual({ x: 100, y: 100, width: 1, height: 4 });
    expect(
      regionRect(
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { width: 1, height: 1 },
        { width: 1, height: 1 },
      ),
    ).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  test("one-pixel regions at the origin are valid but zero or negative dimensions never are", () => {
    const tiny = {
      ...region,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      imageWidth: 1,
      imageHeight: 1,
    };
    expect(imageRegion(tiny)).toEqual(tiny);
    for (const field of ["width", "height", "imageWidth", "imageHeight"])
      for (const bad of [0, -1])
        expect(imageRegion({ ...tiny, [field]: bad })).toBeNull();
    expect(imageRegion({ ...tiny, y: -1 })).toBeNull();
    for (const source of [123, null, "abc!", "!abc", "a b", ""])
      expect(imageRegion({ ...tiny, source })).toBeNull();
    expect(imageRegion({ ...tiny, capture: 123 })).toBeNull();
  });

  test("clicking either far edge keeps the entire pick inside the source image", () => {
    const view = { width: 100, height: 150 },
      size = { width: 200, height: 300 };
    expect(
      regionRect({ x: 100, y: 150 }, { x: 100, y: 150 }, view, size),
    ).toEqual({ x: 104, y: 204, width: 96, height: 96 });
    expect(
      regionRect({ x: -20, y: -20 }, { x: -20, y: -20 }, view, size),
    ).toEqual({ x: 0, y: 0, width: 96, height: 96 });
    expect(
      regionRect({ x: 1000, y: 1000 }, { x: 1000, y: 1000 }, view, size),
    ).toEqual({ x: 104, y: 204, width: 96, height: 96 });
  });
});

describe("screenshot review round trips", () => {
  test("agent-readable capture evidence names the selected side and original image dimensions", () => {
    for (const side of ["old", "new"] as const) {
      const input = { ...region, side };
      const lines = imageRegionLines(input);
      const evidence = lines
        .filter((line) => !line.startsWith("<!--"))
        .join("\n");
      expect(evidence).toContain(side === "old" ? "**before**" : "**after**");
      expect(evidence).toContain("1366×6814");
      expect(evidence).toContain("(images/012345.png)");
      const marker = lines[0]!.match(/^<!-- lcr:image (.+) -->$/)!;
      expect(imageRegion(JSON.parse(marker[1]!))).toEqual(input);
    }
  });

  test("keeps coordinates and crop separate from editable prose, across repeated saves", () => {
    const first = noteFromComment(comment);
    let markdown = renderMarkdown({ range: "HEAD", notes: [first] });
    expect(markdown).toContain("x=100, y=4200, width=300, height=120");
    expect(markdown).toContain(
      "![Selected screenshot region](images/012345.png)",
    );
    for (let i = 0; i < 3; i++) {
      const doc = parseReview(markdown);
      expect(doc.notes[0]).toMatchObject({
        ...comment,
        key: "screen.png (whole file)",
      });
      markdown = renderMarkdown(doc);
    }
  });
  test("old-side regions and agent messages survive a reviewer edit from an older tab", () => {
    const original = noteFromComment({
      ...comment,
      image: { ...region, side: "old" },
    });
    original.status = "applied";
    original.messages = [
      { role: "agent", at: "now", body: "Adjusted the spacing." },
    ];
    const { image, ...older } = comment;
    const next = applyComment(original, {
      ...older,
      body: "Also adjust the label.",
    });
    const parsed = parseReview(renderMarkdown({ range: "HEAD", notes: [next] }))
      .notes[0]!;
    expect(parsed.image?.side).toBe("old");
    expect(parsed.status).toBe("applied");
    expect(parsed.messages).toEqual(original.messages);
    expect(parsed.body).toBe("Also adjust the label.");
  });
  test("metadata quoted in reviewer prose stays prose, including a whole generated block", () => {
    const body =
      imageRegionLines(region).join("\n") + "\nPlease explain this format.";
    const parsed = parseReview(
      renderMarkdown({
        range: "HEAD",
        notes: [noteFromComment({ ...comment, image: undefined, body })],
      }),
    );
    expect(parsed.notes[0]!.image).toBeUndefined();
    expect(parsed.notes[0]!.body).toBe(body.trim());
  });
});
