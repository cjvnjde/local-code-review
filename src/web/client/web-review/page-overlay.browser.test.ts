import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../../../browser/review-browser.ts";

const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;
type Point = { x: number; y: number };

browserTest(
  "page inspection stays read-only, preserves drafts, and Point keeps live and frozen element evidence",
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
        if (url.searchParams.has("ui-draft"))
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
          if(message.action==='notes')value={notes:[]};
          if(message.action==='context-settings')value={aiContext:false,contextHtml:false,contextFullPage:false};
          if(message.action==='capture')value={draftId:'draft'};
          if(message.action==='freeze'){
            const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;
            value={id:'frozen',data:canvas.toDataURL()};
          }
          queueMicrotask(()=>window.overlay.resolve(message.seq,{ok:true,value}));
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
        js(`${root}.querySelector('[data-mode="${value}"]').click()`);
      const control = (selector: string) =>
        js(`${root}.querySelector(${JSON.stringify(selector)}).click()`);
      const center = async (selector: string): Promise<Point> =>
        js(
          `(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`,
        );
      const mouse = (type: string, at: Point, extra = {}) =>
        send("Input.dispatchMouseEvent", {
          type,
          ...at,
          button: type === "mouseMoved" ? "none" : "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
          ...extra,
        });
      const click = async (at: Point) => {
        await mouse("mouseMoved", at);
        await mouse("mousePressed", at);
        await mouse("mouseReleased", at);
      };
      const captures = () =>
        js(
          "requests.filter(r=>r.action==='capture').map(r=>r.payload.capture)",
        );
      const at = await center("#target");

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
      await js(
        `window.savedFrame=${root}.querySelector('iframe');savedFrame.contentDocument.querySelector('#draft').value='Keep this draft'`,
      );

      await mode("inspect");
      await mouse("mouseMoved", at);
      const bounds = await js(
        "(()=>{const b=document.querySelector('#target').getBoundingClientRect();return {width:b.width,height:b.height}})()",
      );
      expect(await js(`${root}.querySelector('.label').textContent`)).toContain(
        `${bounds.width} × ${bounds.height} CSS px`,
      );
      await click(at);
      const properties = await js(
        `${root}.querySelector('[data-inspect-properties]').textContent`,
      );
      expect(properties).toContain("Rendered size");
      expect(properties).toContain("CSS width120px");
      expect(properties).toContain("Padding12px");
      expect(properties).toContain("Radius9px");
      expect(properties).toContain("Font weight600");
      expect(properties).toContain("Line height24px");
      expect(properties).toContain("rgb(20, 40, 60)");
      expect(await js("clicks")).toBe(0);
      expect((await captures()).length).toBe(1);
      expect(
        await js(
          `${root}.querySelector('iframe')===savedFrame && savedFrame.contentDocument.querySelector('#draft').value==='Keep this draft'`,
        ),
      ).toBe(true);

      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...at,
        deltaX: 0,
        deltaY: 100,
        modifiers: 1,
      });
      expect(
        await js(
          `document.querySelector(${root}.querySelector('[data-inspect-name]').textContent) === document.querySelector('#parent')`,
        ),
      ).toBe(true);
      expect(
        await js(
          `${root}.querySelector('[data-inspect-properties]').textContent`,
        ),
      ).toContain("Gap17px");
      await click(await center("#other"));
      expect(
        await js(
          `document.querySelector(${root}.querySelector('[data-inspect-name]').textContent) === document.querySelector('#other')`,
        ),
      ).toBe(true);
      await js("window.scrollTo(0,40)");
      await until(
        `${root}.querySelector('.outline').style.top===document.querySelector('#other').getBoundingClientRect().y+'px'`,
      );
      await control("[data-inspect-close]");
      expect(await js(`${root}.querySelector('.inspector').hidden`)).toBe(true);
      expect(await js(`${root}.querySelector('iframe')===savedFrame`)).toBe(
        true,
      );
      await click(await center("#target"));
      expect(await js("clicks")).toBe(1);
      await control("[data-close]");
      await js("window.scrollTo(0,0)");

      await mode("inspect");
      await click(at);
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
      expect(await js(`${root}.querySelector('.inspector').hidden`)).toBe(true);
      expect((await captures()).length).toBe(1);

      await mode("element");
      await control("[data-freeze]");
      await until(`!!${root}.querySelector('.frozen-page')`);
      await js(
        "document.querySelector('#target').textContent='Changed after freeze';document.querySelector('#target').style.color='red'",
      );
      await mode("point");
      await click(at);
      await until("requests.filter(r=>r.action==='capture').length===2");
      const frozen = (await captures())[1];
      expect(frozen.mode).toBe("point");
      expect(frozen.element.text).toBe("Target");
      expect(frozen.element.styles.color).toBe("rgb(20, 40, 60)");
      expect(frozen.rect).toEqual(live.rect);

      await control("[data-close]");
      await control("[data-resume]");
      await js(
        "for(let i=0;i<110;i++){const el=document.createElement('div');el.style.cssText='position:absolute;left:'+(500+i%20*12)+'px;top:'+(400+Math.floor(i/20)*12)+'px;width:10px;height:10px';document.body.prepend(el)}",
      );
      await control("[data-freeze]");
      await until(`!!${root}.querySelector('.frozen-page')`);
      await mode("point");
      await click(at);
      await until("requests.filter(r=>r.action==='capture').length===3");
      const truncated = (await captures())[2];
      expect(truncated.element).toBeUndefined();
      expect(truncated.selector).toBeUndefined();
    } finally {
      await chrome?.close();
      server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  60_000,
);
