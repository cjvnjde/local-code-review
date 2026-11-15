import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { launchReviewBrowser } from "../browser/review-browser.ts";
import { createSession } from "../review/session.ts";
import { createHub } from "../server/events.ts";
import { createWebReview } from "./controller.ts";
import { readContext, readContextPart } from "../review/context.ts";

// Real CDP, real screenshots, real axe and real review persistence; never run unless explicitly enabled.
test.skipIf(process.env.LCR_TEST_BROWSER !== "1")(
  "pre-capture and freeze privacy persist only masked pixels; axe excludes the editor and saves only selected findings",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lcr-privacy-browser-"));
    const app = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          '<!doctype html><html lang="en"><title>SECRET</title><style>body{margin:0;background:white}#secret{position:fixed;left:40px;top:60px;width:100px;height:100px;background:rgb(197,83,41)}#unnamed{position:fixed;left:250px;top:100px;width:80px;height:40px}</style><main><div id="secret">SECRET</div><button id="unnamed"></button></main></html>',
          { headers: { "content-type": "text/html" } },
        ),
    });
    const review = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response("<!doctype html><title>Review</title>", {
          headers: { "content-type": "text/html" },
        }),
    });
    const profile = path.join(root, "browser");
    const owner = await launchReviewBrowser(profile, [
      "--headless=new",
      "--window-size=1280,900",
    ]);
    const url = `http://127.0.0.1:${app.port}/`;
    const session = createSession(root, ".review", "HEAD");
    const web = createWebReview({
      url,
      repoRoot: root,
      outDir: ".review",
      browserProfile: "existing",
      browserDataDir: profile,
      session,
      hub: createHub(),
      reviewUrl: () => `http://127.0.0.1:${review.port}/`,
    });
    const cdp = owner.cdp;
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    async function js(expression: string) {
      const result = await cdp.send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text,
        );
      return result.result.value;
    }
    async function until(expression: string) {
      await js(
        `(()=>{const gate=Promise.withResolvers();const check=()=>{if(${expression})gate.resolve();else requestAnimationFrame(check)};check();return gate.promise})()`,
      );
    }
    async function files() {
      return readdir(path.join(root, ".review"), {
        recursive: true,
        withFileTypes: true,
      }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    }
    const host = "document.querySelector('[data-lcr-overlay]')";
    const shadow = `${host}.shadowRoot`;
    try {
      await cdp.send("Page.enable", {}, sessionId);
      const loaded = Promise.withResolvers<void>();
      const off = cdp.on("Page.loadEventFired", (_, session) => {
        if (session === sessionId) loaded.resolve();
      });
      try {
        await cdp.send("Page.navigate", { url }, sessionId);
        await loaded.promise;
      } finally {
        off();
      }
      await until(
        "document.readyState==='complete' && !!document.getElementById('secret')",
      );
      web.configureContext({
        aiContext: true,
        contextHtml: true,
        contextFullPage: true,
        contextDiagnostics: true,
      });
      await web.open();
      await js(`window.sequence=1000000;window.rpc=(action,payload)=>{
      const {promise,resolve,reject}=Promise.withResolvers();
      const host=${host},api=window[host.id],seq=++window.sequence,previous=api.resolve;
      api.resolve=(id,result)=>{if(id!==seq){previous(id,result);return;}api.resolve=previous;result.ok?resolve(result.value):reject(new Error(result.error));};
      window[host.id+'_send'](JSON.stringify({seq,action,payload}));return promise;
    };window.captureInput={url:location.href,title:'SECRET',at:new Date().toISOString(),mode:'area',rect:{x:40,y:60,width:100,height:100},viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},scroll:{x:scrollX,y:scrollY},components:[],selector:'#SECRET',element:{tag:'div',text:'SECRET',attributes:{title:'SECRET'},styles:{content:'SECRET'}},contextHtml:{data:'SECRET'},redactions:[{x:40,y:60,width:100,height:100}]};`);
      const baseline = (await files()).filter((entry) => entry.isFile()).length;
      await expect(
        js(
          "rpc('freeze',{capture:{...captureInput,redactions:[{x:-1,y:0,width:10,height:10}]}})",
        ),
      ).rejects.toThrow("Redaction");
      expect((await files()).filter((entry) => entry.isFile())).toHaveLength(
        baseline,
      );
      const frozen = await js("rpc('freeze',{capture:captureInput})");
      const frozenPng = PNG.sync.read(
        Buffer.from(frozen.data.split(",")[1], "base64"),
      );
      const dpr = await js("devicePixelRatio");
      const pixel =
        (Math.floor(100 * dpr) * frozenPng.width + Math.floor(100 * dpr)) * 4;
      expect([...frozenPng.data.subarray(pixel, pixel + 4)]).toEqual([
        0, 0, 0, 255,
      ]);
      const savedBeforeInvalid = (await files()).filter((entry) =>
        entry.isFile(),
      ).length;
      await expect(
        js(
          `rpc('capture',{freezeId:${JSON.stringify(frozen.id)},capture:{...captureInput,redactions:[]}})`,
        ),
      ).rejects.toThrow("retroactively");
      expect((await files()).filter((entry) => entry.isFile())).toHaveLength(
        savedBeforeInvalid,
      );
      // A privacy-preserving frozen crop must never trust a page-supplied canvas or source image.
      await js(
        `window[${host}.id].cropFrozen=()=>{throw new Error('unsafe page crop used')}`,
      );
      const captured = await js(
        `rpc('capture',{freezeId:${JSON.stringify(frozen.id)},capture:captureInput})`,
      );
      expect(
        web.draft(captured.draftId)?.before.redaction?.regions,
      ).toHaveLength(1);
      const privateContext = web.draft(captured.draftId)!.before.context!;
      const privateManifest = await readContext(
        root,
        ".review",
        privateContext.id,
      );
      for (const name of ["full-page-html", "full-page-css", "full-page-js"])
        expect(
          privateManifest!.parts.find((part) => part.name === name)?.status,
        ).toBe("excluded");
      expect(JSON.stringify(web.draft(captured.draftId))).not.toContain(
        "SECRET",
      );
      for (const file of await files()) {
        if (!file.isFile()) continue;
        const bytes = await readFile(path.join(file.parentPath, file.name));
        expect(bytes.includes(Buffer.from("SECRET"))).toBe(false);
        if (file.name.endsWith(".png")) {
          const png = PNG.sync.read(bytes);
          let retainsSecretPixels = false;
          for (let i = 0; i < png.data.length; i += 4)
            if (
              png.data[i] === 197 &&
              png.data[i + 1] === 83 &&
              png.data[i + 2] === 41
            ) {
              retainsSecretPixels = true;
              break;
            }
          expect(retainsSecretPixels).toBe(false);
        }
      }
      expect((await session.read()).notes).toHaveLength(0);
      // Put a deliberate violation inside lcr's open shadow root; it must not appear in axe output.
      await js(
        `const button=document.createElement('button');button.id='lcr-unnamed';${shadow}.append(button)`,
      );
      const report = await web.scanAccessibility();
      expect(report.engine.name).toBe("axe-core");
      expect(
        report.findings.some(
          (finding) =>
            finding.rule === "button-name" &&
            JSON.stringify(finding.targets).includes("#unnamed"),
        ),
      ).toBe(true);
      expect(JSON.stringify(report.findings)).not.toContain("lcr-unnamed");
      expect((await session.read()).notes).toHaveLength(0);
      const finding = report.findings.find(
        (item) => item.rule === "button-name",
      )!;
      await expect(
        web.saveAccessibilityFindings([finding.id, "not-from-report"]),
      ).rejects.toThrow("expired");
      expect((await session.read()).notes).toHaveLength(0);
      const saved = await web.saveAccessibilityFindings([finding.id]);
      expect(saved.saved).toHaveLength(1);
      expect((await session.read()).notes).toHaveLength(1);
      await web.saveAccessibilityFindings([finding.id]);
      expect((await session.read()).notes).toHaveLength(1);

      // Exercise real overlay drawing/removal controls, not just the controller RPC boundary.
      await js(`${shadow}.querySelector('[data-mode="redact"]').click()`);
      for (const event of [
        {
          type: "mousePressed" as const,
          x: 40,
          y: 60,
          button: "left" as const,
          clickCount: 1,
        },
        {
          type: "mouseMoved" as const,
          x: 140,
          y: 160,
          button: "left" as const,
          buttons: 1,
        },
        {
          type: "mouseReleased" as const,
          x: 140,
          y: 160,
          button: "left" as const,
          clickCount: 1,
        },
      ])
        await cdp.send("Input.dispatchMouseEvent", event, sessionId);
      expect(
        await js(`${shadow}.querySelector('.privacy-regions').children.length`),
      ).toBe(1);
      await expect(web.saveAccessibilityFindings([finding.id])).rejects.toThrow(
        "Privacy regions changed",
      );
      const privateReport = await web.scanAccessibility();
      expect(privateReport.privacy).toBe(true);
      expect(privateReport.findings.every((item) => !item.targets.length)).toBe(
        true,
      );
      await js(
        `${shadow}.querySelector('[data-mode="area"]').click();${shadow}.querySelector('[data-freeze]').click()`,
      );
      await until(`!!${shadow}.querySelector('.frozen-page')`);
      expect(
        await js(`${shadow}.querySelector('[data-mode="redact"]').disabled`),
      ).toBe(true);
      expect(
        await js(`${shadow}.querySelector('[data-freeze-status]').textContent`),
      ).toContain("already saved");
      await js(`${shadow}.querySelector('[data-resume]').click()`);
      await until(`!${shadow}.querySelector('.frozen-page')`);
      await js(
        `[...${shadow}.querySelectorAll('button')].find(button=>button.textContent==='Remove region 1').click()`,
      );
      expect(
        await js(`${shadow}.querySelector('.privacy-regions').children.length`),
      ).toBe(0);
      // Frozen source evidence must remain capture-time text after the live DOM changes.
      await js(
        `window.captureInput={...captureInput,at:new Date().toISOString(),redactions:[]};document.querySelector('style').textContent+='/* capture-source-before */';const script=document.createElement('script');script.type='application/json';script.textContent='{\"marker\":\"capture-script-before\"}';document.head.append(script);`,
      );
      const sourceFreeze = await js("rpc('freeze',{capture:captureInput})");
      // Direct freeze RPC does not install the overlay canvas; crop its actual PNG.
      await js(
        `window[${host}.id].cropFrozen=async({rect})=>{const image=new Image();image.src=${JSON.stringify(sourceFreeze.data)};await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.round(rect.width*devicePixelRatio);canvas.height=Math.round(rect.height*devicePixelRatio);canvas.getContext('2d').drawImage(image,rect.x*devicePixelRatio,rect.y*devicePixelRatio,canvas.width,canvas.height,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png').split(',')[1]}`,
      );
      await js(
        "document.querySelector('style').textContent+='/* capture-source-after */';document.querySelector('script[type=\"application/json\"]').textContent='{\"marker\":\"capture-script-after\"}'",
      );
      const sourceCapture = await js(
        `rpc('capture',{freezeId:${JSON.stringify(sourceFreeze.id)},capture:captureInput})`,
      );
      const sourceContext = web.draft(sourceCapture.draftId)!.before.context!;
      for (const [name, before, after] of [
        ["full-page-html", "capture-source-before", "capture-source-after"],
        ["full-page-css", "capture-source-before", "capture-source-after"],
        ["full-page-js", "capture-script-before", "capture-script-after"],
      ]) {
        const part = await readContextPart(
          root,
          ".review",
          sourceContext.id,
          name!,
        );
        expect(part).not.toBeNull();
        const text = new TextDecoder().decode(part!.bytes);
        expect(text).toContain(before!);
        expect(text).not.toContain(after!);
      }
      const pointCapture = await js(
        `rpc('capture',{freezeId:${JSON.stringify(sourceFreeze.id)},capture:{...captureInput,mode:'point',rect:{x:40,y:60,width:1,height:1}}})`,
      );
      const pointContext = web.draft(pointCapture.draftId)!.before.context!;
      const pointManifest = await readContext(root, ".review", pointContext.id);
      for (const name of ["full-page-html", "full-page-css", "full-page-js"])
        expect(
          pointManifest!.parts.find((part) => part.name === name)?.status,
        ).toBe("excluded");
    } finally {
      await web.close();
      await owner.close();
      app.stop(true);
      review.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
