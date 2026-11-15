import { expect, test } from "bun:test";
import type { CdpCommand, CdpParams, CdpResult } from "../browser/cdp.ts";
import { CONTEXT_MAX_BYTES } from "../shared/context.ts";
import { fullPageSources } from "./full-page-sources.ts";

class SourceBrowser {
  calls: { method: string; params: unknown; session?: string }[] = [];
  source = "body{color:red}";
  async send<M extends CdpCommand>(
    method: M,
    params: CdpParams<M>,
    session?: string,
  ): Promise<CdpResult<M>> {
    this.calls.push({ method, params, session });
    let result: unknown;
    if (method === "Runtime.evaluate")
      result = {
        result: {
          value: {
            html: "<!doctype html><html><style>body{margin:0}</style><script>window.inline=1</script></html>",
            truncated: false,
            partial: false,
            inline: [
              {
                kind: "style",
                index: 0,
                source: "body{margin:0}",
                truncated: false,
              },
              {
                kind: "script",
                index: 1,
                source: "window.inline=1",
                truncated: false,
              },
            ],
          },
        },
      };
    else if (method === "Page.getResourceTree")
      result = {
        frameTree: {
          frame: { id: "main" },
          resources: [
            {
              type: "Stylesheet",
              url: "http://user:password@localhost/style.css?token=secret#fragment",
            },
            { type: "Script", url: "http://localhost/app.js" },
            { type: "Script", url: "http://localhost/missing.js" },
            { type: "Image", url: "http://localhost/not-source.png" },
          ],
          childFrames: [
            {
              frame: { id: "child" },
              resources: [
                { type: "Stylesheet", url: "http://localhost/child.css" },
              ],
            },
          ],
        },
      };
    else if (method === "Page.getResourceContent") {
      const { url } = params as CdpParams<"Page.getResourceContent">;
      if (url.endsWith("missing.js")) throw new Error("not cached");
      result = url.endsWith("app.js")
        ? {
            content: Buffer.from("window.external=1").toString("base64"),
            base64Encoded: true,
          }
        : { content: this.source, base64Encoded: false };
    } else throw new Error(`Unexpected request: ${method}`);
    return result as CdpResult<M>;
  }
}
const enabled = { enabled: true, private: false, point: false };

test("disabled, private and point source context never reads browser content", async () => {
  for (const policy of [
    { ...enabled, enabled: false },
    { ...enabled, private: true },
    { ...enabled, point: true },
  ]) {
    const browser = new SourceBrowser();
    const parts = await fullPageSources(browser, "review", policy);
    expect(parts.map((part) => part.name)).toEqual([
      "full-page-html",
      "full-page-css",
      "full-page-js",
    ]);
    expect(
      parts.every(
        (part) =>
          part.status === "excluded" &&
          part.data === undefined &&
          !!part.detail,
      ),
    ).toBe(true);
    expect(browser.calls).toHaveLength(0);
  }
});

test("sources retain inline and cached resource provenance, decoding and explicit partial failures", async () => {
  const browser = new SourceBrowser();
  const parts = await fullPageSources(browser, "review", enabled);
  expect(parts[0]!.type).toBe("text/plain");
  expect(parts[0]!.data).toContain("<!doctype html>");
  const css = JSON.parse(parts[1]!.data as string);
  const js = JSON.parse(parts[2]!.data as string);
  expect(css.sources[0].source).toBe("body{margin:0}");
  expect(css.sources[1].url).toBe("http://localhost/style.css");
  expect(css.sources[2].frame).toBe("child");
  expect(js.sources[0].source).toBe("window.inline=1");
  expect(js.sources[1].source).toBe("window.external=1");
  expect(js.sources[2].status).toBe("unavailable");
  expect(js.partial).toBe(true);
  expect(browser.calls.every((call) => call.session === "review")).toBe(true);
  expect(
    browser.calls.filter((call) => call.method === "Page.getResourceContent"),
  ).toHaveLength(4);
  browser.source = "changed after capture";
  expect(parts[1]!.data).not.toContain("changed after capture");
});

test("source limits preserve valid UTF-8 and bounded JSON text evidence", async () => {
  const browser = new SourceBrowser();
  browser.source = "😀\u0000".repeat(300_000);
  const parts = await fullPageSources(browser, "review", enabled);
  for (const part of parts)
    expect(Buffer.byteLength(part.data as string)).toBeLessThanOrEqual(
      CONTEXT_MAX_BYTES,
    );
  const css = JSON.parse(parts[1]!.data as string);
  expect(parts[1]!.truncated).toBe(true);
  expect(css.sources[1].truncated).toBe(true);
  expect(css.sources[1].source).not.toContain("\ufffd");
  expect(Buffer.byteLength(css.sources[1].source)).toBeLessThanOrEqual(
    256 * 1024,
  );
});

test("disconnected browser leaves document unavailable and source inventory explicitly partial", async () => {
  const parts = await fullPageSources(null, "", enabled);
  expect(parts[0]!.status).toBe("unavailable");
  for (const part of parts.slice(1)) {
    const data = JSON.parse(part.data as string);
    expect(data.resourceInventory).toBe("unavailable");
    expect(data.partial).toBe(true);
    expect(data.sources).toEqual([]);
  }
});
