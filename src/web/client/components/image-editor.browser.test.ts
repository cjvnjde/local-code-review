import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../../../browser/review-browser.ts";
import { readAttachment, saveAttachment } from "../../../review/attach.ts";
import { decodeImageDrawing } from "../../../shared/image-drawing.ts";

const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;

browserTest(
  "pasted comment and reply images preview, draw, reopen after reload and restore their originals",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "lcr-comment-images-"));
    let browser: ReviewBrowser | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
      const entry = path.join(directory, "entry.ts");
      await writeFile(
        entry,
        [
          `export {wireImageEditor} from ${JSON.stringify(path.join(import.meta.dir, "image-editor.ts"))};`,
          `export {wireAttach} from ${JSON.stringify(path.join(import.meta.dir, "attach.ts"))};`,
          `export {watchImagePreviews} from ${JSON.stringify(path.join(import.meta.dir, "image-preview.ts"))};`,
          `export {startNavigation} from ${JSON.stringify(path.join(import.meta.dir, "../navigation/ui-navigation.ts"))};`,
        ].join("\n"),
      );
      const build = await Bun.build({
        entrypoints: [entry],
        target: "browser",
      });
      if (!build.success) throw new AggregateError(build.logs);
      const script = await build.outputs[0]!.text();
      let saved = "";
      server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === "/entry.js")
            return new Response(script, {
              headers: { "content-type": "text/javascript" },
            });
          if (url.pathname.startsWith("/styles/"))
            return new Response(
              Bun.file(
                path.join(
                  import.meta.dir,
                  "../../styles",
                  url.pathname.slice(8),
                ),
              ),
            );
          if (url.pathname === "/api/attach") {
            const name = await saveAttachment(
              directory,
              ".review",
              new Uint8Array(await request.arrayBuffer()),
              request.headers.get("content-type")!,
            );
            return Response.json({ ref: "images/" + name });
          }
          if (url.pathname === "/api/attachment") {
            const found = await readAttachment(
              directory,
              ".review",
              url.searchParams.get("name")!,
            );
            return found
              ? new Response(found.bytes, {
                  headers: { "content-type": found.type },
                })
              : new Response("missing", { status: 404 });
          }
          if (url.pathname === "/save") {
            saved = await request.text();
            return new Response("ok");
          }
          return new Response(
            `<!doctype html><link rel="stylesheet" href="/styles/index.css">
          <div class="nbox"><div class="nedit"><textarea id="note"></textarea><button class="attb">Image</button></div>
          <div class="reply"><textarea id="reply"></textarea><button class="attb">Image</button></div></div>
          <script type="module">
            import {wireImageEditor,wireAttach,watchImagePreviews,startNavigation} from '/entry.js';
            note.value=${JSON.stringify(saved)};
            for(const ta of [note,reply]){wireAttach(ta.parentElement,ta);wireImageEditor(ta.parentElement,ta,'test');}
            watchImagePreviews();startNavigation();window.confirm=()=>true;window.ready=true;
            window.pasteImage=async(id)=>{
              const canvas=document.createElement('canvas');canvas.width=400;canvas.height=240;
              const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,400,240);ctx.fillStyle='#16803c';ctx.fillRect(100,60,30,30);
              const encoded=Promise.withResolvers();canvas.toBlob(encoded.resolve);const file=new File([await encoded.promise],'image.png',{type:'image/png'});
              const data=new DataTransfer();data.items.add(file);document.getElementById(id).dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
            };
          </script>`,
            { headers: { "content-type": "text/html" } },
          );
        },
      });
      browser = await launchReviewBrowser(path.join(directory, "profile"), [
        "--headless=new",
        "--window-size=1400,1000",
      ]);
      const { targetId } = await browser.cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await browser.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const send = (method: string, params = {}) =>
        browser!.cdp.send(method, params, sessionId);
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
      const until = async (condition: string) => {
        for (let i = 0; i < 200; i++) {
          if (await js(condition)) return;
          await Bun.sleep(25);
        }
        throw new Error("Timed out: " + condition);
      };
      const click = (selector: string) =>
        js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await send("Page.enable");
      await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/` });
      await until("window.ready===true");
      await js(
        "note.value='Before after';note.focus();note.setSelectionRange(6,6);pasteImage('note')",
      );
      await until(
        "document.querySelectorAll('.nedit .composer-image').length===1&&!note.hasAttribute('data-attachment-busy')",
      );
      const originalText = await js("note.value");
      const originalRef = /\]\(([^)]+)\)/.exec(originalText)![1]!;
      expect(originalText).toBe(
        `Before\n\n![screenshot](${originalRef})\n\nafter`,
      );
      await click(".nedit .composer-image-preview");
      await until("!!document.querySelector('.image-viewer[open] img')");
      await js(
        "[...document.querySelectorAll('.image-viewer button')].find(b=>b.textContent==='100%').click()",
      );
      expect(
        await js(
          "document.querySelector('.image-viewer img').classList.contains('actual')",
        ),
      ).toBe(true);
      await js(
        "[...document.querySelectorAll('.image-viewer button')].find(b=>b.textContent==='Draw / edit').click()",
      );
      await until(
        "!!document.querySelector('[data-command=apply]')&&!document.querySelector('[data-command=apply]').disabled",
      );
      // Browser navigation closes and restores the same drawing without replacing the comment.
      await js("history.back()");
      await until("!document.querySelector('[data-annotation-editor]')");
      await js("history.forward()");
      await until(
        "!!document.querySelector('[data-command=apply]')&&!document.querySelector('[data-command=apply]').disabled",
      );
      await click("[data-tool=arrow]");
      const bounds = await js(
        "(()=>{const r=document.querySelector('[data-annotation-editor] canvas').getBoundingClientRect();return {x:r.x,y:r.y,scale:r.width/528}})()",
      );
      const mouse = (type: string, x: number, y: number, buttons: number) =>
        send("Input.dispatchMouseEvent", {
          type,
          x: bounds.x + x * bounds.scale,
          y: bounds.y + y * bounds.scale,
          button: "left",
          buttons,
          clickCount: 1,
        });
      await mouse("mousePressed", 100, 100, 1);
      await mouse("mouseMoved", 260, 170, 1);
      await mouse("mouseReleased", 260, 170, 0);
      await click("[data-command=apply]");
      await until(
        "!document.querySelector('[data-annotation-editor]')&&!note.hasAttribute('data-image-busy')",
      );
      const drawnText = await js("note.value");
      const drawnRef = /\]\(([^)]+)\)/.exec(drawnText)![1]!;
      expect(drawnRef).not.toBe(originalRef);
      expect(drawnText).toBe(originalText.replace(originalRef, drawnRef));
      expect(await js("document.activeElement===note")).toBe(true);
      const output = await readAttachment(directory, ".review", drawnRef);
      const drawing = decodeImageDrawing(output!.bytes, drawnRef)!;
      expect(drawing.source).toBe(originalRef);
      expect(drawing.annotation.marks[0]!.tool).toBe("arrow");
      expect(drawing.annotation.marks.length).toBe(1);
      expect(
        await readAttachment(directory, ".review", originalRef),
      ).not.toBeNull();
      await js("fetch('/save',{method:'POST',body:note.value})");
      await send("Page.reload");
      await until(
        "window.ready===true&&document.querySelectorAll('.nedit .composer-image').length===1",
      );
      await click(".nedit [data-image-draw]");
      await until(
        "!!document.querySelector('[data-command=clear]')&&!document.querySelector('[data-command=clear]').disabled",
      );
      // Marks are vectors after a full page reload, rather than painted into the editable source.
      expect(
        await js("document.querySelector('[data-field=mark]').options.length"),
      ).toBe(2);
      await click("[data-command=clear]");
      await click("[data-command=apply]");
      await until("!document.querySelector('[data-annotation-editor]')");
      expect(await js("note.value")).toBe(originalText);
      await send("Page.captureScreenshot", { format: "png" }).then((result) =>
        Bun.write(
          "/tmp/lcr-comment-images-smoke.png",
          Buffer.from(result.data, "base64"),
        ),
      );
      await js("pasteImage('reply')");
      await until(
        "document.querySelectorAll('.reply .composer-image').length===1",
      );
      await click(".reply [data-image-draw]");
      await until(
        "!!document.querySelector('[data-command=apply]')&&!document.querySelector('[data-command=apply]').disabled",
      );
      await click("[data-command=cancel]");
      await until("!document.querySelector('[data-annotation-editor]')");
      expect(await js("note.value")).toBe(originalText);
      expect(await js("reply.value")).toBe(`![screenshot](${originalRef})`);
    } finally {
      await browser?.close();
      server?.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
