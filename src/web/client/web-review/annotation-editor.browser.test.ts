import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../../../browser/review-browser.ts";
import {
  webAnnotation,
  type WebAnnotation,
} from "../../../shared/web-annotation.ts";

const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;
type Point = { x: number; y: number };

async function withEditor(
  run: (ui: {
    js(code: string): Promise<any>;
    click(selector: string): Promise<void>;
    drag(
      from: Point,
      to: Point,
      modifiers?: number,
      cancel?: boolean,
    ): Promise<void>;
    point(at: Point, count?: number): Promise<void>;
    key(key: string): Promise<void>;
    save(): Promise<WebAnnotation>;
    reopen(): Promise<void>;
  }) => Promise<void>,
) {
  const bundle = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "annotation-editor.ts")],
    target: "browser",
  });
  if (!bundle.success) throw new AggregateError(bundle.logs);
  const script = await bundle.outputs[0]!.text();
  let source: Uint8Array = new Uint8Array(),
    output: Uint8Array = new Uint8Array();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/editor.js")
        return new Response(script, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname.startsWith("/styles/"))
        return new Response(
          Bun.file(
            path.join(import.meta.dir, "../../styles", url.pathname.slice(8)),
          ),
        );
      if (url.pathname === "/source") {
        source = new Uint8Array(await req.arrayBuffer());
        return new Response("ok");
      }
      if (url.pathname === "/api/attachment")
        return new Response(
          url.searchParams.get("name") === "proposal.png" ? output : source,
          { headers: { "content-type": "image/png" } },
        );
      if (url.pathname === "/api/attach") {
        output = new Uint8Array(await req.arrayBuffer());
        return Response.json({ ref: "images/proposal.png" });
      }
      return new Response(
        `<!doctype html><link rel="stylesheet" href="/styles/index.css"><textarea id="note">Keep my note</textarea><script type="module">
      import {openAnnotation} from '/editor.js';
      const c=document.createElement('canvas');c.width=640;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,640,400);ctx.fillStyle='#111';ctx.fillText('Original screenshot',30,30);
      const encoded=Promise.withResolvers();c.toBlob(encoded.resolve);
      await fetch('/source',{method:'POST',body:await encoded.promise});
      window.capture={mode:'area',url:location.origin,title:'Test',viewport:{width:640,height:400,dpr:1},scroll:{x:0,y:0},rect:{x:0,y:0,width:640,height:400},page:'images/source.png',area:'images/source.png'};
      window.applied=[];window.confirm=()=>true;window.openEditor=()=>openAnnotation('test',capture,async a=>applied.push(a));window.openEditor();
    </script>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  const profile = await mkdtemp(path.join(tmpdir(), "lcr-drawing-browser-"));
  let chrome: ReviewBrowser | undefined;
  try {
    chrome = await launchReviewBrowser(profile, [
      "--headless=new",
      "--window-size=1500,1000",
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
    await send("Page.enable");
    const loaded = Promise.withResolvers<void>();
    const off = chrome.cdp.on("Page.loadEventFired", (_, session) => {
      if (session === sessionId) loaded.resolve();
    });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/` });
    await loaded.promise;
    off();
    const js = async (code: string) => {
      const r = await send("Runtime.evaluate", {
        expression: code,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const until = (condition: string) =>
      js(`(()=>{
      const ready=()=>${condition};if(ready())return;
      const gate=Promise.withResolvers();
      const observer=new MutationObserver(()=>{if(ready()){observer.disconnect();gate.resolve();}});
      observer.observe(document,{childList:true,subtree:true,attributes:true});
      return gate.promise;
    })()`);
    await until(
      '!!document.querySelector("[data-command=apply]")&&!document.querySelector("[data-command=apply]").disabled',
    );
    const click = async (selector: string) => {
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    };
    const mouse = async (type: string, at: Point, extra = {}) => {
      const b = await js(
        '(()=>{const c=document.querySelector("canvas"),r=c.getBoundingClientRect();return {x:r.x,y:r.y,s:r.width/c.width}})()',
      );
      await send("Input.dispatchMouseEvent", {
        type,
        x: b.x + at.x * b.s,
        y: b.y + at.y * b.s,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
        ...extra,
      });
    };
    const drag = async (
      from: Point,
      to: Point,
      modifiers = 0,
      cancel = false,
    ) => {
      await mouse("mouseMoved", from, { buttons: 0, modifiers });
      await mouse("mousePressed", from, { modifiers });
      await mouse("mouseMoved", to, { modifiers });
      if (cancel)
        await js(
          `document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,isPrimary:true,bubbles:true}))`,
        );
      await mouse("mouseReleased", to, { modifiers });
    };
    const point = async (at: Point, count = 1) => {
      await mouse("mousePressed", at, { clickCount: count });
      await mouse("mouseReleased", at, { clickCount: count });
    };
    const key = async (key: string) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key });
    };
    let saves = 0;
    const save = async () => {
      await click("[data-command=apply]");
      await until(
        `applied.length===${++saves}&&!document.querySelector('[data-annotation-editor]')`,
      );
      const result = await js("applied.at(-1)");
      expect(webAnnotation(result)).toEqual(result);
      expect(new DataView(output.buffer, output.byteOffset).getUint32(16)).toBe(
        768,
      );
      return result as WebAnnotation;
    };
    const reopen = async () => {
      await js("void openEditor()");
      await until(
        '!!document.querySelector("[data-command=apply]")&&!document.querySelector("[data-command=apply]").disabled',
      );
    };
    await run({ js, click, drag, point, key, save, reopen });
  } finally {
    await chrome?.close();
    server.stop(true);
    await rm(profile, { recursive: true, force: true });
  }
}

browserTest(
  "unsaved shapes resize with fixed opposite corners; undo, redo, and canceled drags preserve geometry",
  async () => {
    await withEditor(async ({ click, drag, js, save }) => {
      await click("[data-tool=rectangle]");
      await drag({ x: 160, y: 140 }, { x: 320, y: 260 });
      await drag({ x: 320, y: 260 }, { x: 400, y: 310 });
      await click("[data-command=undo]");
      await click("[data-command=redo]");
      await click("[data-tool=select]");
      await drag({ x: 400, y: 310 }, { x: 400, y: 310 });
      await drag({ x: 400, y: 310 }, { x: 500, y: 350 }, 0, true);
      const result = await save();
      expect(result.marks).toEqual([
        {
          tool: "rectangle",
          color: "#ef4444",
          width: 3,
          from: { x: 160, y: 140 },
          to: { x: 400, y: 310 },
          radius: 8,
        },
      ]);
      const pixels = await js(`(async()=>{
      const image=await createImageBitmap(await(await fetch('/api/attachment?name=proposal.png')).blob());
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
      const bytes=ctx.getImageData(0,0,c.width,c.height).data;
      let blue=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]<80&&bytes[i+1]<180&&bytes[i+2]>170)blue++;
      return {blue,sourcePixel:[...ctx.getImageData(65,65,1,1).data]};
    })()`);
      expect(pixels).toEqual({ blue: 0, sourcePixel: [255, 255, 255, 255] });
    });
  },
  30000,
);

browserTest(
  "circles, triangles, lines and freehand strokes remain independent editable vectors",
  async () => {
    await withEditor(async ({ click, drag, save }) => {
      await click("[data-tool=ellipse]");
      await drag({ x: 120, y: 120 }, { x: 210, y: 180 }, 8);
      await click("[data-tool=triangle]");
      await drag({ x: 280, y: 110 }, { x: 400, y: 220 });
      await drag({ x: 400, y: 220 }, { x: 430, y: 250 });
      await click("[data-tool=line]");
      await drag({ x: 140, y: 340 }, { x: 300, y: 340 });
      await drag({ x: 300, y: 340 }, { x: 340, y: 390 });
      await click("[data-tool=pen]");
      await drag({ x: 500, y: 140 }, { x: 580, y: 240 });
      await click("[data-tool=select]");
      await drag({ x: 580, y: 240 }, { x: 620, y: 280 });
      const { marks } = await save();
      expect(marks[0]).toMatchObject({
        tool: "ellipse",
        from: { x: 120, y: 120 },
        to: { x: 210, y: 210 },
      });
      expect(marks[1]).toMatchObject({
        tool: "triangle",
        from: { x: 280, y: 110 },
        to: { x: 430, y: 250 },
      });
      expect(marks[2]).toMatchObject({
        tool: "line",
        from: { x: 140, y: 340 },
        to: { x: 340, y: 390 },
      });
      expect(marks[3]).toMatchObject({
        tool: "pen",
        points: [
          { x: 500, y: 140 },
          { x: 620, y: 280 },
        ],
      });
    });
  },
  30000,
);

browserTest(
  "paths draw by points, curve by dragging, edit nodes and controls before save, and reopen without flattening",
  async () => {
    await withEditor(async ({ click, drag, point, key, save, reopen }) => {
      await click("[data-tool=path]");
      await point({ x: 140, y: 160 });
      await drag({ x: 300, y: 220 }, { x: 340, y: 180 });
      await point({ x: 480, y: 300 });
      await key("Enter");
      await drag({ x: 300, y: 220 }, { x: 320, y: 240 });
      await drag({ x: 360, y: 200 }, { x: 380, y: 220 });
      const first = await save();
      expect(first.marks[0]).toMatchObject({
        tool: "path",
        closed: false,
        nodes: [
          { x: 140, y: 160, kind: "corner" },
          { x: 320, y: 240, kind: "smooth", out: { x: 380, y: 220 } },
          { x: 480, y: 300, kind: "corner" },
        ],
      });
      await reopen();
      await click("[data-tool=select]");
      await point({ x: 320, y: 240 });
      await click("[data-command=corner-node]");
      await click("[data-command=close-path]");
      const second = await save();
      expect(second.marks[0]).toMatchObject({ tool: "path", closed: true });
      if (second.marks[0]!.tool === "path")
        expect(second.marks[0]!.nodes[1]).toEqual({
          x: 320,
          y: 240,
          kind: "corner",
        });
    });
  },
  30000,
);

browserTest(
  "unfinished paths cancel without applying; double click finishes without duplicate points; point deletion is undoable",
  async () => {
    await withEditor(async ({ click, point, key, js, save }) => {
      await click("[data-tool=path]");
      await point({ x: 100, y: 100 });
      await point({ x: 200, y: 200 });
      await key("Escape");
      expect(await js("applied.length")).toBe(0);
      await point({ x: 140, y: 160 });
      await point({ x: 300, y: 220 });
      await point({ x: 480, y: 300 });
      await point({ x: 480, y: 300 }, 2);
      await point({ x: 300, y: 220 });
      await click("[data-command=delete-node]");
      await click("[data-command=undo]");
      const result = await save();
      expect(result.marks[0]).toMatchObject({
        tool: "path",
        closed: false,
        nodes: [
          { x: 140, y: 160, kind: "corner" },
          { x: 300, y: 220, kind: "corner" },
          { x: 480, y: 300, kind: "corner" },
        ],
      });
    });
  },
  30000,
);

browserTest(
  "path segments accept new anchors and smoothing; closing on the first point keeps all nodes editable",
  async () => {
    await withEditor(async ({ click, point, save }) => {
      await click("[data-tool=path]");
      await point({ x: 140, y: 160 });
      await point({ x: 460, y: 160 });
      await point({ x: 460, y: 360 });
      await point({ x: 140, y: 160 });
      await point({ x: 300, y: 160 });
      await point({ x: 300, y: 160 }, 2);
      await click("[data-command=smooth-node]");
      const result = await save();
      const mark = result.marks[0]!;
      expect(mark.tool).toBe("path");
      if (mark.tool !== "path") throw new Error("Expected editable path");
      expect(mark.closed).toBe(true);
      expect(mark.nodes).toHaveLength(4);
      expect(mark.nodes[1]).toEqual({
        x: 300,
        y: 160,
        kind: "smooth",
        in: { x: 300 - 160 / 3, y: 160 },
        out: { x: 300 + 160 / 3, y: 160 },
      });
    });
  },
  30000,
);

browserTest(
  "Apply finishes an open path and preserves source pixels and the note editor",
  async () => {
    await withEditor(async ({ click, point, js, save }) => {
      await click("[data-tool=path]");
      await point({ x: 140, y: 160 });
      await point({ x: 300, y: 220 });
      const result = await save();
      expect(result.marks[0]).toMatchObject({
        tool: "path",
        closed: false,
        nodes: [
          { x: 140, y: 160, kind: "corner" },
          { x: 300, y: 220, kind: "corner" },
        ],
      });
      expect(await js("document.querySelector('#note').value")).toBe(
        "Keep my note",
      );
      expect(await js("capture.area")).toBe("images/source.png");
    });
  },
  30000,
);
