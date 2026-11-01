import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  dropWebSelection,
  localWebUrl,
  setWebAnnotation,
  webCapture,
  webReview,
  webReviewLines,
  webSelectionKey,
  type WebAnnotationTarget,
  type WebCapture,
  type WebReview,
} from "./web-review.ts";
import {
  ANNOTATION_LIMITS,
  webAnnotation,
  webAnnotationImagesMatch,
  type WebAnnotation,
} from "./web-annotation.ts";
import { saveAttachment } from "../review/attach.ts";
import {
  noteFromComment,
  parseReview,
  renderNote,
  applyComment,
} from "../review/thread.ts";
import { renderMarkdown } from "../review/render.ts";
import { createSession } from "../review/session.ts";
import { parseArgs } from "../cli/args.ts";
import {
  historyChanges,
  historySnapshot,
  historyText,
} from "../web/client/history/history-model.ts";
import { webCaptureHtml } from "../web/client/web-review/web-capture.ts";

export const capture: WebCapture = {
  url: "http://localhost:3000/checkout?step=2",
  title: "Checkout ` <script>",
  at: "2026-10-31T10:00:00.000Z",
  mode: "element",
  rect: { x: 24, y: 100, width: 180, height: 48 },
  viewport: { width: 1200, height: 800, dpr: 2 },
  scroll: { x: 0, y: 200 },
  selector: 'button[data-testid="submit"]',
  element: {
    tag: "button",
    text: "Buy now",
    attributes: { "data-testid": "submit" },
    styles: { color: "rgb(0, 0, 0)" },
  },
  components: [
    {
      framework: "React",
      name: "Checkout",
      file: "src/Checkout.tsx",
      line: 14,
    },
  ],
  page: "images/page.png",
  area: "images/area.png",
};
const comment = () => ({
  id: "|@|@|#abc123",
  file: "",
  scope: "global" as const,
  start: 0,
  end: 0,
  body: "Make this button wider.",
  web: { before: structuredClone(capture), after: [] } as WebReview,
});
const multiCapture = (): WebCapture => {
  const first = {
    rect: structuredClone(capture.rect),
    selector: capture.selector,
    element: structuredClone(capture.element),
    components: structuredClone(capture.components),
  };
  const second = {
    rect: { x: 280, y: 160, width: 240, height: 60 },
    selector: '[data-testid="total"]',
    element: {
      tag: "output",
      text: 'Total <script>alert("x")</script>',
      attributes: { "data-testid": "total" },
      styles: { color: "red" },
    },
    components: [
      {
        framework: "Vue" as const,
        name: "OrderTotal",
        file: "src/OrderTotal.vue",
        line: 0,
      },
    ],
  };
  return {
    ...structuredClone(capture),
    rect: { x: 24, y: 100, width: 496, height: 120 },
    selections: [first, second],
  };
};
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const annotation = (): WebAnnotation => ({
  image: "images/proposal.png",
  width: 360,
  height: 96,
  padding: 128,
  marks: [
    {
      tool: "pen",
      color: "#ff0000",
      width: 3,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
    },
    {
      tool: "arrow",
      color: "#00ff00",
      width: 2,
      from: { x: 10, y: 20 },
      to: { x: 100, y: 100 },
    },
    {
      tool: "rectangle",
      color: "#0000ff",
      width: 4,
      from: { x: 20, y: 20 },
      to: { x: 120, y: 100 },
      radius: 10,
    },
    {
      tool: "text",
      color: "#123abc",
      at: { x: 30, y: 20 },
      text: "Proposed <button>\n### note",
      size: 24,
    },
  ],
});
const annotationTarget = (
  capture: WebCapture,
  kind: WebAnnotationTarget["kind"] = "selection",
  index = 0,
): WebAnnotationTarget => ({
  kind,
  index,
  key: webSelectionKey(capture),
  expected: capture.annotation?.image ?? "",
});
describe("editable screenshot annotations", () => {
  test("whitelists and detaches all tools, including drawable blank padding", () => {
    const input = annotation(),
      clean = webAnnotation({
        ...input,
        unknown: "discard",
        marks: input.marks.map((mark) => ({ ...mark, unknown: "discard" })),
      })!;
    expect(clean).toEqual(input);
    expect(JSON.stringify(clean)).not.toContain("discard");
    if (clean.marks[0]!.tool === "pen") clean.marks[0].points[0]!.x = 10;
    if (input.marks[0]!.tool === "pen")
      expect(input.marks[0].points[0]!.x).toBe(0);
    expect(webCapture({ ...capture, annotation: input })!.annotation).toEqual(
      input,
    );
  });
  test("rejects unsafe image paths and bounded canvas, geometry, colors, arrays and text", () => {
    const valid = annotation(),
      pen = valid.marks[0]!;
    for (const patch of [
      { image: "../secret.png" },
      { image: "images/a.svg" },
      { image: "https://example.com/a.png" },
      { width: 0 },
      { width: 1.5 },
      { height: Infinity },
      { padding: -1 },
      { padding: 0.5 },
      {
        width: ANNOTATION_LIMITS.maxDimension,
        height: ANNOTATION_LIMITS.maxDimension,
      },
      { marks: [] },
      { marks: new Array(1) },
      {
        marks: Array.from(
          { length: ANNOTATION_LIMITS.maxMarks + 1 },
          () => pen,
        ),
      },
      { marks: [{ ...pen, color: "red" }] },
      { marks: [{ ...pen, width: Infinity }] },
      { marks: [{ ...pen, width: 0 }] },
      { marks: [{ ...pen, points: [] }] },
      { marks: [{ ...pen, points: [{ x: -1, y: 0 }] }] },
      { marks: [{ ...pen, points: [{ x: 617, y: 0 }] }] },
      { marks: [{ ...pen, points: [{ x: NaN, y: 0 }] }] },
      {
        marks: [
          {
            ...pen,
            points: Array.from(
              { length: ANNOTATION_LIMITS.maxPoints + 1 },
              () => ({ x: 0, y: 0 }),
            ),
          },
        ],
      },
      {
        marks: [
          {
            tool: "text",
            color: "#123456",
            at: { x: 0, y: 0 },
            size: 12,
            text: "x".repeat(ANNOTATION_LIMITS.maxText + 1),
          },
        ],
      },
      {
        marks: [
          {
            tool: "rectangle",
            color: "#123456",
            width: 1,
            from: { x: 0, y: 0 },
            to: { x: 10, y: 10 },
            radius: 6,
          },
        ],
      },
    ]) {
      expect(webAnnotation({ ...valid, ...patch })).toBeNull();
      expect(
        webCapture({ ...capture, annotation: { ...valid, ...patch } }),
      ).toBeNull();
    }
    expect(
      webAnnotation({ ...valid, marks: [{ ...pen, points: new Array(1) }] }),
    ).toBeNull();
  });
  test("compares capture identity and previous image while isolating original and other captures", () => {
    const second = { ...structuredClone(capture), area: "images/second.png" },
      after = { ...structuredClone(capture), area: "images/after.png" };
    const web: WebReview = {
        before: structuredClone(capture),
        after: [after],
        additional: [second],
      },
      original = structuredClone(web);
    for (const [kind, index, c] of [
      ["selection", 0, web.before],
      ["selection", 1, second],
      ["after", 0, after],
    ] as const) {
      const target = annotationTarget(c, kind, index),
        next = setWebAnnotation(web, target, annotation());
      const changed =
        kind === "after"
          ? next.after[0]!
          : index === 0
            ? next.before
            : next.additional![0]!;
      expect(changed.annotation).toEqual(annotation());
      expect({ ...changed, annotation: undefined }).toEqual({
        ...c,
        annotation: undefined,
      });
      expect(web).toEqual(original);
      expect(webSelectionKey(changed)).toBe(target.key);
      expect(() => setWebAnnotation(next, target, null)).toThrow("changed");
      expect(
        setWebAnnotation(
          next,
          { ...target, expected: annotation().image },
          null,
        ),
      ).toEqual(web);
    }
    for (const target of [
      { ...annotationTarget(capture), key: "stale" },
      annotationTarget(capture, "selection", 2),
      annotationTarget(capture, "after", 1),
    ])
      expect(() => setWebAnnotation(web, target, annotation())).toThrow();
  });
  test("round trips annotated proposals with clear original labels and preserves old sealed captures", () => {
    const c = comment();
    c.web.before.annotation = annotation();
    c.web.after = [{ ...structuredClone(capture), annotation: annotation() }];
    const markdown = renderMarkdown({
        range: "web",
        notes: [noteFromComment(c)],
      }),
      parsed = parseReview(markdown);
    expect(parsed.notes[0]!.web).toEqual(c.web);
    expect(parsed.notes[0]!.body).toBe(c.body);
    expect(markdown).toContain(
      "original selected area is the unmodified screenshot",
    );
    expect(markdown).toContain(
      "![Before — annotated proposal](images/proposal.png)",
    );
    expect(markdown).toContain("128 px of blank white padding");
    expect(
      markdown
        .split("\n")
        .filter((line) => !line.startsWith("<!-- lcr:web "))
        .join("\n"),
    ).not.toContain('"points"');
    expect(renderMarkdown(parsed)).toBe(markdown);
    const web = webReview({
        before: { ...structuredClone(capture), title: "Legacy" },
        after: [],
      })!,
      old = web.before;
    const block = [
      "<!-- lcr:web " + JSON.stringify(web) + " -->",
      "",
      "UI capture: element selection. Metadata and screenshots record the page at capture time.",
      "",
      "Before capture:",
      "",
      "```json",
      JSON.stringify({ ...old, page: undefined, area: undefined }, null, 2),
      "```",
      "",
      "![Before — page](images/page.png)",
      "",
      "![Before — selected area](images/area.png)",
      "",
    ].join("\n");
    const legacy = renderMarkdown({
      range: "web",
      notes: [
        noteFromComment({
          ...comment(),
          web: undefined,
          body: "LEGACY_EVIDENCE",
        }),
      ],
    }).replace("LEGACY_EVIDENCE", block + "\nOriginal question.");
    expect(parseReview(legacy).notes[0]!.web).toEqual(web);
    expect(parseReview(legacy).notes[0]!.body).toBe("Original question.");
  });
  test("serializes fresh annotation writes and preserves proposals across restart, stale text and removal", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lcr-annotations-"));
    dirs.push(dir);
    const session = createSession(dir, ".review", "web"),
      c = comment(),
      second = { ...structuredClone(capture), area: "images/second.png" };
    c.web.additional = [second];
    c.web.after = [{ ...structuredClone(capture), area: "images/after.png" }];
    await session.save({ comments: [c, { ...comment(), id: "|@|@|#other" }] });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const image = await saveAttachment(dir, ".review", png, "image/png");
    for (const name of ["area.png", "second.png", "after.png"])
      await writeFile(path.join(dir, ".review", "images", name), png);
    const proposal: WebAnnotation = {
      image: "images/" + image,
      width: 1,
      height: 1,
      padding: 0,
      marks: [
        {
          tool: "pen",
          color: "#ff0000",
          width: 1,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ],
    };
    const target = annotationTarget(second, "selection", 1);
    const writes = await Promise.allSettled([
      session.annotateWebCapture(c.id, target, proposal),
      session.annotateWebCapture(c.id, target, proposal),
    ]);
    expect(writes.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await session.annotateWebCapture(
      c.id,
      annotationTarget(c.web.after[0]!, "after", 0),
      proposal,
    );
    await session.save({
      comments: [{ ...c, body: "New wording from stale text editor." }],
    });
    const restart = createSession(dir, ".review", "web");
    await restart.adoptMatching();
    const doc = await restart.read(),
      note = doc.notes.find((note) => note.id === c.id)!;
    expect(note.web!.before).toEqual(c.web.before);
    expect(note.web!.additional![0]!.annotation).toEqual(proposal);
    expect(note.web!.after[0]!.annotation).toEqual(proposal);
    expect(note.body).toBe("New wording from stale text editor.");
    expect(note.status).toBe("pending");
    expect(note.messages).toEqual([]);
    expect(doc.notes.find((note) => note.id === "|@|@|#other")!.web).toEqual(
      comment().web,
    );
    await expect(
      restart.annotateWebCapture(
        c.id,
        annotationTarget(c.web.before),
        annotation(),
      ),
    ).rejects.toThrow("PNG attachments");
    await restart.annotateWebCapture(
      c.id,
      { ...target, expected: proposal.image },
      null,
    );
    await restart.save({ comments: [{ ...c, web: note.web }] });
    expect(
      (await restart.read()).notes.find((note) => note.id === c.id)!.web!
        .additional![0]!.annotation,
    ).toBeUndefined();
    await restart.removeWebSelection(c.id, 1, webSelectionKey(second));
    await expect(
      restart.annotateWebCapture(c.id, target, proposal),
    ).rejects.toThrow("no longer exists");
    expect(
      await readFile(path.join(dir, ".review", "images", image)),
    ).toBeDefined();
    await session.answer(
      session.file,
      c.id,
      "Keep this conversation.",
      "applied",
    );
    await expect(
      restart.annotateWebCapture(
        c.id,
        annotationTarget(c.web.before),
        proposal,
      ),
    ).rejects.toThrow("answered");
  });
  test("checks PNG signatures and exact original and padded dimensions before storage", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const proposal: WebAnnotation = {
      image: "images/proposal.png",
      width: 1,
      height: 1,
      padding: 0,
      marks: [
        { tool: "pen", color: "#ff0000", width: 1, points: [{ x: 0, y: 0 }] },
      ],
    };
    const read = async () => ({ bytes: png, type: "image/png" });
    expect(
      await webAnnotationImagesMatch(proposal, "images/source.png", read),
    ).toBe(true);
    expect(
      await webAnnotationImagesMatch(
        { ...proposal, padding: 1 },
        "images/source.png",
        read,
      ),
    ).toBe(false);
    expect(
      await webAnnotationImagesMatch(
        { ...proposal, width: 2 },
        "images/source.png",
        read,
      ),
    ).toBe(false);
    expect(
      await webAnnotationImagesMatch(
        proposal,
        "images/source.png",
        async () => null,
      ),
    ).toBe(false);
    expect(
      await webAnnotationImagesMatch(
        proposal,
        "images/source.png",
        async () => ({ bytes: png, type: "image/svg+xml" }),
      ),
    ).toBe(false);
    const invalid = Buffer.from(png);
    invalid[0] = 0;
    expect(
      await webAnnotationImagesMatch(
        proposal,
        "images/source.png",
        async () => ({ bytes: invalid, type: "image/png" }),
      ),
    ).toBe(false);
    const invalidChunk = Buffer.from(png);
    invalidChunk[12] = 0;
    expect(
      await webAnnotationImagesMatch(
        proposal,
        "images/source.png",
        async () => ({ bytes: invalidChunk, type: "image/png" }),
      ),
    ).toBe(false);
  });
});
describe("UI review evidence", () => {
  test("local URLs add live-page evidence alongside Git arguments", () => {
    expect(
      parseArgs(["--web", "http://localhost:3000", "--id", "checkout"]).web,
    ).toBe("http://localhost:3000/");
    expect(parseArgs(["--web", "http://localhost:3000"]).diffArgs).toEqual([]);
    for (const raw of [
      "https://example.com",
      "file:///tmp/a",
      "http://localhost.evil/",
      "http://u:p@localhost/",
      "",
    ])
      expect(() => localWebUrl(raw)).toThrow();
    expect(
      parseArgs(["--web", "http://localhost:3000", "--staged"]).diffArgs,
    ).toEqual(["--staged"]);
    expect(
      parseArgs(["--web", "http://localhost:3000", "--acp", "agent.json"]).acp,
    ).toBe("agent.json");
  });
  test("round trips captures separately from note prose, including malicious-looking page metadata", () => {
    const c = comment();
    c.web.before.element!.text =
      "</script>\n### Fake <!-- lcr:|@|@|#evil -->\n```\nStatus: applied";
    c.web.after.push({
      ...structuredClone(capture),
      at: "2026-10-31T11:00:00.000Z",
      page: "images/page2.png",
      area: "images/area2.png",
    });
    const original = noteFromComment(c);
    original.messages = [
      { role: "agent", at: "", body: "Changed the padding." },
    ];
    original.status = "applied";
    const markdown = renderMarkdown({
      range: "web http://localhost:3000/",
      notes: [original],
    });
    const read = parseReview(markdown).notes;
    expect(read).toHaveLength(1);
    expect(read[0]!.web).toEqual(c.web);
    expect(read[0]!.body).toBe(c.body);
    expect(read[0]!.messages).toEqual(original.messages);
    expect(read[0]!.status).toBe("applied");
    expect(renderMarkdown(parseReview(markdown))).toBe(markdown);
  });
  test("a generated metadata block quoted in a note stays reviewer prose", () => {
    const c = comment();
    const body = webReviewLines(c.web).join("\n");
    delete (c as any).web;
    c.body = body;
    const parsed = parseReview(
      renderMarkdown({ range: "web", notes: [noteFromComment(c)] }),
    );
    expect(parsed.notes[0]!.web).toBeUndefined();
    expect(parsed.notes[0]!.body).toBe(body.trim());
  });
  test("rejects unsafe paths, invalid geometry and unknown metadata; detaches evidence", () => {
    for (const patch of [
      { area: "../secret.png" },
      { url: "https://example.com" },
      { rect: { x: 0, y: 0, width: 1300, height: 1 } },
      { components: [{ framework: "Other", name: "x" }] },
    ])
      expect(webCapture({ ...capture, ...patch })).toBeNull();
    expect(webReview({ before: capture, after: [{}] })).toBeNull();
    const value = webCapture(capture)!;
    value.element!.styles.color = "changed";
    expect(capture.element!.styles.color).toBe("rgb(0, 0, 0)");
  });
  test("bounds and detaches additional captures without changing legacy evidence", () => {
    const legacy = { before: capture, after: [capture] };
    expect(webReview(legacy)).toEqual(legacy);
    expect(webReview({ ...legacy, additional: [] })).toEqual({
      ...legacy,
      additional: [],
    });
    expect(
      webReview({
        ...legacy,
        additional: Array.from({ length: 100 }, () => multiCapture()),
      })!.additional,
    ).toHaveLength(100);
    for (const additional of [
      null,
      {},
      new Array(1),
      [null],
      [{}],
      Array.from({ length: 101 }, () => capture),
      [{ ...capture, area: "../escape.png" }],
      [{ ...multiCapture(), selections: [{}] }],
    ]) {
      expect(webReview({ ...legacy, additional })).toBeNull();
    }
    const input = { ...legacy, additional: [multiCapture()] },
      clean = webReview(input)!;
    clean.additional![0]!.selections![1]!.element!.attributes["data-testid"] =
      "changed";
    clean.additional![0]!.components[0]!.name = "Changed";
    expect(
      input.additional[0]!.selections![1]!.element!.attributes["data-testid"],
    ).toBe("total");
    expect(input.additional[0]!.components[0]!.name).toBe("Checkout");
  });
  test("removes complete captures, promotes the next subject, and discards only its old comparisons", () => {
    const second = { ...multiCapture(), page: "images/second.png" },
      third = { ...structuredClone(capture), area: "images/third.png" };
    const web: WebReview = {
        before: multiCapture(),
        after: [capture],
        additional: [second, third],
      },
      original = structuredClone(web);
    expect(webSelectionKey(capture)).toBe(
      JSON.stringify([capture.url, capture.at, capture.page, capture.area]),
    );
    const promoted = dropWebSelection(web, 0, webSelectionKey(web.before));
    expect(promoted).toEqual({
      before: second,
      after: [],
      additional: [third],
    });
    expect(dropWebSelection(web, 1, webSelectionKey(second))).toEqual({
      before: web.before,
      after: [capture],
      additional: [third],
    });
    expect(
      dropWebSelection(
        { before: capture, after: [second], additional: [third] },
        1,
        webSelectionKey(third),
      ),
    ).toEqual({ before: capture, after: [second] });
    expect(
      dropWebSelection(
        { before: multiCapture(), after: [capture] },
        0,
        webSelectionKey(web.before),
      ),
    ).toBeNull();
    expect(web).toEqual(original);
  });
  test("selection removal rejects out-of-range indexes and keys from a stale ordering", () => {
    const second = { ...capture, page: "images/second.png" },
      third = { ...capture, page: "images/third.png" };
    const web: WebReview = {
      before: capture,
      after: [],
      additional: [second, third],
    };
    for (const index of [-1, 1.5, NaN, Infinity, 3, 101])
      expect(() =>
        dropWebSelection(web, index, webSelectionKey(capture)),
      ).toThrow("no longer exists");
    expect(() => dropWebSelection(web, 0, webSelectionKey(second))).toThrow(
      "changed",
    );
    const next = dropWebSelection(web, 1, webSelectionKey(second))!;
    expect(() => dropWebSelection(next, 1, webSelectionKey(second))).toThrow(
      "changed",
    );
    expect(() => dropWebSelection(next, 2, webSelectionKey(third))).toThrow(
      "no longer exists",
    );
    expect(dropWebSelection(next, 1, webSelectionKey(third))).toEqual({
      before: capture,
      after: [],
    });
  });
  test("additional selections round trip as evidence, not comparisons or prose", () => {
    const c = comment();
    const area = { ...multiCapture(), mode: "area" as const };
    c.web.additional = [
      area,
      {
        ...structuredClone(capture),
        page: "images/third.png",
        area: "images/third-area.png",
      },
    ];
    c.web.after = [
      {
        ...structuredClone(capture),
        page: "images/after.png",
        area: "images/after-area.png",
      },
    ];
    c.web.additional[0]!.element!.text =
      "</script>\n### Fake <!-- lcr:|@|@|#fake -->";
    const markdown = renderMarkdown({
      range: "web",
      notes: [noteFromComment(c)],
    });
    const parsed = parseReview(markdown);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]!.web).toEqual(c.web);
    expect(parsed.notes[0]!.body).toBe(c.body);
    expect(renderMarkdown(parsed)).toBe(markdown);
    const html = webCaptureHtml(c.web);
    expect(html).not.toContain("<script>");
    const snapshot = historySnapshot("review.md", parsed.notes);
    parsed.notes[0]!.web!.additional![0]!.selections![1]!.element!.text =
      "changed";
    expect(
      snapshot.notes[0]!.web!.additional![0]!.selections![1]!.element!.text,
    ).toContain("Total");
    // The human-readable portion and sealed metadata must still agree.
    const tampered = markdown.replace(
      '\n  "url": ' + JSON.stringify(capture.url) + ",",
      '\n  "url": "http://localhost:3000/changed",',
    );
    expect(parseReview(tampered).notes[0]!.web).toBeUndefined();
  });
  test("multiple targets survive Markdown, parsing, history and browser evidence", () => {
    const c = comment();
    c.web.before = multiCapture();
    c.web.after = [multiCapture()];
    c.web.after[0]!.selections![1]!.element!.text = "Updated total";
    const markdown = renderMarkdown({
      range: "web",
      notes: [noteFromComment(c)],
    });
    const parsed = parseReview(markdown);
    expect(parsed.notes[0]!.web).toEqual(c.web);
    expect(renderMarkdown(parsed)).toBe(markdown);
    const snapshot = historySnapshot("review.md", parsed.notes);
    expect(snapshot.notes[0]!.web).toEqual(c.web);
    parsed.notes[0]!.web!.before.selections![1]!.element!.text =
      "Changed after snapshot";
    expect(
      snapshot.notes[0]!.web!.before.selections![1]!.element!.text,
    ).toContain("Total");
    const text = historyText({ reason: "", changes: [], snapshot }, "snapshot");
    expect(text).toContain('"selector": "[data-testid=\\"total\\"]"');
    expect(text).toContain('"x": 280');
    const html = webCaptureHtml(c.web);
    expect(html).toContain("data-testid=&quot;total&quot;");
    expect(html).toContain("OrderTotal");
    expect(html).toContain("Updated total");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  test("bounds and validates every target, including nested metadata", () => {
    const c = multiCapture(),
      target = c.selections![1]!;
    expect(webCapture(capture)).toEqual(capture);
    expect(webCapture({ ...c, selections: [target] })!.selections).toHaveLength(
      1,
    );
    expect(
      webCapture({
        ...c,
        selections: Array.from({ length: 100 }, () => target),
      })!.selections,
    ).toHaveLength(100);
    for (const selections of [
      null,
      {},
      [],
      Array.from({ length: 101 }, () => target),
      new Array(2),
      [null],
      [{}],
    ]) {
      expect(webCapture({ ...c, selections })).toBeNull();
    }
    const patches = [
      { rect: { ...target.rect, x: -1 } },
      { rect: { ...target.rect, width: 0 } },
      { rect: { ...target.rect, width: Infinity } },
      { rect: { ...target.rect, x: 1190 } },
      { rect: { ...target.rect, y: 790 } },
      { selector: 12 },
      { element: false },
      { element: { ...target.element, tag: 12 } },
      { element: { ...target.element, text: 12 } },
      { element: { ...target.element, attributes: [] } },
      { element: { ...target.element, styles: { color: 12 } } },
      { element: { ...target.element, styles: { color: "x".repeat(4001) } } },
      {
        element: {
          ...target.element,
          attributes: Object.fromEntries(
            Array.from({ length: 51 }, (_, i) => [String(i), "x"]),
          ),
        },
      },
      { components: undefined },
      { components: new Array(1) },
      { components: Array.from({ length: 31 }, () => target.components[0]) },
      { components: [{ framework: "Other", name: "x" }] },
      { components: [{ framework: "React", name: 12 }] },
      { components: [{ framework: "Vue", name: "x", file: 12 }] },
      { components: [{ framework: "Vue", name: "x", line: -1 }] },
      { components: [{ framework: "Vue", name: "x", line: 1.5 }] },
    ];
    for (const patch of patches)
      expect(
        webCapture({
          ...c,
          selections: [c.selections![0], { ...target, ...patch }],
        }),
      ).toBeNull();
    expect(
      webCaptureHtml({ before: { ...c, selections: [] }, after: [] }),
    ).toBe("");
  });
  test("whitelists and detaches each selected target independently", () => {
    const c = multiCapture(),
      target = c.selections![1]!;
    const input = {
      ...c,
      selections: [
        c.selections![0],
        {
          ...target,
          unknown: "discard",
          rect: { ...target.rect, unknown: "discard" },
          element: { ...target.element!, unknown: "discard" },
          components: target.components.map((component) => ({
            ...component,
            unknown: "discard",
          })),
        },
      ],
    };
    const clean = webCapture(input)!;
    expect(clean).toEqual(c);
    expect(JSON.stringify(clean)).not.toContain("discard");
    clean.selections![1]!.rect.x = 400;
    clean.selections![1]!.element!.attributes["data-testid"] = "changed";
    clean.selections![1]!.element!.styles.color = "blue";
    clean.selections![1]!.components[0]!.name = "Changed";
    expect(target.rect.x).toBe(280);
    expect(target.element!.attributes["data-testid"]).toBe("total");
    expect(target.element!.styles.color).toBe("red");
    expect(target.components[0]!.name).toBe("OrderTotal");
  });
  test("an older editor cannot erase later captures or the agent conversation", () => {
    const note = noteFromComment(comment());
    note.web!.after.push(structuredClone(capture));
    note.web!.additional = [multiCapture()];
    note.messages.push({ role: "agent", at: "", body: "Fixed." });
    note.status = "applied";
    const stale = comment();
    stale.web.before.title = "Do not replace the captured subject";
    stale.web.additional = [];
    const edited = applyComment(note, { ...stale, body: "Updated question" });
    expect(edited.web).toEqual(note.web);
    expect(edited.web!.additional).toHaveLength(1);
    expect(edited.web!.after).toHaveLength(1);
    expect(edited.messages).toEqual(note.messages);
    expect(edited.status).toBe("applied");
  });
  test("captures survive session restart and concurrent reviewer edits", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lcr-web-model-"));
    dirs.push(dir);
    const session = createSession(dir, ".review", "web http://localhost:3000/");
    await session.save({ comments: [comment()] });
    await Promise.all([
      session.addWebCapture(comment().id, capture),
      session.reply(comment().id, "Please compare the result."),
    ]);
    await session.save({
      comments: [{ ...comment(), body: "Make it much wider." }],
    });
    const restart = createSession(dir, ".review", "web http://localhost:3000/");
    await restart.adoptMatching();
    const note = (await restart.read()).notes[0]!;
    expect(note.web!.after).toHaveLength(1);
    expect(note.body).toBe("Make it much wider.");
    expect(note.messages[0]!.body).toBe("Please compare the result.");
    await session.remove(note.id);
    expect(await session.addWebCapture(note.id, capture)).toBeNull();
  });
  test("additional selections preserve reread agent replies through concurrent saves and restarts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lcr-web-selection-"));
    dirs.push(dir);
    const session = createSession(dir, ".review", "web");
    await session.save({ comments: [comment()] });
    const agent = createSession(dir, ".review", "web");
    await agent.adoptMatching();
    const first = { ...multiCapture(), area: "images/second.png" },
      second = { ...structuredClone(capture), area: "images/third.png" };
    await Promise.all([
      session.addWebSelection(comment().id, first),
      session.save({
        comments: [{ ...comment(), body: "Include the total too." }],
      }),
      session.addWebCapture(comment().id, capture),
      session.addWebSelection(comment().id, second),
      session.reply(comment().id, "These are separate selections."),
    ]);
    await agent.answer(
      agent.file,
      comment().id,
      "The original button is fixed.",
      "applied",
    );
    const restart = createSession(dir, ".review", "web");
    await restart.adoptMatching();
    const note = (await restart.read()).notes[0]!;
    expect(note.web!.before).toEqual(capture);
    expect(note.web!.additional).toEqual([first, second]);
    expect(note.web!.after).toEqual([capture]);
    expect(note.body).toBe("Include the total too.");
    expect(note.status).toBe("applied");
    expect(note.messages.map((message) => message.body)).toEqual([
      "These are separate selections.",
      "The original button is fixed.",
    ]);
    await expect(
      restart.save({
        comments: [{ ...comment(), body: "Saved by an older editor." }],
      }),
    ).rejects.toThrow("answered");
    await expect(restart.addWebSelection(note.id, capture)).rejects.toThrow(
      "answered",
    );
    await expect(restart.addWebCapture(note.id, capture)).rejects.toThrow(
      "answered",
    );
    await expect(
      restart.removeWebSelection(note.id, 0, webSelectionKey(capture)),
    ).rejects.toThrow("answered");
    expect((await restart.read()).notes[0]!.web!.additional).toEqual([
      first,
      second,
    ]);
    await Promise.all([
      restart.remove(note.id),
      restart.addWebSelection(note.id, capture),
    ]);
    expect((await restart.read()).notes).toEqual([]);
    expect(await restart.addWebSelection(note.id, capture)).toBeNull();
  });
  test("selection mutations enforce the boundary and detach before entering the serial queue", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "lcr-web-selection-bound-"),
    );
    dirs.push(dir);
    const session = createSession(dir, ".review", "web"),
      c = comment();
    c.web.additional = Array.from({ length: 99 }, () =>
      structuredClone(capture),
    );
    await session.save({ comments: [c] });
    const selected = multiCapture(),
      pending = session.addWebSelection(c.id, selected);
    selected.selections![1]!.element!.text = "Changed while queued";
    await pending;
    await expect(session.addWebSelection(c.id, capture)).rejects.toThrow(
      "100 additional selections",
    );
    await expect(
      session.addWebSelection(c.id, { ...capture, area: "../bad.png" }),
    ).rejects.toThrow("Invalid page selection");
    const note = (await session.read()).notes[0]!;
    expect(note.web!.additional).toHaveLength(100);
    expect(note.web!.additional![99]!.selections![1]!.element!.text).toContain(
      "Total",
    );
    expect(note.web!.before).toEqual(capture);
    expect(note.web!.after).toEqual([]);
    await session.addWebCapture(c.id, capture);
    expect((await session.read()).notes[0]!.web!.after).toEqual([capture]);
  });
  test("removal rereads current wording, replies and status, and stale editors cannot restore cleared evidence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lcr-web-removal-"));
    dirs.push(dir);
    const session = createSession(dir, ".review", "web"),
      c = comment();
    const second = { ...multiCapture(), page: "images/second.png" },
      third = { ...structuredClone(capture), page: "images/third.png" };
    c.web.additional = [second, third];
    c.web.after = [structuredClone(capture)];
    await session.save({ comments: [c] });
    await mkdir(path.join(dir, ".review", "images"), { recursive: true });
    await writeFile(path.join(dir, ".review", capture.page), "page attachment");
    await writeFile(path.join(dir, ".review", capture.area), "area attachment");
    const agent = createSession(dir, ".review", "web");
    await agent.adoptMatching();
    await Promise.all([
      session.save({ comments: [{ ...c, body: "Concurrent wording stays." }] }),
      session.removeWebSelection(c.id, 1, webSelectionKey(second)),
      session.reply(c.id, "Reviewer reply stays."),
    ]);
    const afterAdditional = (await session.read()).notes[0]!;
    expect(afterAdditional.web).toEqual({
      before: capture,
      after: [capture],
      additional: [third],
    });
    await expect(
      session.removeWebSelection(c.id, 1, webSelectionKey(second)),
    ).rejects.toThrow("changed");
    const promoted = await session.removeWebSelection(
      c.id,
      0,
      webSelectionKey(capture),
    );
    expect(promoted!.web).toEqual({ before: third, after: [] });
    await session.save({ comments: [{ ...c, body: "Stale wording edit." }] });
    expect((await session.read()).notes[0]!.web).toEqual({
      before: third,
      after: [],
    });
    await session.removeWebSelection(c.id, 0, webSelectionKey(third));
    const restart = createSession(dir, ".review", "web");
    await restart.adoptMatching();
    await restart.save({
      comments: [{ ...c, body: "Updated after reopening stale editor." }],
    });
    await agent.answer(agent.file, c.id, "Agent reply stays.", "applied");
    const note = (await restart.read()).notes[0]!;
    expect(note.web).toBeUndefined();
    expect(note.id).toBe(c.id);
    expect(note.scope).toBe("global");
    expect(note.body).toBe("Updated after reopening stale editor.");
    expect(note.status).toBe("applied");
    expect(note.messages.map((message) => message.body)).toEqual([
      "Reviewer reply stays.",
      "Agent reply stays.",
    ]);
    expect(
      await readFile(path.join(dir, ".review", capture.page), "utf8"),
    ).toBe("page attachment");
    expect(
      await readFile(path.join(dir, ".review", capture.area), "utf8"),
    ).toBe("area attachment");
    expect(
      await restart.removeWebSelection(c.id, 0, webSelectionKey(third)),
    ).toBeNull();
    await expect(restart.addWebSelection(c.id, second)).rejects.toThrow(
      "answered",
    );
    expect((await restart.read()).notes[0]!.web).toBeUndefined();
    await Promise.all([
      restart.remove(c.id),
      restart.addWebSelection(c.id, capture),
    ]);
    expect(
      await restart.removeWebSelection(c.id, 0, webSelectionKey(second)),
    ).toBeNull();
    expect(await restart.addWebSelection(c.id, capture)).toBeNull();
    expect((await restart.read()).notes).toEqual([]);
  });
  test("adding a selection initializes an overall note but never a file or line note", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lcr-web-overall-"));
    dirs.push(dir);
    const session = createSession(dir, ".review", "web");
    const overall = { ...comment(), web: undefined };
    const file = {
      id: "a.ts|*|*|#file",
      file: "a.ts",
      scope: "file" as const,
      start: 0,
      end: 0,
      body: "File note",
    };
    const line = {
      id: "a.ts|n1|n1|#line",
      file: "a.ts",
      start: 1,
      end: 1,
      body: "Line note",
    };
    await session.save({ comments: [overall, file, line] });
    for (const id of [file.id, line.id, "|@|@|#deleted"]) {
      expect(await session.addWebSelection(id, capture)).toBeNull();
      expect(
        await session.removeWebSelection(id, 0, webSelectionKey(capture)),
      ).toBeNull();
    }
    expect((await session.addWebSelection(overall.id, capture))!.web).toEqual({
      before: capture,
      after: [],
    });
    expect(
      (await session.read()).notes
        .filter((note) => note.web)
        .map((note) => note.id),
    ).toEqual([overall.id]);
  });
  test("history records and detaches web evidence independently of display state", () => {
    const n = noteFromComment(comment());
    const before = historySnapshot("review.md", [n]);
    n.web!.additional = [multiCapture()];
    const after = historySnapshot("review.md", [n]);
    expect(before.notes[0]!.web!.additional).toBeUndefined();
    n.web!.additional[0]!.element!.text = "Changed after snapshot";
    expect(after.notes[0]!.web!.additional![0]!.element!.text).toBe("Buy now");
    expect(historyChanges(before.notes, after.notes)).toHaveLength(1);
  });
});
