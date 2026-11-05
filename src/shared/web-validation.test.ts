import { describe, expect, test } from "bun:test";
import {
  ANNOTATION_LIMITS,
  webAnnotation,
  webAnnotationImagesMatch,
} from "./web-annotation.ts";
import {
  localWebUrl,
  webAnnotationTarget,
  webCapture,
  webReview,
} from "./web-review.ts";

const capture = () => ({
  url: "http://localhost:3000/",
  title: "Page",
  at: "2026-10-31T10:00:00Z",
  mode: "area",
  rect: { x: 0, y: 0, width: 100, height: 80 },
  viewport: { width: 100, height: 80, dpr: 1 },
  scroll: { x: -2, y: 40 },
  page: "images/page.png",
  area: "images/area.png",
  components: [],
});
const pen = () => ({
  tool: "pen",
  color: "#aBcD09",
  width: 1,
  points: [{ x: 0, y: 0 }],
});
const annotation = () => ({
  image: "images/edited.png",
  width: 10,
  height: 20,
  padding: 2,
  marks: [pen()],
});

// A PNG header is sufficient for this owner's header/dimension contract; image decoding belongs to storage.
const pngHeader = (width: number, height: number) => {
  const bytes = new Uint8Array(33),
    header = new DataView(bytes.buffer);
  [0x89504e47, 0x0d0a1a0a, 13, 0x49484452, width, height].forEach((n, i) =>
    header.setUint32(i * 4, n),
  );
  return bytes;
};

describe("capture validation boundaries", () => {
  test("local URLs reject credential and hostname lookalikes while retaining local routes", () => {
    for (const url of [
      "http://localhost.evil/",
      "http://127.0.0.1.evil/",
      "http://localhost@evil/",
      "http://user@localhost/",
      "http://:secret@localhost/",
      "file://localhost/x",
      "//localhost/x",
      "http://0.0.0.0/",
    ])
      expect(() => localWebUrl(url)).toThrow();
    for (const url of [
      "http://localhost:8080/path?q=1#hash",
      "https://127.0.0.1/",
      "http://[::1]:8080/",
    ])
      expect(localWebUrl(url)).toBe(new URL(url).href);
  });

  test("only Point accepts metadata without images, never partial or annotated evidence", () => {
    const { page, area, ...metadata } = capture();
    const point = { ...metadata, mode: "point" };
    expect(webCapture(point)?.mode).toBe("point");
    expect(webCapture(point)?.area).toBeUndefined();
    expect(webCapture({ ...point, page, area })?.area).toBe(area);
    for (const mode of ["element", "block", "area"])
      expect(webCapture({ ...metadata, mode })).toBeNull();
    for (const patch of [
      { page },
      { area },
      { page: null, area: null },
      { page: "", area: "" },
      { page: "https://example.invalid/page.png", area },
      { annotation: annotation() },
      {
        context: { id: "a".repeat(64), label: "Point" },
        proposal: "images/proposal.png",
      },
    ])
      expect(webCapture({ ...point, ...patch })).toBeNull();
  });

  test("each geometric field rejects nonnumeric and nonfinite values independently", () => {
    for (const group of ["rect", "viewport", "scroll"] as const) {
      for (const field of Object.keys(capture()[group])) {
        for (const bad of [NaN, Infinity, -Infinity, "1", null, undefined]) {
          const input = capture();
          Object.assign(input[group], { [field]: bad });
          expect(webCapture(input)).toBeNull();
        }
      }
    }
    for (const group of ["rect", "viewport"] as const) {
      for (const field of group === "rect"
        ? ["width", "height"]
        : ["width", "height", "dpr"])
        expect(
          webCapture({
            ...capture(),
            [group]: { ...capture()[group], [field]: 0 },
          }),
        ).toBeNull();
    }
  });

  test("viewport edge tolerance is inclusive and is applied to both axes", () => {
    for (const field of ["width", "height"] as const) {
      const input = capture();
      input.rect[field] = input.viewport[field] + 1;
      expect(webCapture(input)?.rect[field]).toBe(input.rect[field]);
      input.rect[field] += 0.001;
      expect(webCapture(input)).toBeNull();
    }
    expect(
      webCapture({
        ...capture(),
        rect: { x: -0.001, y: 0, width: 1, height: 1 },
      }),
    ).toBeNull();
    expect(
      webCapture({
        ...capture(),
        rect: { x: 0, y: -0.001, width: 1, height: 1 },
      }),
    ).toBeNull();
  });

  test("metadata size limits accept their boundary and reject overflow", () => {
    const element = {
      tag: "div",
      text: "hello",
      attributes: Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [String(i), "x".repeat(4000)]),
      ),
      styles: {},
    };
    const components = Array.from({ length: 30 }, () => ({
      framework: "Vue",
      name: "View",
      line: 0,
    }));
    expect(
      webCapture({ ...capture(), element, components })?.components,
    ).toEqual(components);
    for (const patch of [
      {
        element: {
          ...element,
          attributes: { ...element.attributes, extra: "x" },
        },
      },
      { element: { ...element, styles: { color: "x".repeat(4001) } } },
      { element: { ...element, attributes: { hidden: true } } },
      { components: [...components, components[0]] },
      { components: [{ framework: "React", name: "View", line: -1 }] },
      { components: [{ framework: "React", name: "View", line: 0.5 }] },
      { components: new Array(1) },
    ])
      expect(webCapture({ ...capture(), ...patch })).toBeNull();
  });

  test("nested selections are validated, whitelisted and detached from mutable callers", () => {
    const input = {
      ...capture(),
      selections: [
        {
          rect: { x: 1, y: 2, width: 3, height: 4 },
          components: [
            { framework: "React", name: "Button", line: 0, ignored: true },
          ],
          element: {
            tag: "button",
            text: "Save",
            attributes: { title: "save" },
            styles: {},
            ignored: true,
          },
          ignored: true,
        },
      ],
      ignored: true,
    };
    const clean = webCapture(input)!;
    expect(clean.selections?.[0]).toEqual({
      rect: { x: 1, y: 2, width: 3, height: 4 },
      components: [{ framework: "React", name: "Button", line: 0 }],
      element: {
        tag: "button",
        text: "Save",
        attributes: { title: "save" },
        styles: {},
      },
    });
    input.selections[0]!.element.attributes.title = "changed";
    input.selections[0]!.rect.x = 90;
    expect(clean.selections?.[0]?.element?.attributes.title).toBe("save");
    expect(clean.selections?.[0]?.rect.x).toBe(1);
    for (const selections of [
      [],
      new Array(1),
      [null],
      [
        { rect: capture().rect, components: [] },
        {
          rect: capture().rect,
          components: [{ framework: "Angular", name: "Bad" }],
        },
      ],
      Array.from({ length: 101 }, () => ({
        rect: capture().rect,
        components: [],
      })),
    ])
      expect(webCapture({ ...capture(), selections })).toBeNull();
  });

  test("review observation lists reject holes and preserve all accepted observations", () => {
    const observations = Array.from({ length: 100 }, (_, i) => ({
      ...capture(),
      title: String(i),
    }));
    const clean = webReview({
      before: capture(),
      after: observations,
      additional: observations,
    })!;
    expect(clean.after.map((c) => c.title)).toEqual(
      observations.map((c) => c.title),
    );
    expect(clean.additional).toEqual(clean.after);
    observations[0]!.rect.x = 80;
    expect(clean.after[0]!.rect.x).toBe(0);
    for (const list of [
      new Array(1),
      [capture(), null],
      [...observations, capture()],
      {},
    ]) {
      expect(webReview({ before: capture(), after: list })).toBeNull();
      expect(
        webReview({ before: capture(), after: [], additional: list }),
      ).toBeNull();
    }
  });

  test("annotation targets bound indices, identity and expected storage paths", () => {
    const target = {
      kind: "selection",
      index: 100,
      key: "k".repeat(32768),
      expected: "",
    };
    expect(webAnnotationTarget(target)).toEqual(target);
    for (const patch of [
      { kind: "before" },
      { index: -1 },
      { index: 101 },
      { index: 0.5 },
      { index: NaN },
      { key: "k".repeat(32769) },
      { expected: "images/../a.png" },
      { expected: null },
      { expected: "images/" + "a".repeat(245) + ".png" },
    ])
      expect(webAnnotationTarget({ ...target, ...patch })).toBeNull();
  });
});

describe("annotation geometry and evidence", () => {
  test("padded pixel and dimension budgets accept the exact limit, not one pixel more", () => {
    const input = { ...annotation(), width: 4094, height: 4094, padding: 1 };
    expect(webAnnotation(input)).not.toBeNull();
    expect(webAnnotation({ ...input, height: 4095 })).toBeNull();
    expect(
      webAnnotation({
        ...annotation(),
        width: ANNOTATION_LIMITS.maxDimension - 4,
        height: 1,
      }),
    ).not.toBeNull();
    expect(
      webAnnotation({
        ...annotation(),
        width: ANNOTATION_LIMITS.maxDimension - 3,
        height: 1,
      }),
    ).toBeNull();
  });

  test("all pen marks share one point budget and coordinates include padded canvas edges", () => {
    const edge = { x: 14, y: 24 };
    const points = Array.from(
      { length: ANNOTATION_LIMITS.maxPoints / 2 },
      () => edge,
    );
    const input = {
      ...annotation(),
      marks: [
        { ...pen(), points },
        { ...pen(), points },
      ],
    };
    const clean = webAnnotation(input)!;
    expect(clean.marks).toHaveLength(2);
    expect(
      webAnnotation({ ...input, marks: [...input.marks, pen()] }),
    ).toBeNull();
    for (const point of [
      { x: 14.001, y: 0 },
      { x: 0, y: 24.001 },
      { x: 0, y: Infinity },
      { x: "0", y: 0 },
    ])
      expect(
        webAnnotation({
          ...annotation(),
          marks: [{ ...pen(), points: [point] }],
        }),
      ).toBeNull();
    edge.x = 2;
    expect(clean.marks[0]!.tool === "pen" && clean.marks[0].points[0]!.x).toBe(
      14,
    );
  });

  test("reversed rectangles use the shorter absolute edge to bound corner radius", () => {
    const mark = {
      tool: "rectangle",
      color: "#123456",
      width: 128,
      from: { x: 14, y: 24 },
      to: { x: 2, y: 4 },
      radius: 6,
    };
    expect(webAnnotation({ ...annotation(), marks: [mark] })?.marks).toEqual([
      mark,
    ]);
    for (const patch of [
      { radius: 6.001 },
      { radius: -0.01 },
      { width: 128.001 },
      { from: { x: 15, y: 0 } },
      { to: { x: 0, y: -1 } },
    ])
      expect(
        webAnnotation({ ...annotation(), marks: [{ ...mark, ...patch }] }),
      ).toBeNull();
  });

  test("text accepts maximum content and size but not blank or nonfinite text geometry", () => {
    const mark = {
      tool: "text",
      color: "#ABCDEF",
      at: { x: 14, y: 24 },
      text: "x".repeat(ANNOTATION_LIMITS.maxText),
      size: ANNOTATION_LIMITS.maxTextSize,
    };
    expect(webAnnotation({ ...annotation(), marks: [mark] })?.marks).toEqual([
      mark,
    ]);
    for (const patch of [
      { text: " \n\t" },
      { text: "x".repeat(4001) },
      { size: 0 },
      { size: 512.01 },
      { size: NaN },
      { at: { x: 0, y: 25 } },
    ])
      expect(
        webAnnotation({ ...annotation(), marks: [{ ...mark, ...patch }] }),
      ).toBeNull();
  });

  test("PNG dimensions are read at the typed array offset for original and padded images", async () => {
    const input = webAnnotation(annotation())!;
    const read = async (name: string) => {
      const header =
        name === "images/source.png" ? pngHeader(10, 20) : pngHeader(14, 24);
      const buffer = new Uint8Array(60);
      buffer.set(header, 7);
      return { type: "image/png", bytes: buffer.subarray(7, 40) };
    };
    expect(
      await webAnnotationImagesMatch(input, "images/source.png", read),
    ).toBe(true);
    for (const which of ["images/source.png", input.image]) {
      for (const field of [0, 4, 8, 12, 16, 20]) {
        expect(
          await webAnnotationImagesMatch(
            input,
            "images/source.png",
            async (name) => {
              const image = await read(name);
              if (name === which) image.bytes[field] ^= 1;
              return image;
            },
          ),
        ).toBe(false);
      }
      for (const bad of [
        null,
        { type: "image/jpeg", bytes: pngHeader(10, 20) },
        { type: "image/png", bytes: new Uint8Array(32) },
      ])
        expect(
          await webAnnotationImagesMatch(
            input,
            "images/source.png",
            async (name) => (name === which ? bad : read(name)),
          ),
        ).toBe(false);
    }
  });
});
