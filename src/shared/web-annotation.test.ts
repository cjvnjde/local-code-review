import { describe, expect, test } from "bun:test";
import {
  ANNOTATION_LIMITS,
  webAnnotation,
  type AnnotationMark,
  type AnnotationNode,
  type WebAnnotation,
} from "./web-annotation.ts";
import {
  setWebAnnotation,
  webCapture,
  webReview,
  webReviewLines,
  webSelectionKey,
  type WebCapture,
  type WebReview,
} from "./web-review.ts";
import { noteFromComment, parseReview } from "../review/thread.ts";
import { renderMarkdown } from "../review/render.ts";

const point = () => ({ x: 20.25, y: 30.5 });
const node = (): AnnotationNode => ({ ...point(), kind: "corner" });
const pathMark = (): Extract<AnnotationMark, { tool: "path" }> => ({
  tool: "path",
  color: "#aBcD09",
  width: 2.5,
  closed: false,
  nodes: [
    {
      x: 0,
      y: 0,
      kind: "smooth",
      in: { x: 0, y: 10 },
      out: { x: 12.125, y: 5.75 },
    },
    { x: 140, y: 120, kind: "corner", in: { x: 125, y: 110 } },
  ],
});
const boxMarks = (): AnnotationMark[] =>
  (["line", "ellipse", "triangle"] as const).map((tool) => ({
    tool,
    color: "#123abc",
    width: 3,
    from: { x: 140, y: 120 },
    to: { x: 0, y: 0 },
  }));
const annotation = (marks: AnnotationMark[] = [pathMark()]): WebAnnotation => ({
  image: "images/vector-proposal.png",
  width: 100,
  height: 80,
  padding: 20,
  marks,
});
const capture = (image = "area"): WebCapture => ({
  url: "http://localhost:3000/checkout",
  title: "Checkout",
  at: "2026-10-31T10:00:00Z",
  mode: "area",
  rect: { x: 0, y: 0, width: 100, height: 80 },
  viewport: { width: 100, height: 80, dpr: 1 },
  scroll: { x: 0, y: 0 },
  page: "images/page.png",
  area: "images/" + image + ".png",
  components: [],
});
const allMarks = (): AnnotationMark[] => [
  ...boxMarks(),
  pathMark(),
  { ...pathMark(), closed: true, nodes: [...pathMark().nodes, node()] },
  { tool: "pen", color: "#ff0000", width: 1, points: [point()] },
  {
    tool: "arrow",
    color: "#00ff00",
    width: 1,
    from: point(),
    to: { x: 100, y: 80 },
  },
  {
    tool: "rectangle",
    color: "#0000ff",
    width: 1,
    from: { x: 0, y: 0 },
    to: { x: 80, y: 60 },
    radius: 30,
  },
  {
    tool: "text",
    color: "#123456",
    at: point(),
    size: 18,
    text: "Move <button> & keep `ticks`\n```json\n<!-- lcr:web hostile -->",
  },
];

const rejectsMark = (mark: unknown) => {
  const input = { ...annotation(), marks: [mark] };
  expect(webAnnotation(input)).toBeNull();
  expect(webCapture({ ...capture(), annotation: input })).toBeNull();
};

describe("editable vector annotation schema", () => {
  test("retains old marks and exact open/closed path, reversed box and padded-edge geometry", () => {
    const input = annotation(allMarks());
    expect(webAnnotation(input)).toEqual(input);
    expect(webCapture({ ...capture(), annotation: input })?.annotation).toEqual(
      input,
    );
    for (const mark of boxMarks()) {
      if (
        mark.tool !== "line" &&
        mark.tool !== "ellipse" &&
        mark.tool !== "triangle"
      )
        throw new Error("Expected a bounded shape");
      expect(
        webAnnotation(annotation([{ ...mark, to: mark.from }]))?.marks,
      ).toEqual([{ ...mark, to: mark.from }]);
    }
    // Smooth is an editing behavior, not permission to rewrite saved controls.
    expect(webAnnotation(annotation())?.marks).toEqual([pathMark()]);
  });

  test("whitelists and deeply detaches every node, control and shape endpoint", () => {
    const input = {
      ...annotation(),
      unknown: "discard",
      marks: [
        {
          ...pathMark(),
          unknown: "discard",
          nodes: pathMark().nodes.map((at) => ({
            ...at,
            unknown: "discard",
            ...(at.in ? { in: { ...at.in, unknown: "discard" } } : {}),
            ...(at.out ? { out: { ...at.out, unknown: "discard" } } : {}),
          })),
        },
        {
          tool: "ellipse",
          color: "#123456",
          width: 2,
          from: { x: 1, y: 2, unknown: "discard" },
          to: { x: 3, y: 4, unknown: "discard" },
          radius: 10,
        },
      ],
    };
    const clean = webAnnotation(input)!;
    expect(clean.marks[0]).toEqual(pathMark());
    expect(JSON.stringify(clean)).not.toContain("discard");
    expect(clean.marks[1]).not.toHaveProperty("radius");
    expect(clean.marks).not.toBe(input.marks);
    const path = clean.marks[0];
    if (path?.tool !== "path") throw new Error("Expected path");
    expect(path.nodes).not.toBe(input.marks[0]!.nodes);
    const original = input.marks[0]!.nodes![0]!;
    expect(path.nodes[0]).not.toBe(original);
    expect(path.nodes[0]!.in).not.toBe(original.in);
    expect(path.nodes[0]!.out).not.toBe(original.out);
    path.nodes[0]!.in!.x = 42;
    path.nodes[0]!.out!.y = 43;
    path.nodes[0]!.x = 44;
    expect(original).toMatchObject({ x: 0, in: { x: 0 }, out: { y: 5.75 } });
    original.in!.y = 45;
    expect(path.nodes[0]!.in!.y).toBe(10);
    const shape = clean.marks[1];
    if (shape?.tool !== "ellipse") throw new Error("Expected ellipse");
    shape.from.x = 99;
    expect(input.marks[1]!.from!.x).toBe(1);
    const hostile = JSON.parse(JSON.stringify(annotation()));
    hostile.marks[0].nodes[0].out = JSON.parse(
      '{"x":1,"y":2,"__proto__":{"polluted":true}}',
    );
    const detached = webAnnotation(hostile)!;
    expect(detached.marks[0]).toMatchObject({
      nodes: [{ out: { x: 1, y: 2 } }, {}],
    });
    expect(JSON.stringify(detached)).not.toContain("__proto__");
  });

  test("requires a boolean closure and minimum dense, typed node arrays", () => {
    const path = pathMark();
    for (const nodes of [
      undefined,
      null,
      {},
      [],
      [node()],
      new Array(2),
      [node(), null],
    ])
      rejectsMark({ ...path, nodes });
    for (const closed of [undefined, null, 0, 1, "false", "true", {}])
      rejectsMark({ ...path, closed });
    rejectsMark({ ...path, closed: true });
    expect(
      webAnnotation(
        annotation([
          { ...path, closed: true, nodes: [node(), node(), node()] },
        ]),
      ),
    ).not.toBeNull();
    for (const kind of [undefined, null, "", "bezier", "SMOOTH", 0, {}])
      rejectsMark({ ...path, nodes: [{ ...node(), kind }, node()] });
    rejectsMark({ ...path, nodes: [[], node()] });
    const closing = {
      ...path,
      closed: true,
      nodes: [node(), node(), { ...node(), out: { x: 141, y: 0 } }],
    };
    rejectsMark(closing);
    rejectsMark({
      ...closing,
      nodes: [{ ...node(), in: { x: 0, y: -1 } }, node(), node()],
    });
  });

  test("bounds every anchor and both controls in absolute padded coordinates", () => {
    for (const side of ["anchor", "in", "out"] as const) {
      for (const axis of ["x", "y"] as const) {
        for (const bad of [
          NaN,
          Infinity,
          -Infinity,
          -0.001,
          axis === "x" ? 140.001 : 120.001,
          "1",
          null,
          undefined,
        ]) {
          const at = { ...point(), [axis]: bad };
          rejectsMark({
            ...pathMark(),
            nodes: [
              side === "anchor"
                ? { ...at, kind: "corner" }
                : { ...node(), [side]: at },
              node(),
            ],
          });
        }
      }
      const edge = { x: 140, y: 120 };
      const nodes: AnnotationNode[] = [
        side === "anchor"
          ? { ...edge, kind: "corner" }
          : { ...node(), [side]: edge },
        node(),
      ];
      expect(
        webAnnotation(annotation([{ ...pathMark(), nodes }]))?.marks[0],
      ).toEqual({
        ...pathMark(),
        nodes,
      });
    }
    for (const side of ["in", "out"] as const)
      for (const bad of [null, [], {}, 1, "point", { x: 1 }, { y: 1 }])
        rejectsMark({
          ...pathMark(),
          nodes: [{ ...node(), [side]: bad }, node()],
        });
  });

  test("checks both shape endpoints and bounded stroke sizes for each new tool", () => {
    for (const mark of boxMarks()) {
      for (const side of ["from", "to"] as const) {
        for (const bad of [
          null,
          [],
          {},
          { x: -1, y: 0 },
          { x: 0, y: 121 },
          { x: 141, y: 0 },
          { x: NaN, y: 0 },
        ])
          rejectsMark({ ...mark, [side]: bad });
      }
    }
    for (const mark of [...boxMarks(), pathMark()]) {
      for (const width of [1, ANNOTATION_LIMITS.maxWidth])
        expect(webAnnotation(annotation([{ ...mark, width }]))).not.toBeNull();
      for (const width of [
        0,
        0.999,
        ANNOTATION_LIMITS.maxWidth + 0.001,
        Infinity,
        NaN,
        "2",
        null,
      ])
        rejectsMark({ ...mark, width });
      for (const color of [
        "red",
        "#fff",
        "#12345678",
        "url(javascript:x)",
        null,
      ])
        rejectsMark({ ...mark, color });
    }
    rejectsMark({ ...pathMark(), tool: "bezier" });
  });

  test("shares one inclusive point budget across pen marks, path nodes and both controls", () => {
    const path = pathMark();
    // Two anchors plus three present controls consume five slots.
    const pen: AnnotationMark = {
      tool: "pen",
      color: "#123456",
      width: 1,
      points: Array.from({ length: ANNOTATION_LIMITS.maxPoints - 5 }, point),
    };
    for (const marks of [
      [pen, path],
      [path, pen],
    ]) {
      expect(webAnnotation(annotation(marks))?.marks).toHaveLength(2);
      expect(
        webAnnotation(annotation([...marks, { ...pen, points: [point()] }])),
      ).toBeNull();
    }
    expect(
      webAnnotation(
        annotation([pen, { ...path, nodes: [...path.nodes, node()] }]),
      ),
    ).toBeNull();
    const extraControl = structuredClone(path);
    extraControl.nodes[1]!.out = point();
    expect(webAnnotation(annotation([pen, extraControl]))).toBeNull();
    const nodes = Array.from({ length: ANNOTATION_LIMITS.maxPoints }, node);
    expect(
      webAnnotation(annotation([{ ...path, nodes }]))?.marks[0],
    ).toMatchObject({
      nodes: expect.any(Array),
    });
    expect(
      webAnnotation(annotation([{ ...path, nodes: [...nodes, node()] }])),
    ).toBeNull();
    const halves = [
      { ...path, nodes: nodes.slice(0, nodes.length / 2) },
      { ...path, nodes: nodes.slice(nodes.length / 2) },
    ];
    expect(webAnnotation(annotation(halves))?.marks).toHaveLength(2);
    expect(webAnnotation(annotation([...halves, path]))).toBeNull();
  });

  test("applies the inclusive mark count limit to new tools", () => {
    const marks = Array.from({ length: ANNOTATION_LIMITS.maxMarks }, () =>
      pathMark(),
    );
    expect(webAnnotation(annotation(marks))?.marks).toHaveLength(
      ANNOTATION_LIMITS.maxMarks,
    );
    expect(webAnnotation(annotation([...marks, pathMark()]))).toBeNull();
  });
});

describe("vector annotation review metadata", () => {
  test("retains geometry when atomically attaching proposals to every capture kind", () => {
    const original: WebReview = {
      before: capture(),
      additional: [capture("selection")],
      after: [capture("after")],
    };
    let next = original;
    const proposal = annotation(allMarks());
    for (const [kind, index, selected] of [
      ["selection", 0, original.before],
      ["selection", 1, original.additional![0]!],
      ["after", 0, original.after[0]!],
    ] as const) {
      next = setWebAnnotation(
        next,
        {
          kind,
          index,
          key: webSelectionKey(selected),
          expected: "",
        },
        proposal,
      );
    }
    expect(original.before.annotation).toBeUndefined();
    expect(original.additional![0]!.annotation).toBeUndefined();
    expect(original.after[0]!.annotation).toBeUndefined();
    expect(next.before.annotation).toEqual(proposal);
    expect(next.additional![0]!.annotation).toEqual(proposal);
    expect(next.after[0]!.annotation).toEqual(proposal);
    expect(webReview(JSON.parse(JSON.stringify(next)))).toEqual(next);
    next.before.annotation!.marks.splice(0, 1);
    expect(proposal.marks).toHaveLength(allMarks().length);
    expect(next.additional![0]!.annotation).toEqual(proposal);
  });

  test("exposes exact paint-order geometry and explains coordinates, shapes and smooth controls to agents", () => {
    const proposal = annotation(allMarks());
    const lines = webReviewLines({
      before: { ...capture(), annotation: proposal },
      after: [],
    });
    const markdown = lines.join("\n");
    const block = markdown.match(/(`{3,})json\n([\s\S]*?)\n\1/)!;
    const visible = JSON.parse(block[2]!);
    expect(visible.annotation.marks).toEqual(proposal.marks);
    expect(visible.annotation.toolCounts).toEqual({
      pen: 1,
      arrow: 1,
      rectangle: 1,
      text: 1,
      line: 1,
      ellipse: 1,
      triangle: 1,
      path: 2,
    });
    expect(markdown).toContain("(0, 0) at the padded canvas top-left");
    expect(markdown).toContain("original screenshot starts at (20, 20)");
    expect(markdown).toContain("output size is 140 × 120 px");
    expect(markdown).toContain("triangle joins the top-center apex");
    expect(markdown).toContain("absolute cubic Bézier controls");
    expect(markdown).toContain("closed joins the last node back to the first");
    expect(markdown).toContain("Smooth nodes keep tangent handles aligned");
    expect(markdown).toContain("padding is not page context");
    expect(lines[0]).not.toContain("<button>");
    expect(lines[0]).not.toContain("<!-- lcr:web hostile");
  });

  test("round trips full vectors, reviewer prose and conversation through ordinary review Markdown", () => {
    const proposal = annotation(allMarks());
    const web: WebReview = {
      before: { ...capture(), annotation: proposal },
      additional: [
        { ...capture("selection"), annotation: structuredClone(proposal) },
      ],
      after: [{ ...capture("after"), annotation: structuredClone(proposal) }],
    };
    const note = noteFromComment({
      id: "|@|@|#vectors",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "Keep this reviewer explanation separate from the drawing metadata.",
      web,
    });
    note.messages = [
      { role: "agent", at: "", body: "The curved outline is intentional." },
    ];
    note.status = "applied";
    const markdown = renderMarkdown({ range: "web", notes: [note] });
    const parsed = parseReview(markdown);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]!.web).toEqual(web);
    expect(parsed.notes[0]!.body).toBe(note.body);
    expect(parsed.notes[0]!.messages).toEqual(note.messages);
    expect(parsed.notes[0]!.status).toBe("applied");
    expect(renderMarkdown(parsed)).toBe(markdown);
  });

  test("preserves the existing sealed format for old-tool-only proposals", () => {
    const legacy = annotation([
      {
        tool: "rectangle",
        color: "#123456",
        width: 2,
        from: { x: 0, y: 0 },
        to: { x: 100, y: 80 },
        radius: 4,
      },
    ]);
    const before = { ...capture(), annotation: legacy };
    const web = { before, after: [] };
    const summary = {
      image: legacy.image,
      width: legacy.width,
      height: legacy.height,
      padding: legacy.padding,
      toolCounts: { pen: 0, arrow: 0, rectangle: 1, text: 0 },
      textPreviews: [],
    };
    const expected = [
      "<!-- lcr:web " + JSON.stringify(web) + " -->",
      "",
      "UI capture: area selection. Metadata and screenshots record the page at capture time.",
      "",
      "Before capture:",
      "",
      "```json",
      JSON.stringify(
        { ...before, page: undefined, area: undefined, annotation: summary },
        null,
        2,
      ),
      "```",
      "",
      "![Before — page](images/page.png)",
      "",
      "![Before — selected area](images/area.png)",
      "",
      "Before original selected area is the unmodified screenshot above. Annotated proposal below adds reviewer drawings, not captured page content.",
      "The proposal has 20 px of blank white padding on each side; padding is not page context.",
      "",
      "![Before — annotated proposal](images/vector-proposal.png)",
      "",
    ].join("\n");
    expect(webReviewLines(web).join("\n")).toBe(expected);
  });
});

const enhancedMarks = (): AnnotationMark[] => [
  {
    tool: "callout",
    id: "e5a9d110-8677-4adb-8728-0fcb81393006",
    number: 1,
    label: "Move this control",
    color: "#ffff00",
    width: 2,
    size: 24,
    from: { x: 30, y: 30 },
    to: { x: 80, y: 60 },
  },
  {
    tool: "highlighter",
    color: "#ffee00",
    width: 20,
    opacity: 0.25,
    points: [
      { x: 20, y: 40 },
      { x: 80, y: 40 },
    ],
  },
  {
    tool: "rectangle",
    color: "#123456",
    width: 2,
    from: { x: 10, y: 10 },
    to: { x: 90, y: 70 },
    radius: 4,
    fill: "#abcdef",
    opacity: 0,
  },
  {
    tool: "ellipse",
    color: "#123456",
    width: 2,
    from: { x: 10, y: 10 },
    to: { x: 90, y: 70 },
    fill: "#abcdef",
    opacity: 1,
  },
  {
    tool: "triangle",
    color: "#123456",
    width: 2,
    from: { x: 10, y: 10 },
    to: { x: 90, y: 70 },
    fill: "#abcdef",
    opacity: 0.4,
  },
  { ...pathMark(), fill: "#abcdef", opacity: 0.5 },
  {
    tool: "text",
    color: "#123456",
    at: { x: 5, y: 5 },
    text: "Readable\nconnected label",
    size: 12,
    wrap: 100,
    background: "#ffffff",
    outline: true,
    target: { x: 60, y: 60 },
  },
  {
    tool: "magnifier",
    color: "#123456",
    width: 2,
    from: { x: 20, y: 20 },
    to: { x: 40, y: 35 },
    at: { x: 60, y: 70 },
    scale: 3,
  },
];

describe("enhanced drawing metadata", () => {
  test("roundtrips every field with stable callout identity and detached coordinates", () => {
    const input = annotation(enhancedMarks());
    const clean = webAnnotation(input)!;
    expect(clean).toEqual(input);
    expect(webAnnotation(clean)).toEqual(input);
    expect(webAnnotation(JSON.parse(JSON.stringify(input)))).toEqual(input);
    for (let i = 0; i < input.marks.length; i++) {
      const original = input.marks[i]!,
        detached = clean.marks[i]!;
      for (const key of ["from", "to", "at", "target", "points"] as const) {
        if (key in original) {
          expect(
            (detached as unknown as Record<string, unknown>)[key],
          ).not.toBe((original as unknown as Record<string, unknown>)[key]);
        }
      }
    }
    for (let i = 0; i < input.marks.length; i++)
      expect(clean.marks[i]).not.toBe(input.marks[i]);
    const callout = clean.marks[0];
    if (callout?.tool !== "callout") throw new Error("Expected callout");
    expect(callout.id).toBe("e5a9d110-8677-4adb-8728-0fcb81393006");
    callout.from.x = 99;
    expect(input.marks[0]).toMatchObject({ from: { x: 30 } });
    const withUnknown = enhancedMarks().map((mark) => {
      const hostile: Record<string, unknown> = { ...mark, unknown: "drop" };
      for (const key of ["from", "to", "at", "target"] as const) {
        const at = hostile[key];
        if (at) hostile[key] = { ...(at as object), unknown: "drop" };
      }
      if ("points" in mark)
        hostile.points = mark.points.map((at) => ({ ...at, unknown: "drop" }));
      return hostile;
    });
    expect(
      JSON.stringify(webAnnotation({ ...annotation(), marks: withUnknown })),
    ).not.toContain("drop");
  });

  test("rejects invalid or duplicate callout identities and numbers", () => {
    const callout = enhancedMarks()[0]!;
    for (const id of ["", "not-a-uuid", 1, null])
      rejectsMark({ ...callout, id });
    for (const number of [0, -1, 1.5, Infinity, NaN, "1"])
      rejectsMark({ ...callout, number });
    rejectsMark({
      ...callout,
      label: "a".repeat(ANNOTATION_LIMITS.maxCalloutLabel + 1),
    });
    expect(webAnnotation(annotation([callout, { ...callout }]))).toBeNull();
    expect(
      webAnnotation(
        annotation([
          callout,
          { ...callout, id: "e5a9d110-8677-4adb-8728-0fcb81393007" },
        ]),
      ),
    ).toBeNull();
    expect(
      webAnnotation(annotation([callout, { ...callout, number: 2 }])),
    ).toBeNull();
    expect(
      webAnnotation(
        annotation([
          callout,
          { ...callout, id: "e5a9d110-8677-4adb-8728-0fcb81393007", number: 2 },
        ]),
      ),
    ).not.toBeNull();
  });

  test("bounds fill/highlighter opacity and whitelists optional text presentation", () => {
    for (const mark of enhancedMarks().filter((mark) => "opacity" in mark)) {
      for (const opacity of [-0.01, 1.01, NaN, Infinity, "0.5", null])
        rejectsMark({ ...mark, opacity });
      for (const opacity of [0, 1])
        expect(
          webAnnotation(annotation([{ ...mark, opacity }])),
        ).not.toBeNull();
    }
    const text = enhancedMarks()[6]!;
    for (const wrap of [
      0,
      -1,
      ANNOTATION_LIMITS.maxDimension + 1,
      Infinity,
      NaN,
      "20",
    ])
      rejectsMark({ ...text, wrap });
    for (const background of ["red", "#fff", "#00000000", null])
      rejectsMark({ ...text, background });
    for (const outline of [null, 0, "true"]) rejectsMark({ ...text, outline });
    rejectsMark({ ...text, target: { x: 141, y: 0 } });
    for (const mark of enhancedMarks().filter((mark) => "fill" in mark))
      rejectsMark({ ...mark, fill: "rgba(0,0,0,.5)" });
  });

  test("magnifiers crop only original pixels and keep the scaled destination inside padding-aware canvas", () => {
    const magnifier = enhancedMarks()[7]!;
    for (const from of [
      { x: 19.99, y: 20 },
      { x: 20, y: 19.99 },
    ])
      rejectsMark({ ...magnifier, from });
    for (const to of [
      { x: 120.01, y: 35 },
      { x: 40, y: 100.01 },
      { x: 20, y: 35 },
      { x: 40, y: 20 },
    ])
      rejectsMark({ ...magnifier, to });
    for (const scale of [0, 0.99, 8.01, Infinity, NaN, "2"])
      rejectsMark({ ...magnifier, scale });
    rejectsMark({ ...magnifier, at: { x: 81, y: 70 } });
    rejectsMark({ ...magnifier, at: { x: 60, y: 76 } });
    expect(
      webAnnotation(annotation([{ ...magnifier, at: { x: 80, y: 75 } }])),
    ).not.toBeNull();
    expect(
      webAnnotation(
        annotation([
          { ...magnifier, from: { x: 40, y: 35 }, to: { x: 20, y: 20 } },
        ]),
      ),
    ).not.toBeNull();
    expect(
      webAnnotation(
        annotation([
          {
            ...magnifier,
            from: { x: 20, y: 20 },
            to: { x: 30, y: 30 },
            at: { x: 0, y: 0 },
            scale: 8,
          },
        ]),
      ),
    ).not.toBeNull();
  });

  test("review geometry exposes callout labels and original-only magnifier semantics without losing sealed metadata", () => {
    const web: WebReview = {
      before: { ...capture(), annotation: annotation(enhancedMarks()) },
      after: [],
    };
    const lines = webReviewLines(web).join("\n"),
      block = lines.match(/(`{3,})json\n([\s\S]*?)\n\1/)!;
    const summary = JSON.parse(block[2]!).annotation;
    expect(summary.marks).toEqual(web.before.annotation!.marks);
    expect(summary.toolCounts).toMatchObject({
      callout: 1,
      highlighter: 1,
      magnifier: 1,
    });
    expect(summary.marks[0].label).toBe("Move this control");
    expect(lines).toContain("Insets sample only original pixels");
    const note = noteFromComment({
      id: "|@|@|#enhanced",
      file: "",
      scope: "global",
      start: 0,
      end: 0,
      body: "Intent",
      web,
    });
    const markdown = renderMarkdown({ range: "web", notes: [note] });
    expect(parseReview(markdown).notes[0]!.web).toEqual(web);
    expect(renderMarkdown(parseReview(markdown))).toBe(markdown);
  });
});
