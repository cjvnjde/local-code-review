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
    reload(): Promise<void>;
  }) => Promise<void>,
  dpr = 1,
) {
  const [bundle, sceneBundle] = await Promise.all([
    Bun.build({
      entrypoints: [path.join(import.meta.dir, "annotation-editor.ts")],
      target: "browser",
    }),
    Bun.build({
      entrypoints: [path.join(import.meta.dir, "annotation-scene.tsx")],
      target: "browser",
    }),
  ]);
  if (!bundle.success) throw new AggregateError(bundle.logs);
  if (!sceneBundle.success) throw new AggregateError(sceneBundle.logs);
  const script = await bundle.outputs[0]!.text();
  const sceneScript = await sceneBundle.outputs[0]!.text();
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
      if (url.pathname === "/scene.js")
        return new Response(sceneScript, {
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
          url.searchParams.get("name") === "proposal.png" ||
            url.searchParams.get("ref") === "images/proposal.png"
            ? output
            : source,
          { headers: { "content-type": "image/png" } },
        );
      if (url.pathname === "/api/attach") {
        output = new Uint8Array(await req.arrayBuffer());
        return Response.json({ ref: "images/proposal.png" });
      }
      return new Response(
        `<!doctype html><link rel="stylesheet" href="/styles/drawing.css"><textarea id="note">Keep my note</textarea><script type="module">
      import {openAnnotation} from '/editor.js';
      const c=document.createElement('canvas');c.width=640;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,640,400);ctx.fillStyle='#111';ctx.fillText('Original screenshot',30,30);ctx.fillStyle='#16803c';ctx.fillRect(240,80,40,40);
      const encoded=Promise.withResolvers();c.toBlob(encoded.resolve);
      await fetch('/source',{method:'POST',body:await encoded.promise});
      window.capture={mode:'area',url:location.origin,title:'Test',viewport:{width:640,height:400,dpr:1},scroll:{x:0,y:0},rect:{x:0,y:0,width:640,height:400},page:'images/source.png',area:'images/source.png'};
      window.applied=[];window.confirm=()=>true;window.openEditor=()=>openAnnotation('test',{image:capture.area,cssWidth:capture.rect.width,annotation:capture.annotation},async a=>{applied.push(a);capture.annotation=a??undefined;});window.openEditor();
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
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1500,
      height: 1000,
      deviceScaleFactor: dpr,
      mobile: false,
    });
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
        '(()=>{const c=document.querySelector("[data-drawing-surface]"),r=c.getBoundingClientRect();return {x:r.x,y:r.y,s:r.width/Number(c.dataset.width)}})()',
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
          `document.querySelector('[data-drawing-surface]').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,isPrimary:true,bubbles:true}))`,
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
    const reload = async () => {
      const loaded = Promise.withResolvers<void>();
      const off = chrome!.cdp.on("Page.loadEventFired", (_, session) => {
        if (session === sessionId) loaded.resolve();
      });
      await send("Page.reload");
      await loaded.promise;
      off();
      await until(
        '!!document.querySelector("[data-command=restore-draft]")&&!document.querySelector("[data-command=restore-draft]").disabled',
      );
    };
    await run({ js, click, drag, point, key, save, reopen, reload });
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

browserTest(
  "fit and zoom keep the drawing surface within its viewport without phantom scroll space",
  async () => {
    await withEditor(async ({ js, click, drag }) => {
      await js(
        `Object.assign(document.querySelector('[data-annotation-editor]').style,{width:'650px',height:'650px'})`,
      );
      await click("[data-command=fit]");
      const dimensions = () =>
        js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const view=document.querySelector('.annotation-viewport'),surface=document.querySelector('[data-drawing-surface]');
        resolve({width:view.clientWidth,height:view.clientHeight,scrollWidth:view.scrollWidth,scrollHeight:view.scrollHeight,zoom:surface.getBoundingClientRect().width/Number(surface.dataset.width)});
      })))`);
      const fit = await dimensions();
      expect(fit.zoom).toBeLessThan(1);
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width + 1);
      expect(fit.scrollHeight).toBeLessThanOrEqual(fit.height + 1);
      await click("[data-command=actual]");
      expect((await dimensions()).zoom).toBe(1);
      await click("[data-tool=pan]");
      await js(
        `document.querySelector('.annotation-viewport').scrollTo(30,30)`,
      );
      await drag({ x: 150, y: 150 }, { x: 120, y: 130 });
      expect(
        await js(`document.querySelector('.annotation-viewport').scrollLeft`),
      ).toBeGreaterThan(30);
      await click("[data-command=fit]");
      const restored = await dimensions();
      expect(restored.zoom).toBeCloseTo(fit.zoom);
      expect(restored.scrollWidth).toBeLessThanOrEqual(restored.width + 1);
      expect(restored.scrollHeight).toBeLessThanOrEqual(restored.height + 1);
    });
  },
  30000,
);

browserTest(
  "Konva selects rendered strokes, curves, filled areas, callout badges and labels without selecting empty corners",
  async () => {
    await withEditor(async ({ js }) => {
      const results = await js(`(async()=>{
        const {createAnnotationScene}=await import('/scene.js');
        const host=document.createElement('div');document.body.append(host);
        const scene=createAnnotationScene(host),image=new Image();image.src='/api/attachment?ref=images/source.png';await image.decode();
        const model={image,width:768,height:528,padding:64,sourceScale:1,zoom:1,marks:[],hidden:new Set(),original:false,textEditing:false,selected:-1,selectedNode:-1,selecting:true,gesture:null,pathDraft:null,pendingText:null};
        const base={color:'#ef4444',width:2,from:{x:100,y:100},to:{x:300,y:200}};
        const cases=[
          [{...base,tool:'line'},[200,150],[100,200]],
          [{...base,tool:'arrow'},[290,200],[200,210]],
          [{...base,tool:'pen',points:[base.from,base.to]},[200,150],[100,200]],
          [{...base,tool:'highlighter',opacity:.25,width:20,points:[base.from,base.to]},[200,150],[100,200]],
          [{...base,tool:'rectangle',radius:0},[100,150],[200,150]],
          [{...base,tool:'rectangle',radius:50},[100,150],[100,100]],
          [{...base,tool:'ellipse'},[300,150],[200,150]],
          [{...base,tool:'triangle'},[200,100],[200,150]],
          [{...base,tool:'rectangle',radius:0,fill:'#ffff00',opacity:.25},[200,150],[350,150]],
          [{...base,tool:'ellipse',fill:'#ffff00',opacity:.25},[200,150],[350,150]],
          [{...base,tool:'triangle',fill:'#ffff00',opacity:.25},[200,150],[100,100]],
          [{...base,tool:'path',closed:false,nodes:[{x:100,y:200,kind:'corner',out:{x:100,y:80}},{x:300,y:200,kind:'corner',in:{x:300,y:80}}]},[200,110],[200,200]],
          [{...base,tool:'path',fill:'#ffff00',opacity:.25,closed:false,nodes:[{x:100,y:200,kind:'corner',out:{x:100,y:80}},{x:300,y:200,kind:'corner',in:{x:300,y:80}}]},[200,160],[200,240]],
          [{...base,tool:'callout',id:'45a655ed-8e1e-4f42-a59c-8a9e69ba81f3',size:30,number:7,label:'Editable label'},[100,100],[100,200]],
          [{...base,tool:'callout',id:'45a655ed-8e1e-4f42-a59c-8a9e69ba81f3',size:30,number:7,label:'Editable label'},[150,100],[100,200]],
          [{tool:'text',at:{x:100,y:100},color:'#ef4444',text:'Text',size:20,background:'#ffffff'},[110,110],[110,160]],
          [{...base,tool:'magnifier',at:{x:400,y:260},scale:1},[450,280],[150,180]],
        ];
        try{return cases.map(([mark,yes,no])=>{
          model.marks=[mark];scene.render(model);
          return {tool:mark.tool,hit:scene.hit({x:yes[0],y:yes[1]}),miss:scene.hit({x:no[0],y:no[1]})};
        });}finally{scene.destroy();host.remove();}
      })()`);
      expect(results).toEqual(
        results.map((result: { tool: string }) => ({
          tool: result.tool,
          hit: 0,
          miss: -1,
        })),
      );
    });
  },
  30000,
);

browserTest(
  "numbered callouts keep identity and editable endpoints on HiDPI displays; visibility never changes exports",
  async () => {
    await withEditor(async ({ click, point, drag, js, save, reopen }) => {
      const change = (field: string, value: unknown) =>
        js(`(()=>{
        const el=document.querySelector('[data-field="${field}"]');
        if(el.type==='checkbox')el.checked=${JSON.stringify(value)};
        else el.value=${JSON.stringify(value)};
        el.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      await click("[data-tool=callout]");
      await drag({ x: 120, y: 120 }, { x: 220, y: 200 });
      await change("label", "Align with ②");
      await point({ x: 450, y: 110 });
      await click("[data-tool=rectangle]");
      await change("fill", true);
      await change("opacity", "25");
      await drag({ x: 400, y: 300 }, { x: 550, y: 380 });
      await click("[data-tool=highlighter]");
      await drag({ x: 120, y: 340 }, { x: 280, y: 340 });
      const pixel = () =>
        js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        resolve([...document.querySelector('[data-drawing-surface] canvas').getContext('2d').getImageData(200,340,1,1).data]);
      })))`);
      const highlighted = await pixel();
      expect(highlighted).not.toEqual([255, 255, 255, 255]);
      await click("[data-command=visibility]");
      expect(await pixel()).toEqual([255, 255, 255, 255]);
      await click("[data-command=visibility]");
      expect(await pixel()).toEqual(highlighted);
      await click("[data-command=original]");
      expect(await pixel()).toEqual([255, 255, 255, 255]);
      await click("[data-command=visibility]");
      const first = await save(); // Original/hidden are preview-only, never export options.
      expect(first.marks[0]).toMatchObject({
        tool: "callout",
        number: 1,
        label: "Align with ②",
      });
      expect(first.marks[1]).toMatchObject({
        tool: "callout",
        number: 2,
        label: "",
      });
      expect(first.marks[2]).toMatchObject({
        tool: "rectangle",
        fill: "#eab308",
        opacity: 0.25,
      });
      expect(first.marks[3]).toMatchObject({
        tool: "highlighter",
        opacity: 0.25,
      });
      expect(
        await js(`(async()=>{
        const image=await createImageBitmap(await(await fetch('/api/attachment?name=proposal.png')).blob());
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        c.getContext('2d').drawImage(image,0,0);image.close();
        return [...c.getContext('2d').getImageData(200,340,1,1).data];
      })()`),
      ).toEqual(highlighted);
      await reopen();
      const second = await save();
      expect(second.marks).toEqual(first.marks);
      await reopen();
      await click("[data-tool=select]");
      // Select by the actual badge, then move each endpoint independently.
      await point({ x: 120, y: 120 });
      await drag({ x: 220, y: 200 }, { x: 250, y: 230 });
      await drag({ x: 120, y: 120 }, { x: 140, y: 100 });
      await change("label", "Still editable after reopening");
      const third = await save();
      expect(third.marks[0]).toEqual({
        ...first.marks[0],
        from: { x: 140, y: 100 },
        to: { x: 250, y: 230 },
        label: "Still editable after reopening",
      });
      expect(third.marks[1]).toEqual(first.marks[1]);
    }, 2);
  },
  30000,
);

browserTest(
  "text edits in place with wrapping, background, outline and an independent leader; insets magnify original pixels",
  async () => {
    await withEditor(async ({ click, point, drag, js, save, reopen }) => {
      await click("[data-tool=text]");
      await point({ x: 120, y: 280 });
      await js(`(()=>{
        const el=document.querySelector('[data-field=text]');
        el.value='This label wraps over the screenshot';el.dispatchEvent(new Event('input',{bubbles:true}));
        for(const [name,value] of [['wrap','120'],['text-outline',true],['text-leader',true]]){
          const field=document.querySelector('[data-field="'+name+'"]');
          if(field.type==='checkbox')field.checked=value;else field.value=value;
          field.dispatchEvent(new Event('change',{bubbles:true}));
        }
      })()`);
      const location = await js(`(()=>{
        const t=document.querySelector('[data-field=text]').getBoundingClientRect();
        const surface=document.querySelector('[data-drawing-surface]');const c=surface.getBoundingClientRect();return {x:t.x-c.x,y:t.y-c.y,zoom:c.width/Number(surface.dataset.width)};
      })()`);
      expect(location.x / location.zoom).toBeCloseTo(120);
      expect(location.y / location.zoom).toBeCloseTo(280);
      await click("[data-tool=select]");
      await click("[data-command=edit-text]");
      await js(`(()=>{
        const el=document.querySelector('[data-field=text]');el.value='Reworded label';
        el.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await click("[data-tool=magnifier]");
      await drag({ x: 300, y: 140 }, { x: 360, y: 200 });
      const first = await save();
      expect(first.marks[0]).toMatchObject({
        tool: "text",
        text: "Reworded label",
        wrap: 120,
        background: "#ffffff",
        outline: true,
        target: { x: 180, y: 360 },
      });
      expect(first.marks[1]).toMatchObject({
        tool: "magnifier",
        from: { x: 300, y: 140 },
        to: { x: 360, y: 200 },
        scale: 3,
      });
      const inset = first.marks[1]!;
      if (inset.tool !== "magnifier") throw new Error("Expected inset");
      expect(
        await js(`(async()=>{
        const image=await createImageBitmap(await(await fetch('/api/attachment?name=proposal.png')).blob());
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        c.getContext('2d').drawImage(image,0,0);image.close();
        return [...c.getContext('2d').getImageData(${inset.at.x + 72},${inset.at.y + 72},1,1).data];
      })()`),
      ).toEqual([22, 128, 60, 255]);
      await reopen();
      const second = await save();
      expect(second.marks).toEqual(first.marks);
      expect(await js("capture.area")).toBe("images/source.png");
    });
  },
  30000,
);

browserTest(
  "reload offers local recovery of marks and unfinished paths; restore, apply and explicit discard clear recovery",
  async () => {
    await withEditor(
      async ({ click, drag, point, js, reload, save, reopen }) => {
        await click("[data-tool=callout]");
        await point({ x: 140, y: 140 });
        await click("[data-tool=path]");
        await point({ x: 250, y: 250 });
        await reload();
        expect(await js("applied.length")).toBe(0);
        expect(
          await js("document.querySelector('[data-command=apply]').disabled"),
        ).toBe(true);
        await click("[data-command=restore-draft]");
        await point({ x: 350, y: 300 });
        const result = await save();
        expect(result.marks[0]).toMatchObject({ tool: "callout", number: 1 });
        expect(result.marks[1]).toMatchObject({
          tool: "path",
          nodes: [
            { x: 250, y: 250, kind: "corner" },
            { x: 350, y: 300, kind: "corner" },
          ],
        });
        expect(
          await js(
            "Object.keys(localStorage).filter(k=>k.startsWith('lcr:annotation-draft:'))",
          ),
        ).toEqual([]);
        await reopen();
        await click("[data-tool=rectangle]");
        await drag({ x: 400, y: 300 }, { x: 500, y: 380 });
        await click("[data-command=cancel]");
        expect(
          await js("!!document.querySelector('.annotation-discard')"),
        ).toBe(true);
        await click("[data-command=discard-changes]");
        expect(
          await js(
            "Object.keys(localStorage).filter(k=>k.startsWith('lcr:annotation-draft:'))",
          ),
        ).toEqual([]);
      },
    );
  },
  30000,
);
