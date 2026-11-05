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
  "color controls preserve highlighted code, drafts, alpha, and read-only ownership in full and framed reviews",
  async () => {
    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "colors.ts")],
      target: "browser",
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);
    const script = await bundle.outputs[0]!.text();
    const fixture = `<!doctype html><main class="nbox">
    <div id="message"><p>Agent #abc and rgba(255, 0, 0, .5).</p><pre><code><span class="nf">rgb</span><span>(</span>10 20 30 / 50%<span>)</span>; <span>hsl</span>(120 <span>100%</span> 50%)</code></pre><p><a href="https://example.com/#fff">#fff</a> <button class="nref">#aabbccdd</button></p></div>
    <div class="reply"><textarea aria-label="Reply">Before #abc and #abc after</textarea><button class="color-insert" type="button">Color</button><button id="save" type="button">Save reply</button></div>
    </main><script type="module">
    import {decorateColors,wireColorComposer} from '/colors.js';
    window.saves=0;window.inputs=0;window.copied='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});
    const message=document.querySelector('#message');window.originalText=message.textContent;window.originalCode=message.querySelector('pre').textContent;
    decorateColors(message);decorateColors(message);
    const ta=document.querySelector('textarea');ta.addEventListener('input',()=>inputs++);document.querySelector('#save').onclick=()=>saves++;
    wireColorComposer(document.querySelector('.reply'),ta);window.ready=true;
    </script>`;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/colors.js")
          return new Response(script, {
            headers: { "content-type": "text/javascript" },
          });
        return new Response(
          url.pathname === "/embed"
            ? '<!doctype html><iframe title="Embedded review" src="/fixture"></iframe>'
            : fixture,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const profile = await mkdtemp(path.join(tmpdir(), "lcr-colors-browser-"));
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
      const ready = (expression: string) =>
        js(
          `(()=>{if(${expression})return;const gate=Promise.withResolvers();const observer=new MutationObserver(check);function check(){if(${expression}){observer.disconnect();document.removeEventListener('load',check,true);gate.resolve();}}observer.observe(document,{childList:true,subtree:true,attributes:true});for(const frame of document.querySelectorAll('iframe'))if(frame.contentDocument)observer.observe(frame.contentDocument,{childList:true,subtree:true,attributes:true});document.addEventListener('load',check,true);return gate.promise;})()`,
        );
      await send("Page.navigate", {
        url: `http://127.0.0.1:${server.port}/fixture`,
      });
      await ready("window.ready");
      expect(
        await js(
          `({count:document.querySelectorAll('#message .color-swatch').length,text:document.querySelector('#message').textContent===originalText,code:document.querySelector('pre').textContent===originalCode,highlight:document.querySelector('pre .nf').textContent,links:document.querySelectorAll('a .color-swatch,.nref .color-swatch').length})`,
        ),
      ).toEqual({
        count: 4,
        text: true,
        code: true,
        highlight: "rgb",
        links: 0,
      });

      await js(
        `document.querySelectorAll('#message .color-swatch')[1].click()`,
      );
      expect(
        await js(
          `({value:document.querySelector('.message-color-value').value,apply:!!document.querySelector('[data-color-action="apply"]'),original:document.querySelector('#message').textContent===originalText})`,
        ),
      ).toEqual({ value: "rgba(255, 0, 0, .5)", apply: false, original: true });
      await js(
        `{const native=document.querySelector('dialog input[type="color"]');native.value='#112233';native.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      expect(
        await js(`document.querySelector('.message-color-value').value`),
      ).toBe("#11223380");
      await js(
        `document.querySelector('[data-color-action="save"]').click();document.querySelector('[data-color-action="copy"]').click()`,
      );
      expect(
        await js(
          `({copied,saved:JSON.parse(localStorage.getItem('lcr:message-colors')),unchanged:document.querySelector('#message').textContent===originalText,saves})`,
        ),
      ).toEqual({
        copied: "#11223380",
        saved: ["#11223380"],
        unchanged: true,
        saves: 0,
      });
      expect(
        await js(
          `(()=>{document.querySelector('[data-color-action="cancel"]').click();return !!document.querySelector('dialog');})()`,
        ),
      ).toBe(false);

      await js(
        `document.querySelectorAll('.composer-colors button')[1].click();const value=document.querySelector('.message-color-value');value.value='#1234';value.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-color-action="apply"]').click()`,
      );
      await ready("!document.querySelector('dialog')");
      expect(
        await js(
          `(()=>{const ta=document.querySelector('textarea');return {value:ta.value,selected:ta.value.slice(ta.selectionStart,ta.selectionEnd),focused:document.activeElement===ta,inputs,saves};})()`,
        ),
      ).toEqual({
        value: "Before #abc and #1234 after",
        selected: "#1234",
        focused: true,
        inputs: 1,
        saves: 0,
      });
      await js(
        `{const ta=document.querySelector('textarea');ta.setSelectionRange(0,6);document.querySelector('.color-insert').click();const value=document.querySelector('.message-color-value');value.value='#01020304';value.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-color-action="apply"]').click();}`,
      );
      await ready("!document.querySelector('dialog')");
      expect(await js(`document.querySelector('textarea').value`)).toBe(
        "#01020304 Before #abc and #1234 after",
      );
      await js(
        `document.querySelector('.color-insert').click();document.querySelector('.message-color-value').value='#000';document.querySelector('dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`,
      );
      await ready("!document.querySelector('dialog')");
      expect(
        await js(
          `({value:document.querySelector('textarea').value,inputs,saves})`,
        ),
      ).toEqual({
        value: "#01020304 Before #abc and #1234 after",
        inputs: 2,
        saves: 0,
      });

      // Read-only source stays unchanged; reuse is an explicit insertion into a separate live reply.
      await js(
        `{const ta=document.querySelector('textarea');ta.focus();ta.setSelectionRange(0,0);document.querySelector('#message .color-swatch').click();document.querySelector('[data-color-action="reply"]').click();}`,
      );
      await ready("!document.querySelector('dialog')");
      expect(
        await js(
          `({draft:document.querySelector('textarea').value,source:document.querySelector('#message').textContent===originalText,saves})`,
        ),
      ).toEqual({
        draft: "#abc #01020304 Before #abc and #1234 after",
        source: true,
        saves: 0,
      });
      await js(
        `document.querySelector('textarea').readOnly=true;document.querySelector('.color-insert').click()`,
      );
      expect(await js(`!!document.querySelector('dialog')`)).toBe(false);

      // Reload into an iframe: persistent colors are available and the dialog belongs to its document.
      await send("Page.navigate", {
        url: `http://127.0.0.1:${server.port}/embed`,
      });
      await ready(`document.querySelector('iframe')?.contentWindow.ready`);
      await js(
        `document.querySelector('iframe').contentDocument.querySelector('#message .color-swatch').click()`,
      );
      expect(
        await js(
          `(()=>{const d=document.querySelector('iframe').contentDocument;return {inside:!!d.querySelector('dialog[open]'),outside:!!document.querySelector('dialog'),saved:!!d.querySelector('[data-color="#11223380"]'),apply:!!d.querySelector('[data-color-action="apply"]')};})()`,
        ),
      ).toEqual({ inside: true, outside: false, saved: true, apply: false });
      await js(
        `document.querySelector('iframe').contentDocument.querySelector('[data-color-action="cancel"]').click()`,
      );
      await ready(
        `!document.querySelector('iframe').contentDocument.querySelector('dialog')`,
      );
      await js(
        `{const w=document.querySelector('iframe').contentWindow,d=w.document;Object.defineProperty(w,'localStorage',{configurable:true,get(){throw new Error('Storage denied');}});d.querySelector('.color-insert').click();d.querySelector('[data-color-action="save"]').click();}`,
      );
      expect(
        await js(
          `document.querySelector('iframe').contentDocument.querySelector('.message-color-status').textContent`,
        ),
      ).toContain("storage is unavailable");
    } finally {
      if (chrome) await chrome.close();
      server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  60_000,
);
