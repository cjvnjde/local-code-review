import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../../../browser/review-browser.ts";
import { webReviewLines, type WebCapture } from "../../../shared/web-review.ts";
import { webCaptureHtml } from "./web-capture.ts";

const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;
browserTest(
  "capture comparison is opt-in, keyboard accessible, independent and alignment-safe",
  async () => {
    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "capture-comparison-ui.ts")],
      target: "browser",
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);
    const script = await bundle.outputs[0]!.text();
    const css = await Bun.file(
      path.join(import.meta.dir, "../../styles/web-review.css"),
    ).text();
    const before: WebCapture = {
      url: "http://localhost:3000/",
      title: "Checkout",
      at: "2026-11-05T10:00:00Z",
      mode: "element",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      viewport: { width: 800, height: 600, dpr: 2 },
      scroll: { x: 0, y: 0 },
      page: "images/page.png",
      area: "images/before.png",
      components: [],
      selector: "#checkout",
      element: {
        tag: "button",
        text: '<img src=x onerror="window.inspectionXss=true">',
        attributes: { id: "checkout" },
        styles: {
          width: "80px",
          height: "20px",
          padding: "8px",
          "font-weight": "600",
          color: "rgb(20, 40, 60)",
        },
      },
    };
    const after = {
      ...before,
      area: "images/after.png",
      at: "2026-11-05T10:05:00Z",
    };
    const original = { before, after: [] };
    const reply = { before: after, after: [] };
    const saved = webCaptureHtml(original, true, [
      { role: "reviewer", body: webReviewLines(reply).join("\n").trimEnd() },
    ]);
    const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>
    <main style="width:360px">
      <div id="primary">${saved}</div><div id="duplicate">${saved}</div>
      <div id="geometry">${webCaptureHtml({ before, after: [{ ...after, rect: { ...after.rect, x: 1 } }] })}</div>
      <div id="dimension">${webCaptureHtml({ before, after: [{ ...after, area: "images/different.png" }] })}</div>
      <div id="missing">${webCaptureHtml({ before, after: [{ ...after, area: "images/missing.png" }] })}</div>
      <div id="point">${webCaptureHtml({ before: { ...before, mode: "point", page: undefined, area: undefined }, after: [] }, true)}</div>
      <div id="unpaired">${webCaptureHtml({ ...original, additional: [after] })}</div>
      <div id="pending" class="nbox">${webCaptureHtml(original, true)}<div data-reply-evidence>${webCaptureHtml(reply, true)}</div><textarea>Unsent reply</textarea></div>
    </main><script type="module">import {hydrateCaptureComparisons} from '/comparison.js';hydrateCaptureComparisons();window.ready=true;</script>`;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/comparison.js")
          return new Response(script, {
            headers: { "content-type": "text/javascript" },
          });
        if (url.pathname === "/api/attachment") {
          const name = url.searchParams.get("name");
          if (name === "missing.png")
            return new Response("Missing", { status: 404 });
          return new Response(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${name === "different.png" ? 180 : 200}" height="80"><rect width="100%" height="100%" fill="${name === "before.png" ? "red" : "blue"}"/></svg>`,
            { headers: { "content-type": "image/svg+xml" } },
          );
        }
        return new Response(html, { headers: { "content-type": "text/html" } });
      },
    });
    const profile = await mkdtemp(
      path.join(tmpdir(), "lcr-comparison-browser-"),
    );
    let chrome: ReviewBrowser | undefined;
    try {
      chrome = await launchReviewBrowser(profile, [
        "--headless=new",
        "--window-size=700,900",
      ]);
      const { targetId } = await chrome.cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await chrome.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const send = (method: string, params = {}) =>
        chrome!.cdp.send(method, params, sessionId);
      const js = async (expression: string) => {
        const result = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails)
          throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const until = (condition: string) =>
        js(
          `(()=>{const ready=()=>${condition};if(ready())return;const gate=Promise.withResolvers();const observer=new MutationObserver(()=>{if(ready()){observer.disconnect();gate.resolve();}});observer.observe(document,{childList:true,subtree:true,attributes:true,characterData:true});return gate.promise;})()`,
        );
      await send("Page.enable");
      const loaded = Promise.withResolvers<void>();
      const off = chrome.cdp.on("Page.loadEventFired", (_, session) => {
        if (session === sessionId) loaded.resolve();
      });
      await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/` });
      await loaded.promise;
      off();
      expect(await js("window.ready")).toBe(true);
      expect(
        await js("document.querySelector('#primary .web-inspection').open"),
      ).toBe(false);
      await js(
        "document.querySelector('#primary .web-inspection > summary').focus()",
      );
      for (const type of ["keyDown", "keyUp"])
        await send("Input.dispatchKeyEvent", {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          text: type === "keyDown" ? "\r" : undefined,
        });
      expect(
        await js("document.querySelector('#primary .web-inspection').open"),
      ).toBe(true);
      expect(
        await js(
          `Object.fromEntries([...document.querySelectorAll('#primary .web-inspection dt')].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]))`,
        ),
      ).toMatchObject({
        "Selected size": "100 × 40 CSS px",
        "CSS width": "80px",
        "CSS height": "20px",
        Padding: "8px",
        "Font weight": "600",
        "Text color": "rgb(20, 40, 60)",
      });
      expect(
        await js(
          "document.querySelector('#primary .web-inspection p:nth-of-type(2)').textContent",
        ),
      ).toBe(before.element!.text);
      expect(
        await js("document.querySelector('#primary .web-inspection img')"),
      ).toBeNull();
      expect(await js("window.inspectionXss === true")).toBe(false);
      expect(
        await js("document.querySelector('#duplicate .web-inspection').open"),
      ).toBe(false);
      expect(
        await js("document.querySelectorAll('.web-compare input').length"),
      ).toBe(0);
      expect(
        await js(
          "document.querySelector('#point img, #point [data-web-annotate], #point .web-compare')",
        ),
      ).toBeNull();
      expect(
        await js("document.querySelector('#unpaired .web-compare')"),
      ).toBeNull();
      await js(
        "document.querySelector('#primary .web-compare').open=true;document.querySelector('#primary .web-compare-modes button:last-child').click()",
      );
      await until("!!document.querySelector('#primary input[type=range]')");
      expect(
        await js(
          "document.querySelector('#primary input').getAttribute('aria-valuetext')",
        ),
      ).toContain("50% comparison");
      await js("document.querySelector('#primary input').focus()");
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "End",
        code: "End",
        windowsVirtualKeyCode: 35,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "End",
        code: "End",
        windowsVirtualKeyCode: 35,
      });
      expect(await js("document.querySelector('#primary input').value")).toBe(
        "100",
      );
      expect(await js("document.querySelector('#duplicate input')")).toBeNull();
      expect(
        await js(
          "document.querySelector('#primary .web-compare-wipe').getBoundingClientRect().width<=document.querySelector('#primary').getBoundingClientRect().width",
        ),
      ).toBe(true);
      expect(
        await js(
          "document.querySelector('#geometry .web-compare-modes button:last-child').disabled",
        ),
      ).toBe(true);
      await js(
        "document.querySelector('#geometry .web-compare').open=true;document.querySelector('#geometry .web-compare-modes button:first-child').click()",
      );
      await until(
        "document.querySelectorAll('#geometry .web-compare-side img').length===2",
      );
      await js(
        "document.querySelector('#dimension .web-compare').open=true;document.querySelector('#dimension .web-compare-modes button:last-child').click()",
      );
      await until(
        "document.querySelector('#dimension .web-compare-status').textContent.includes('dimensions differ')",
      );
      expect(await js("document.querySelector('#dimension input')")).toBeNull();
      await js(
        "document.querySelector('#missing .web-compare').open=true;document.querySelector('#missing .web-compare-modes button:last-child').click()",
      );
      await until(
        "document.querySelector('#missing .web-compare-status').textContent.includes('could not load')",
      );
      expect(await js("document.querySelector('#missing input')")).toBeNull();
      expect(
        await js("document.querySelectorAll('#pending .web-compare').length"),
      ).toBe(1);
      expect(
        await js(
          "document.querySelectorAll('#pending [data-web-remove]').length",
        ),
      ).toBe(2);
      expect(
        await js("document.querySelector('#pending textarea').value"),
      ).toBe("Unsent reply");
    } finally {
      await chrome?.close();
      server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  30_000,
);
