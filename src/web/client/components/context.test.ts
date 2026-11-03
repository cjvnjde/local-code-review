import { afterEach, describe, expect, test } from "bun:test";
import { setContextToken, uploadContext } from "./context.ts";
import { mdHtml } from "./markdown.ts";
import { webCaptureHtml } from "../web-review/web-capture.ts";
import { contextLink } from "../../../shared/context.ts";

const id = "a".repeat(64);
const ref = { id, label: "API payload" };
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setContextToken("");
});

describe("context transport", () => {
  test("invalid input, storage failures and missing durable references never report a saved attachment", async () => {
    setContextToken("secret");
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ error: "Disk full" }, { status: 507 });
    }) as typeof fetch;
    const input = {
      label: "Payload",
      text: '{"value":1}',
      type: "application/json" as const,
    };
    await expect(uploadContext({ ...input, text: "not json" })).rejects.toThrow(
      "not valid JSON",
    );
    expect(calls).toBe(0);
    await expect(uploadContext(input)).rejects.toThrow("Disk full");
    globalThis.fetch = (async () =>
      Response.json({
        context: { id: "not-a-bundle", label: "missing" },
      })) as typeof fetch;
    await expect(uploadContext(input)).rejects.toThrow(
      "saved context reference",
    );
  });
});

describe("context presentation", () => {
  test("ordinary review-relative links become safe inspectable cards, not remote previews", () => {
    const html = mdHtml("Before\n\n" + contextLink(ref) + "\n\nAfter");
    expect(html).toContain(`data-context-id="${id}"`);
    expect(html).not.toContain("<img");
    expect(mdHtml(`[<script>](context/${id}/manifest.json)`)).toContain(
      "&lt;script&gt;",
    );
    expect(
      mdHtml(`[remote](https://example.com/context/${id}/manifest.json)`),
    ).not.toContain("data-context-id");
    expect(mdHtml(`[escape](context/../${id}/manifest.json)`)).not.toContain(
      "data-context-id",
    );
    expect(mdHtml("`" + contextLink(ref) + "`")).not.toContain(
      "data-context-id",
    );
  });

  test("compact captures show their proposal and context without offering unloaded drawing edits", () => {
    const capture = {
      url: "http://localhost:3000/",
      title: "Checkout",
      at: "2026-11-02T00:00:00Z",
      mode: "area",
      rect: { x: 0, y: 0, width: 80, height: 40 },
      viewport: { width: 800, height: 600, dpr: 1 },
      scroll: { x: 0, y: 0 },
      page: "images/page.png",
      area: "images/area.png",
      components: [],
      context: ref,
      proposal: "images/proposal.png",
    };
    const html = webCaptureHtml({ before: capture, after: [] }, true);
    expect(html).toContain("/api/attachment?name=proposal.png");
    expect(html).toContain(`data-context-id="${id}"`);
    expect(html).not.toContain("data-web-annotate");
    expect(html).toContain("data-web-remove");
  });
});
