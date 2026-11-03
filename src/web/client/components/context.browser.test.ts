import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../../../browser/review-browser.ts";

const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;

browserTest(
  "context uploads protect drafts and the viewer retrieves only selected authenticated parts",
  async () => {
    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "context.ts")],
      target: "browser",
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);
    const script = await bundle.outputs[0]!.text();
    const id = "b".repeat(64);
    const ref = { id, label: "Saved details" };
    const requests: string[] = [];
    const uploads: unknown[] = [];
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/context.js")
          return new Response(script, {
            headers: { "content-type": "text/javascript" },
          });
        if (url.pathname === "/api/settings")
          return Response.json({ contextToken: "browser-secret" });
        if (url.pathname.startsWith("/api/ai-context")) {
          requests.push(url.pathname + url.search);
          if (req.headers.get("authorization") !== "Bearer browser-secret")
            return new Response("unauthorized", { status: 401 });
          if (req.method === "POST") {
            if (
              req.headers.get("content-type")?.startsWith("multipart/form-data")
            ) {
              const form = await req.formData();
              const file = form.get("file") as File;
              uploads.push({ name: file.name, text: await file.text() });
            } else uploads.push(await req.json());
            if (uploads.length === 1) {
              started.resolve();
              await gate.promise;
              return Response.json(
                { error: "Storage unavailable" },
                { status: 507 },
              );
            }
            return Response.json({ context: ref });
          }
          if (url.pathname.endsWith("/parts/text")) {
            const offset = Number(url.searchParams.get("offset"));
            return Response.json({
              content: offset ? "tail" : "<script>window.hacked=true</script>",
              offset,
              nextOffset: offset ? null : 34,
              totalBytes: 38,
            });
          }
          if (url.pathname.endsWith("/parts/image"))
            return new Response(
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5AAAAABJRU5ErkJggg==",
                "base64",
              ),
              { headers: { "content-type": "image/png" } },
            );
          return Response.json({
            version: 1,
            id,
            label: ref.label,
            at: "2026-11-02T00:00:00Z",
            parts: [
              {
                name: "text",
                label: "Text",
                type: "text/plain",
                status: "available",
                bytes: 38,
              },
              {
                name: "image",
                label: "Image",
                type: "image/png",
                status: "available",
                bytes: 68,
                file: "image.png",
              },
              {
                name: "excluded",
                label: "Selected HTML",
                type: "text/html",
                status: "excluded",
                bytes: 0,
                detail: "Not opted in",
              },
            ],
          });
        }
        return new Response(
          `<!doctype html><main><div id="composer"><textarea id="note">Before after</textarea><button class="context-add">Add context</button><button id="save">Save note</button></div><div id="cards"></div></main><script type="module">
        import {wireContext,watchContext,contextCard} from '/context.js';
        window.saved=0;window.inputs=0;window.revoked=[];window.created=[];
        const make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
        URL.createObjectURL=b=>{const u=make(b);created.push(u);return u;};URL.revokeObjectURL=u=>{revoked.push(u);revoke(u);};
        const note=document.querySelector('#note');note.setSelectionRange(6,6);note.addEventListener('input',()=>inputs++);
        document.querySelector('#save').onclick=()=>saved++;
        wireContext(document.querySelector('#composer'),note,'note-id');watchContext();
        document.querySelector('#cards').innerHTML=contextCard(${JSON.stringify(ref)});window.ready=true;
      </script>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const profile = await mkdtemp(path.join(tmpdir(), "lcr-context-browser-"));
    let chrome: ReviewBrowser | undefined;
    try {
      chrome = await launchReviewBrowser(profile, [
        "--headless=new",
        "--window-size=1000,900",
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
      await js(
        `document.querySelector('.context-add').click();document.querySelector('[data-context-text]').value='{"foo":1}';document.querySelector('[data-context-type]').value='application/json';document.querySelector('[data-context-save]').click();`,
      );
      await started.promise;
      expect(await js("document.querySelector('#note').value")).toBe(
        "Before after",
      );
      expect(await js("document.querySelector('#save').disabled")).toBe(true);
      expect(
        await js(
          "document.querySelector('#note').hasAttribute('data-context-busy')",
        ),
      ).toBe(true);
      expect(
        await js(
          "document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}))",
        ),
      ).toBe(false);
      await js("document.querySelector('#save').click()");
      expect(await js("saved")).toBe(0);
      gate.resolve();
      await until(
        "document.querySelector('.context-status')?.textContent.includes('Storage unavailable')",
      );
      expect(await js("document.querySelector('#note').value")).toBe(
        "Before after",
      );
      expect(
        await js("document.querySelector('[data-context-text]').value"),
      ).toBe('{"foo":1}');
      expect(await js("document.querySelector('#save').disabled")).toBe(false);
      await js("document.querySelector('[data-context-save]').click()");
      await until("!document.querySelector('dialog')");
      expect(await js("document.querySelector('#note').value")).toBe(
        `Before\n\n[Additional context: Saved details](context/${id}/manifest.json)\n\nafter`,
      );
      expect(await js("inputs")).toBe(1);
      expect(
        await js(
          "document.querySelector('#note').hasAttribute('data-context-busy')",
        ),
      ).toBe(false);
      await js("document.querySelector('#save').click()");
      expect(await js("saved")).toBe(1);

      await js(
        `document.querySelector('.context-add').click();const transfer=new DataTransfer();transfer.items.add(new File(['trace'],'trace.txt',{type:'text/plain'}));const file=document.querySelector('[data-context-file]');file.files=transfer.files;file.dispatchEvent(new Event('change'));document.querySelector('[data-context-save]').click();`,
      );
      await until("!document.querySelector('dialog')");
      expect(uploads.at(-1)).toEqual({ name: "trace.txt", text: "trace" });
      expect(await js("inputs")).toBe(2);

      requests.length = 0;
      await js("document.querySelector('.context-card').click()");
      await until("document.querySelector('.context-manifest li')");
      expect(requests).toEqual(["/api/ai-context/" + id]);
      expect(
        await js(
          "document.querySelector('.context-manifest li:last-child button').disabled",
        ),
      ).toBe(true);
      expect(
        await js("document.querySelector('.context-manifest').textContent"),
      ).toContain("Not opted in");
      await js("document.querySelector('.context-manifest button').click()");
      await until(
        "document.querySelector('.context-preview pre')?.textContent.includes('script')",
      );
      expect(requests.at(-1)).toBe(
        `/api/ai-context/${id}/parts/text?offset=0&limit=16384`,
      );
      expect(await js("window.hacked===undefined")).toBe(true);
      await js("document.querySelector('.context-preview button').click()");
      await until(
        "document.querySelector('.context-preview pre')?.textContent.endsWith('tail')",
      );
      expect(requests.at(-1)).toBe(
        `/api/ai-context/${id}/parts/text?offset=34&limit=16384`,
      );
      await js(
        "document.querySelectorAll('.context-manifest button')[1].click()",
      );
      await until("document.querySelector('.context-preview img')");
      expect(
        await js(
          "document.querySelector('.context-preview img').src.startsWith('blob:')",
        ),
      ).toBe(true);
      expect(await js("created.length")).toBe(1);
      await js("document.querySelector('[data-context-close]').click()");
      await until("!document.querySelector('dialog')");
      expect(await js("revoked")).toEqual(await js("created"));
    } finally {
      gate.resolve();
      await chrome?.close();
      server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  60000,
);
