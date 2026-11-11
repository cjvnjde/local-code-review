import { describe, expect, test } from "bun:test";
import {
  webReviewLines,
  type WebCapture,
  type WebReview,
} from "../../../shared/web-review.ts";
import {
  canCompareCaptures,
  captureComparisons,
  conversationWeb,
  splitWebMessage,
  wipeImageMismatch,
  wipeMismatch,
} from "./capture-comparison.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { WebEvidence } from "./evidence.tsx";
const webCaptureHtml = (value: unknown) =>
  renderToStaticMarkup(createElement(WebEvidence, { value }));

const before: WebCapture = {
  url: "http://localhost:3000/checkout",
  title: "Checkout",
  at: "2026-11-05T10:00:00.000Z",
  mode: "element",
  rect: { x: 20, y: 30, width: 100, height: 40 },
  viewport: { width: 800, height: 600, dpr: 2 },
  scroll: { x: 0, y: 12 },
  page: "images/before-page.png",
  area: "images/before.png",
  components: [],
};
const after: WebCapture = {
  ...before,
  at: "2026-11-05T10:05:00.000Z",
  area: "images/after.png",
  page: "images/after-page.png",
};
const original: WebReview = { before, after: [] };
const subsequent: WebReview = { before: after, after: [] };

describe("capture comparison eligibility", () => {
  test("real original images at matching capture geometry allow a wipe", () => {
    expect(canCompareCaptures(before, after)).toBe(true);
    expect(wipeMismatch(before, after)).toBeNull();
    expect(
      wipeImageMismatch({ width: 200, height: 80 }, { width: 200, height: 80 }),
    ).toBeNull();
  });
  test("different image dimensions and load failures cannot imply alignment", () => {
    expect(
      wipeImageMismatch({ width: 200, height: 80 }, { width: 201, height: 80 }),
    ).not.toBeNull();
    expect(
      wipeImageMismatch({ width: 200, height: 80 }, { width: 200, height: 81 }),
    ).not.toBeNull();
    expect(
      wipeImageMismatch({ width: 0, height: 0 }, { width: 0, height: 0 }),
    ).not.toBeNull();
  });
  test("different URL, missing screenshots and the same evidence are not pairs", () => {
    expect(
      canCompareCaptures(before, { ...after, url: before.url + "?tab=other" }),
    ).toBe(false);
    expect(canCompareCaptures(before, { ...after, area: undefined })).toBe(
      false,
    );
    expect(canCompareCaptures({ ...before, area: undefined }, after)).toBe(
      false,
    );
    expect(canCompareCaptures(before, before)).toBe(false);
  });
  test("viewport, DPR, scroll and each selection boundary disable wipe, not side by side", () => {
    const variants: WebCapture[] = [
      ...(["width", "height", "dpr"] as const).map((key) => ({
        ...after,
        viewport: { ...after.viewport, [key]: after.viewport[key] + 1 },
      })),
      ...(["x", "y", "width", "height"] as const).map((key) => ({
        ...after,
        rect: { ...after.rect, [key]: after.rect[key] + 1 },
      })),
      ...(["x", "y"] as const).map((key) => ({
        ...after,
        scroll: { ...after.scroll, [key]: after.scroll[key] + 1 },
      })),
      { ...after, mode: "area" },
    ];
    for (const variant of variants) {
      expect(canCompareCaptures(before, variant)).toBe(true);
      expect(wipeMismatch(before, variant)).not.toBeNull();
    }
  });
  test("additional selections are original choices, never automatically after evidence", () => {
    const captures = captureComparisons({ ...original, additional: [after] });
    expect(captures.originals).toHaveLength(2);
    expect(captures.evidence).toEqual([]);
  });
  test("saved conversation evidence and legacy after captures use untouched originals", () => {
    const proposal = {
      ...after,
      context: { id: "a".repeat(64), label: "Drawing" },
      proposal: "images/proposal.png",
    };
    const pairs = captureComparisons({ ...original, after: [after] }, [
      {
        role: "reviewer",
        body:
          "Updated page\n\n" +
          webReviewLines({
            before: proposal,
            after: [],
            additional: [after],
          }).join("\n"),
      },
    ]);
    expect(pairs.evidence).toHaveLength(3);
    expect(pairs.evidence.map((entry) => entry.capture.area)).toEqual([
      after.area,
      after.area,
      after.area,
    ]);
    expect(JSON.stringify(pairs)).not.toContain("proposal.png");
    expect(pairs.evidence[2]!.label).toContain("selection 2");
  });
});

describe("sealed conversation captures", () => {
  const block = webReviewLines(subsequent).join("\n");
  test("canonical blocks render as evidence with surrounding prose preserved", () => {
    const parts = splitWebMessage(
      "Before prose\n\n" + block + "\n\nAfter prose",
    );
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "Before prose\n\n" });
    expect("web" in parts[1]!).toBe(true);
    expect(parts[2]).toEqual({ text: "\nAfter prose" });
    expect(conversationWeb(block)).toHaveLength(1);
  });
  test("literal code, escaped markers and changed/missing evidence stay ordinary text", () => {
    for (const body of [
      "```md\n" + block + "\n```",
      "~~~~\n" + block + "\n~~~~",
      "\\" + block,
      block.split("\n")[0]!,
      block.replace("UI capture:", "Literal capture:"),
    ]) {
      expect(conversationWeb(body)).toEqual([]);
      expect(splitWebMessage(body)).toEqual([{ text: body }]);
    }
  });
  test("persisted replies may trim terminal blank lines without losing capture identity", () => {
    expect(conversationWeb(block.trimEnd())).toHaveLength(1);
    expect(
      conversationWeb("Reviewer prose\n\n" + block.trimEnd()),
    ).toHaveLength(1);
  });
});

describe("Point capture presentation", () => {
  test("metadata-only Point retains metadata and removal without images or drawing", () => {
    const point = {
      ...before,
      mode: "point" as const,
      page: undefined,
      area: undefined,
    };
    const html = webCaptureHtml({ before: point, after: [] });
    expect(html).toContain("Selection details");
    expect(html).toContain("Selection 1");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-web-annotate");
    expect(html).not.toContain("Page screenshot");
  });
  test("legacy Point screenshots remain readable and separate from proposal images", () => {
    const html = webCaptureHtml({
      before: { ...before, mode: "point" },
      after: [],
    });
    expect(html).toContain("ref=images%2Fbefore.png");
    expect(html).toContain("Selection 1");
    expect(html).not.toContain("metadata only");
  });
});
