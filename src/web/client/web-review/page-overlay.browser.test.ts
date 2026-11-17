import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CdpCommand, CdpParams } from "../../../browser/cdp.ts";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../../../browser/review-browser.ts";

const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;
type Point = { x: number; y: number };

browserTest(
  "element selection includes inspection, drafts keep immediate markers, and Point retains frozen evidence",
  async () => {
    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "page-overlay.ts")],
      target: "browser",
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);
    const script = await bundle.outputs[0]!.text();
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/overlay.js")
          return new Response(script, {
            headers: { "content-type": "text/javascript" },
          });
        if (url.searchParams.has("ui-draft") || url.searchParams.has("ui-note"))
          return new Response(
            '<!doctype html><textarea id="draft"></textarea>',
            { headers: { "content-type": "text/html" } },
          );
        return new Response(
          `<!doctype html><style>
        body{margin:0;height:2000px;font:16px Arial}#parent{position:absolute;left:80px;top:100px;padding:24px;display:flex;gap:17px;align-items:center;background:rgb(240,240,240)}
        #target{box-sizing:content-box;width:120px;height:32px;padding:12px;margin:3px;border:2px solid rgb(10,20,30);border-radius:9px;font:600 18px/24px Arial;color:rgb(20,40,60);background:rgb(200,210,220);transform:scale(1.25)}
      </style><section id="parent"><button id="target">Target</button><span id="other">Another element</span></section><script type="module">
        import {installPageReview} from '/overlay.js';
        window.requests=[];window.clicks=0;document.querySelector('#target').onclick=()=>window.clicks++;
        window.bridge=encoded=>{
          const message=JSON.parse(encoded);requests.push(message);
          let value={};
          if(message.action==='notes')value={notes:window.savedNotes||[]};
          if(message.action==='context-settings')value=window.contextSettings||{aiContext:false,contextHtml:false,contextFullPage:false,contextDiagnostics:false};
          if(message.action==='capture'){
            const capture=message.payload.capture;
            if(message.payload.id){
              window.replyWeb=window.replyWeb
                ? {...window.replyWeb,additional:[...(window.replyWeb.additional||[]),capture]}
                : {before:capture,after:[]};
              value={draftId:'reply-draft',reply:true,capture,web:window.replyWeb};
            }else{
              window.draftWeb=message.payload.draftId
                ? {...window.draftWeb,additional:[...(window.draftWeb.additional||[]),capture]}
                : {before:capture,after:[]};
              value={draftId:'draft',capture,web:window.draftWeb};
            }
          }
          if(message.action==='freeze'){
            const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;
            value={id:'frozen',data:canvas.toDataURL()};
          }
          const reply=()=>window.overlay.resolve(message.seq,{ok:true,value});
          if(message.action==='capture' && window.holdCapture)window.releaseCapture=reply;
          else queueMicrotask(reply);
        };
        // Exercise the same self-contained function boundary used by CDP injection.
        const injected=(0,eval)('('+installPageReview.toString()+')');
        injected({key:'overlay',binding:'bridge',origin:location.origin,reviewUrl:location.origin});
      </script>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const profile = await mkdtemp(path.join(tmpdir(), "lcr-inspect-browser-"));
    let chrome: ReviewBrowser | undefined;
    try {
      chrome = await launchReviewBrowser(profile, [
        "--headless=new",
        "--window-size=1280,900",
      ]);
      const { targetId } = await chrome.cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await chrome.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const send = <M extends CdpCommand>(method: M, params: CdpParams<M>) =>
        chrome!.cdp.send(method, params, sessionId);
      await send("Page.enable", {});
      const loaded = Promise.withResolvers<void>();
      const off = chrome.cdp.on("Page.loadEventFired", (_, session) => {
        if (session === sessionId) loaded.resolve();
      });
      await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/` });
      await loaded.promise;
      off();
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
        js(`(()=>{
      const gate=Promise.withResolvers();
      const check=()=>{if(${condition})gate.resolve(true);else requestAnimationFrame(check)};
      check();return gate.promise;
    })()`);
      const root = "document.getElementById('overlay').shadowRoot";
      await until("!!window.overlay");
      const mode = (value: string) =>
        value === "browse"
          ? js(`${root}.querySelector('[data-browse]').click()`)
          : js(`${root}.querySelector('[data-mode="${value}"]').click()`);
      const control = (selector: string) =>
        js(`${root}.querySelector(${JSON.stringify(selector)}).click()`);
      const message = (action: string, extra = {}, token?: string) =>
        js(`window.dispatchEvent(new MessageEvent('message',{
          origin:location.origin,source:savedFrame.contentWindow,
          data:{type:'lcr:ui',token:${token === undefined ? "new URL(savedFrame.src).searchParams.get('ui-draft')||new URL(savedFrame.src).searchParams.get('ui-note')" : JSON.stringify(token)},action:${JSON.stringify(action)},...${JSON.stringify(extra)}}
        }))`);
      const dockBounds = () =>
        js(
          `(()=>{const r=${root}.querySelector('.dock').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
        );
      const center = async (selector: string): Promise<Point> =>
        js(
          `(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`,
        );
      const mouse = (
        type: CdpParams<"Input.dispatchMouseEvent">["type"],
        at: Point,
        extra: Record<string, unknown> = {},
      ) =>
        send("Input.dispatchMouseEvent", {
          type,
          ...at,
          button: type === "mouseMoved" && !extra.buttons ? "none" : "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
          ...extra,
        });
      const click = async (at: Point) => {
        await mouse("mouseMoved", at);
        await mouse("mousePressed", at);
        await mouse("mouseReleased", at);
      };
      const pinCenter = (selector = ".draft-pin"): Promise<Point> =>
        js(
          `(()=>{const b=${root}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`,
        );
      const captures = () =>
        js(
          "requests.filter(r=>r.action==='capture').map(r=>r.payload.capture)",
        );
      const freezeKey = async () => {
        for (const type of ["keyDown", "keyUp"] as const)
          await send("Input.dispatchKeyEvent", {
            type,
            key: "F",
            code: "KeyF",
            modifiers: 10,
          });
      };
      const at = await center("#target");
      const pressed = (selector: string) =>
        js(
          `${root}.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`,
        );
      expect(await pressed("[data-annotate]")).toBe("true");
      expect(await pressed("[data-browse]")).toBe("false");
      expect(await js(`${root}.querySelector('.bar').hidden`)).toBe(true);
      await click(await pinCenter("[data-browse]"));
      expect(await pressed("[data-browse]")).toBe("true");
      expect(await pressed("[data-annotate]")).toBe("false");
      expect(await js(`${root}.querySelector('.bar').hidden`)).toBe(true);
      await click(await pinCenter("[data-annotate]"));
      expect(await pressed("[data-annotate]")).toBe("true");
      await control("[data-launcher]");
      expect(await js(`${root}.querySelector('.bar').hidden`)).toBe(false);
      for (const target of ["block", "area", "point", "element"]) {
        await control(`[data-mode="${target}"]`);
        expect(await pressed(`[data-mode="${target}"]`)).toBe("true");
        expect(await pressed("[data-annotate]")).toBe("true");
        expect(await js(`${root}.querySelector('.bar').hidden`)).toBe(true);
        await control("[data-launcher]");
      }
      await control("[data-multiple]");
      expect(await pressed("[data-multiple]")).toBe("true");
      await click(at);
      expect(await js(`${root}.querySelector('.selection-tools').hidden`)).toBe(
        false,
      );
      expect(await captures()).toHaveLength(0);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
      });
      expect(await js(`${root}.querySelector('.selection-tools').hidden`)).toBe(
        true,
      );
      await control('[data-mode="element"]');
      for (const type of ["keyDown", "keyUp"] as const) {
        await send("Input.dispatchKeyEvent", {
          type,
          key: "Alt",
          code: "AltLeft",
          modifiers: type === "keyDown" ? 1 : 0,
        });
        expect(await pressed("[data-browse]")).toBe(
          type === "keyDown" ? "true" : "false",
        );
        if (type === "keyDown") {
          await mouse("mouseMoved", at, { modifiers: 1 });
          await mouse("mousePressed", at, { modifiers: 1 });
          await mouse("mouseReleased", at, { modifiers: 1 });
          expect(await js("clicks")).toBe(1);
          expect(await captures()).toHaveLength(0);
        }
      }
      const launcherBefore = await pinCenter("[data-launcher]");
      await mouse("mouseMoved", launcherBefore);
      await mouse("mousePressed", launcherBefore);
      await mouse(
        "mouseMoved",
        { x: launcherBefore.x + 70, y: launcherBefore.y - 40 },
        { buttons: 1 },
      );
      await mouse("mouseReleased", {
        x: launcherBefore.x + 70,
        y: launcherBefore.y - 40,
      });
      expect(await pinCenter("[data-launcher]")).toEqual({
        x: launcherBefore.x + 70,
        y: launcherBefore.y - 40,
      });
      expect(await js(`${root}.querySelector('.bar').hidden`)).toBe(true);

      await mode("point");
      await click(at);
      await until(
        `${root}.querySelector('iframe')?.contentDocument?.querySelector('#draft')`,
      );
      const live = (await captures())[0];
      expect(live.mode).toBe("point");
      expect(live.element.text).toBe("Target");
      expect(live.rect).toEqual({
        x: at.x - 48,
        y: at.y - 48,
        width: 96,
        height: 96,
      });
      expect(live.point).toEqual(at);
      expect(await pinCenter()).toEqual(at);
      await js(
        `window.savedFrame=${root}.querySelector('iframe');savedFrame.contentDocument.querySelector('#draft').value='Keep this draft'`,
      );

      expect(await dockBounds()).toMatchObject({ width: 440, height: 540 });
      expect(await js(`${root}.querySelector('.head b').textContent`)).toBe(
        "New web note",
      );
      await js(
        `${root}.querySelector('[data-resize]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft'}))`,
      );
      const resized = await dockBounds();
      expect(resized.width).toBe(430);
      for (const [edge, delta] of [
        ["w", { x: -40, y: 0 }],
        ["e", { x: 10, y: 0 }],
        ["n", { x: 0, y: -6 }],
        ["s", { x: 0, y: 20 }],
      ] as const) {
        const before = await dockBounds();
        const handle = await pinCenter(`[data-resize="${edge}"]`);
        const end = { x: handle.x + delta.x, y: handle.y + delta.y };
        await mouse("mouseMoved", handle);
        await mouse("mousePressed", handle);
        await mouse("mouseMoved", end, { buttons: 1 });
        await mouse("mouseReleased", end);
        const after = await dockBounds();
        expect(after.width).toBe(
          before.width + (edge === "w" ? -delta.x : delta.x),
        );
        expect(after.height).toBe(
          before.height + (edge === "n" ? -delta.y : delta.y),
        );
        expect(after.x).toBe(before.x + (edge === "w" ? delta.x : 0));
        expect(after.y).toBe(before.y + (edge === "n" ? delta.y : 0));
        await mouse("mouseMoved", end);
        await mouse("mousePressed", end);
        await mouse("mouseMoved", handle, { buttons: 1 });
        await mouse("mouseReleased", handle);
        expect(await dockBounds()).toEqual(before);
        expect(
          await js("savedFrame.contentDocument.querySelector('#draft').value"),
        ).toBe("Keep this draft");
      }
      await message("annotation", { open: true });
      expect(await dockBounds()).toMatchObject(
        await js("({x:0,y:0,width:innerWidth,height:innerHeight})"),
      );
      await message("add-capture");
      expect(await js(`${root}.querySelector('.capture-prompt').hidden`)).toBe(
        true,
      );
      await message("annotation", { open: false });
      expect(await dockBounds()).toEqual(resized);
      await message("image-preview", { open: true });
      expect(await dockBounds()).toMatchObject(
        await js("({x:0,y:0,width:innerWidth,height:innerHeight})"),
      );
      await message("image-preview", { open: false });
      expect(await dockBounds()).toEqual(resized);
      await message("header", {
        triage: "bug",
        options: [{ value: "bug", label: "Bug" }],
        disabled: false,
      });
      expect(await js(`${root}.querySelector('[data-triage]').value`)).toBe(
        "bug",
      );
      expect(
        await js(`${root}.querySelector('[data-editor-help],.capture-help')`),
      ).toBeNull();
      const pageScroll = await js("({x:scrollX,y:scrollY})");
      await message("content-size", { height: 1400 }, "wrong-token");
      expect(await dockBounds()).toEqual(resized);
      await message("content-size", { height: 1400 });
      const grown = await dockBounds();
      expect(grown.x).toBe(resized.x);
      expect(grown.y).toBe(resized.y);
      expect(grown.height).toBeGreaterThan(1400);
      expect(await js("({x:scrollX,y:scrollY})")).toEqual(pageScroll);
      expect(
        await js(
          `getComputedStyle(${root}.querySelector('.content')).overflowY`,
        ),
      ).toBe("visible");
      expect(
        await js(
          "getComputedStyle(document.getElementById('overlay')).pointerEvents",
        ),
      ).toBe("none");
      expect(
        await js(
          "document.getElementById('overlay').parentElement===document.documentElement",
        ),
      ).toBe(true);
      await message("content-size", { height: 0 });
      expect(await dockBounds()).toEqual(resized);

      await js(`window.frameMessages=[];
        savedFrame.contentWindow.addEventListener('message',event=>{
          if(event.source===window && event.origin===location.origin) frameMessages.push(event.data);
        });
        for(const invalid of [
          {origin:'https://untrusted.invalid',source:savedFrame.contentWindow},
          {origin:location.origin,source:window},
        ]) window.dispatchEvent(new MessageEvent('message',{
          ...invalid,data:{type:'lcr:ui',token:new URL(savedFrame.src).searchParams.get('ui-draft'),
          action:'notification',id:'untrusted',title:'Do not render'}
        }));`);
      await message(
        "notification",
        { id: "untrusted", title: "Do not render" },
        "wrong-token",
      );
      expect(await js(`${root}.querySelector('.notification')`)).toBeNull();
      await message("notification", {
        id: "save-error",
        title: "Could not save note",
        description: "<img src=x onerror=alert(1)>",
        kind: "error",
        duration: 60_000,
      });
      expect(
        await js(
          `${root}.querySelector('.notifications [role=alert] p').textContent`,
        ),
      ).toBe("Could not save note");
      expect(
        await js(
          `${root}.querySelector('.dock .notification,.notifications img')`,
        ),
      ).toBeNull();
      await control("[data-minimize]");
      expect(
        await js(
          `${root}.querySelector('.notification').getBoundingClientRect().bottom<=innerHeight`,
        ),
      ).toBe(true);
      await control("[data-minimize]");
      await message(
        "notification-dismiss",
        { id: "save-error" },
        "wrong-token",
      );
      expect(await js(`${root}.querySelectorAll('.notification').length`)).toBe(
        1,
      );
      await control('[aria-label="Dismiss notification"]');
      await until(
        "frameMessages.some(message=>message.action==='notification-dismiss' && message.id==='save-error' && !message.automatic)",
      );
      expect(await js(`${root}.querySelector('.notification')`)).toBeNull();
      await message("notification", {
        id: 9,
        title: "Updated",
        duration: 60_000,
      });
      await message("notification-dismiss", { id: 9 });
      expect(await js(`${root}.querySelector('.notification')`)).toBeNull();
      await message("add-capture", {}, "wrong-token");
      expect(await js(`${root}.querySelector('.capture-prompt').hidden`)).toBe(
        true,
      );
      for (const protectedState of [{ saving: true }, { editOriginal: true }]) {
        await message("dirty", protectedState);
        await message("add-capture");
        expect(
          await js(`${root}.querySelector('.capture-prompt').hidden`),
        ).toBe(true);
        await message("dirty", { saving: false, editOriginal: false });
      }
      await mode("browse");
      await message("add-capture");
      expect(
        await js(
          `${root}.querySelector('.dock').classList.contains('minimized')`,
        ),
      ).toBe(true);
      expect(await js(`${root}.querySelector('.capture-prompt').hidden`)).toBe(
        false,
      );
      for (const type of ["keyDown", "keyUp"] as const)
        await send("Input.dispatchKeyEvent", {
          type,
          key: "Escape",
          code: "Escape",
        });
      expect(await dockBounds()).toEqual(resized);
      expect(await js(`${root}.querySelector('.capture-prompt').hidden`)).toBe(
        true,
      );
      expect(await pressed("[data-browse]")).toBe("true");
      expect(
        await js(
          `${root}.querySelector('iframe')===savedFrame && savedFrame.contentDocument.querySelector('#draft').value==='Keep this draft'`,
        ),
      ).toBe(true);
      const elementAt = { x: at.x + 40, y: at.y };
      await mode("element");
      await message("add-capture");
      await mouse("mouseMoved", elementAt);
      const bounds = await js(
        "(()=>{const b=document.querySelector('#target').getBoundingClientRect();return {width:b.width,height:b.height}})()",
      );
      expect(await js(`${root}.querySelector('.label').textContent`)).toContain(
        `${bounds.width} × ${bounds.height} CSS px`,
      );
      await click(elementAt);
      await until("requests.filter(r=>r.action==='capture').length===2");
      const element = (await captures()).at(-1);
      expect(element.mode).toBe("element");
      expect(element.element.styles).toMatchObject({
        width: "120px",
        padding: "12px",
        "border-radius": "9px",
        "font-weight": "600",
        "line-height": "24px",
        color: "rgb(20, 40, 60)",
      });
      expect(await js("clicks")).toBe(1);
      expect(
        await js(
          `${root}.querySelector('iframe')===savedFrame && savedFrame.contentDocument.querySelector('#draft').value==='Keep this draft'`,
        ),
      ).toBe(true);
      await until(`${root}.querySelectorAll('.draft-pin').length===2`);
      expect(await js(`${root}.querySelector('.capture-prompt').hidden`)).toBe(
        true,
      );
      expect(await dockBounds()).toEqual(resized);
      expect(await js(`${root}.querySelector('.head b').textContent`)).toBe(
        "New web note · 2 captures",
      );
      expect(
        await js(
          "requests.filter(r=>r.action==='capture').at(-1).payload.draftId",
        ),
      ).toBe("draft");
      await control("[data-minimize]");
      await control(".draft-pin");
      expect(
        await js(
          `${root}.querySelector('.dock').classList.contains('minimized')`,
        ),
      ).toBe(false);
      expect(await js(`${root}.querySelector('iframe')===savedFrame`)).toBe(
        true,
      );

      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...elementAt,
        deltaX: 0,
        deltaY: 100,
        modifiers: 1,
      });
      await click(elementAt);
      await until("requests.filter(r=>r.action==='capture').length===3");
      const parent = (await captures()).at(-1);
      expect(
        await js(
          `document.querySelector(${JSON.stringify(parent.selector)})===document.querySelector('#parent')`,
        ),
      ).toBe(true);
      expect(parent.element.styles.gap).toBe("17px");
      await click(await center("#other"));
      await until("requests.filter(r=>r.action==='capture').length===4");
      const other = (await captures()).at(-1);
      expect(
        await js(
          `document.querySelector(${JSON.stringify(other.selector)})===document.querySelector('#other')`,
        ),
      ).toBe(true);
      await control("[data-close]");
      expect(await js(`${root}.querySelector('.draft-pin')`)).toBeNull();
      await mode("browse");
      await click(at);
      expect(await js("clicks")).toBe(2);

      await mode("element");
      await js("window.holdCapture=true");
      const area = { x: 20, y: 300, width: 180, height: 90 };
      await mouse("mouseMoved", { x: area.x, y: area.y });
      await mouse("mousePressed", { x: area.x, y: area.y });
      await mouse(
        "mouseMoved",
        { x: area.x + area.width, y: area.y + area.height },
        { buttons: 1 },
      );
      await mouse("mouseReleased", {
        x: area.x + area.width,
        y: area.y + area.height,
      });
      await until("typeof window.releaseCapture==='function'");
      expect(
        await js(
          `(()=>{const p=${root}.querySelector('.draft-pin');return {x:parseFloat(p.style.left),y:parseFloat(p.style.top)}})()`,
        ),
      ).toEqual({ x: area.x, y: area.y });
      await js("window.holdCapture=false;window.releaseCapture()");
      await until(
        `${root}.querySelector('iframe')?.contentDocument?.querySelector('#draft')`,
      );
      expect((await captures()).at(-1).rect).toEqual(area);
      expect(await js(`${root}.querySelectorAll('.draft-pin').length`)).toBe(1);
      await js(`window.savedFrame=${root}.querySelector('iframe');
        window.closedFrameMessages=[];
        savedFrame.contentWindow.addEventListener('message',event=>closedFrameMessages.push(event.data));`);
      await message("notification", {
        id: "persistent",
        title: "Page notification",
        duration: 60_000,
      });
      await js("window.scrollTo(0,40)");
      await until(`${root}.querySelector('.draft-pin').style.top==='260px'`);
      await control("[data-close]");
      expect(await js(`${root}.querySelector('.draft-pin')`)).toBeNull();
      expect(
        await js(`${root}.querySelector('.notification p').textContent`),
      ).toBe("Page notification");
      await control('[aria-label="Dismiss notification"]');
      await js(
        "(()=>{const gate=Promise.withResolvers();requestAnimationFrame(()=>requestAnimationFrame(gate.resolve));return gate.promise})()",
      );
      expect(
        await js(
          "closedFrameMessages.some(message=>message.action==='notification-dismiss')",
        ),
      ).toBe(false);
      await js("window.scrollTo(0,0)");

      // New evidence is bounded, opt-in, and never includes editable values or event payloads.
      await mode("browse");
      await js(`window.contextSettings={aiContext:true,contextHtml:false,contextFullPage:false,contextDiagnostics:true};
        window.overlay.configureContext(window.contextSettings);
        const privateInput=document.createElement('input');privateInput.id='private-input';
        privateInput.value='PRIVATE_VALUE_SENTINEL';privateInput.setAttribute('aria-label','PRIVATE_LABEL_SENTINEL');
        privateInput.style.cssText='position:absolute;left:900px;top:100px;width:100px';
        document.body.append(privateInput);
        document.querySelector('#parent').style.setProperty('--unused-secret','PRIVATE_CSS_SENTINEL');
        document.querySelector('#parent').style.setProperty('--layout-gap','19px');
        document.querySelector('#parent').style.gap='var(--layout-gap)';
        const build=document.createElement('meta');build.name='lcr-build-id';build.content='build-before';document.head.append(build);
        window.prepareEvidence=()=>window.overlay.prepare({mode:'element',url:location.href,selector:'button#target',element:{tag:'button',attributes:{id:'target'}}});
      `);
      await click(await center("#target"));
      await js(`document.querySelector('#private-input').focus({preventScroll:true});
        document.querySelector('#target').dispatchEvent(new MouseEvent('click',{bubbles:true}));
        document.querySelector('#private-input').dispatchEvent(new InputEvent('input',{bubbles:true,data:'PRIVATE_EVENT_SENTINEL'}));
      `);
      const evidence = await js("window.prepareEvidence()");
      const layout = JSON.parse(evidence.contextLayout.data);
      const environment = JSON.parse(evidence.contextEnvironment.data);
      const interactions = JSON.parse(evidence.contextInteractions.data);
      expect(layout.nodes.length).toBeLessThanOrEqual(40);
      expect(
        new Set(layout.nodes.map((node: { id: string }) => node.id)).size,
      ).toBe(layout.nodes.length);
      const selectedTarget = layout.nodes.find(
        (node: { relation: string }) => node.relation === "target",
      );
      const layoutParent = layout.nodes.find(
        (node: { selector: string }) => node.selector === "section#parent",
      );
      expect(layoutParent.targets).toContain(selectedTarget.selector);
      expect(layoutParent.styles["--layout-gap"]).toBe("19px");
      expect(environment.focused.tag).toBe("input");
      expect(environment.appBuild.id).toBe("build-before");
      expect(
        interactions.events.filter(
          (event: { type: string }) => event.type === "click",
        ),
      ).toHaveLength(1);
      expect(JSON.stringify([layout, environment, interactions])).not.toContain(
        "PRIVATE_",
      );
      for (const part of [
        evidence.contextLayout,
        evidence.contextEnvironment,
        evidence.contextInteractions,
      ])
        expect(new TextEncoder().encode(part.data).length).toBeLessThanOrEqual(
          128 * 1024,
        );
      await js(
        `for(let i=0;i<60;i++)document.querySelector(i%2?'#target':'#private-input').focus({preventScroll:true})`,
      );
      const cappedInteractions = (await js("window.prepareEvidence()"))
        .contextInteractions;
      expect(JSON.parse(cappedInteractions.data).events).toHaveLength(50);
      expect(cappedInteractions.truncated).toBe(true);
      await js(`window.overlay.configureContext({...window.contextSettings,contextDiagnostics:false});
        window.overlay.configureContext(window.contextSettings)`);
      await js(
        `${root}.querySelector('[data-launcher]').focus({preventScroll:true})`,
      );
      expect(
        JSON.parse(
          (await js("window.prepareEvidence()")).contextInteractions.data,
        ).events,
      ).toEqual([]);
      await js(`window.overlay.configureContext({...window.contextSettings,aiContext:false});
        document.querySelector('#private-input').focus({preventScroll:true});
        window.overlay.configureContext(window.contextSettings)`);
      expect(
        JSON.parse(
          (await js("window.prepareEvidence()")).contextInteractions.data,
        ).events,
      ).toEqual([]);
      await js("document.querySelector('#private-input').remove()");

      await mode("element");
      await freezeKey();
      await until(`!!${root}.querySelector('.frozen-page')`);
      const frozenContext = await js(
        "requests.filter(r=>r.action==='freeze').at(-1).payload.capture",
      );
      await js(
        "document.querySelector('#target').textContent='Changed after freeze';document.querySelector('#target').style.color='red';document.querySelector('meta[name=lcr-build-id]').content='build-after';document.documentElement.lang='fr';window.overlay.configureContext({...window.contextSettings,aiContext:false})",
      );
      await mode("point");
      await click(at);
      await until("requests.filter(r=>r.action==='capture').length===6");
      const frozen = (await captures()).at(-1);
      expect(frozen.mode).toBe("point");
      expect(frozen.element.text).toBe("Target");
      expect(frozen.element.styles.color).toBe("rgb(20, 40, 60)");
      expect(frozen.rect).toEqual(live.rect);
      expect(frozen.point).toEqual(at);
      expect(await pinCenter()).toEqual(at);
      expect(frozen.contextLayout).toEqual(frozenContext.contextLayout);
      expect(frozen.contextEnvironment).toEqual(
        frozenContext.contextEnvironment,
      );
      expect(frozen.contextInteractions).toEqual(
        frozenContext.contextInteractions,
      );
      expect(JSON.parse(frozen.contextEnvironment.data).appBuild.id).toBe(
        "build-before",
      );

      await control("[data-close]");
      await control("[data-resume]");
      await js(
        "for(let i=0;i<110;i++){const el=document.createElement('div');el.style.cssText='position:absolute;left:'+(500+i%20*12)+'px;top:'+(400+Math.floor(i/20)*12)+'px;width:10px;height:10px';document.body.prepend(el)}",
      );
      await freezeKey();
      await until(`!!${root}.querySelector('.frozen-page')`);
      await mode("point");
      await click(at);
      await until("requests.filter(r=>r.action==='capture').length===7");
      const truncated = (await captures()).at(-1);
      expect(truncated.element).toBeUndefined();
      expect(truncated.selector).toBeUndefined();
      expect(truncated.contextLayout.truncated).toBe(true);
      expect(
        JSON.parse(truncated.contextLayout.data).nodes.length,
      ).toBeLessThanOrEqual(40);
      await control("[data-close]");
      await control("[data-resume]");
      await mode("point");
      const viewport = await js(
        "({width:document.documentElement.clientWidth,height:innerHeight})",
      );
      // Stay clear of native scrollbar controls while clipping the Point neighborhood.
      for (const edge of [
        { x: 4, y: 4 },
        { x: viewport.width - 24, y: 4 },
        { x: 4, y: viewport.height - 4 },
        { x: viewport.width - 24, y: viewport.height - 4 },
      ]) {
        await click(edge);
        await until(
          `${root}.querySelector('iframe')?.contentDocument?.querySelector('#draft')`,
        );
        expect((await captures()).at(-1).point).toEqual(edge);
        expect(await js("scrollY")).toBe(0);
        expect(await pinCenter()).toEqual(edge);
        await control("[data-close]");
      }
      await js(
        `window.savedNotes=[{id:'saved-point',body:'Saved point',web:{before:requests.filter(r=>r.action==='capture').at(-1).payload.capture,after:[]}}]`,
      );
      await until(
        `${root}.querySelectorAll('.pin:not(.draft-pin)').length===1`,
      );
      expect(await pinCenter(".pin")).toEqual({
        x: viewport.width - 24,
        y: viewport.height - 4,
      });
      await js("window.scrollTo(0,40)");
      await until(
        `${root}.querySelector('.pin').style.top==='${viewport.height - 44}px'`,
      );
      expect(await pinCenter(".pin")).toEqual({
        x: viewport.width - 24,
        y: viewport.height - 44,
      });
      await control(".pin");
      await until(
        `${root}.querySelector('iframe')?.contentDocument?.querySelector('#draft')`,
      );
      await js(
        `window.savedFrame=${root}.querySelector('iframe');savedFrame.contentDocument.querySelector('#draft').value='Keep this reply'`,
      );
      await mode("element");
      await message("add-capture");
      await click(await center("#other"));
      await until(`${root}.querySelector('.capture-prompt').hidden`);
      expect(
        await js("requests.filter(r=>r.action==='capture').at(-1).payload.id"),
      ).toBe("saved-point");
      expect(await js(`${root}.querySelector('.head b').textContent`)).toBe(
        "Web note 1 · Reply",
      );
      await message("add-capture");
      await control("[data-cancel-capture]");
      expect(
        await js(
          `${root}.querySelector('iframe')===savedFrame && savedFrame.contentDocument.querySelector('#draft').value==='Keep this reply'`,
        ),
      ).toBe(true);
      await message("add-capture");
      await click(await center("#target"));
      await until(`${root}.querySelector('.capture-prompt').hidden`);
      expect(await js("window.replyWeb.additional.length")).toBe(1);
      expect(await js(`${root}.querySelector('.head b').textContent`)).toBe(
        "Web note 1 · Reply · 2 captures",
      );
      expect(
        await js(
          `${root}.querySelector('iframe')===savedFrame && savedFrame.contentDocument.querySelector('#draft').value==='Keep this reply'`,
        ),
      ).toBe(true);
      await send("Emulation.setDeviceMetricsOverride", {
        width: 360,
        height: 480,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await until(
        `innerWidth===360 && innerHeight===480 && ${root}.querySelector('.dock').offsetWidth===336 && ${root}.querySelector('.dock').offsetHeight===400 && ${root}.querySelector('.dock').getBoundingClientRect().right<=348 && ${root}.querySelector('.dock').getBoundingClientRect().bottom<=412`,
      );
      const compact = await dockBounds();
      expect(compact.width).toBeLessThanOrEqual(336);
      expect(compact.height).toBeLessThanOrEqual(400);
      expect(compact.x + compact.width).toBeLessThanOrEqual(348);
      expect(compact.y + compact.height).toBeLessThanOrEqual(412);
      expect(
        await js(`(()=>{
        const panel=${root}.querySelector('.dock').getBoundingClientRect();
        const launcher=${root}.querySelector('.launcher').getBoundingClientRect();
        return launcher.top >= panel.bottom && launcher.bottom <= innerHeight &&
          ['[data-browse]','[data-annotate]','[data-launcher]'].every(selector=>{
            const button=${root}.querySelector(selector), r=button.getBoundingClientRect();
            return ${root}.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(selector)===button;
          });
      })()`),
      ).toBe(true);
      await message("annotation", { open: true });
      expect(await dockBounds()).toEqual({
        x: 0,
        y: 0,
        width: 360,
        height: 480,
      });
      await message("annotation", { open: false });
      expect(await dockBounds()).toEqual(compact);
    } finally {
      await chrome?.close();
      server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  60_000,
);
