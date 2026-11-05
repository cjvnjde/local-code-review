import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Cdp } from "../browser/cdp.ts";
import { createWebReview } from "./controller.ts";
import { createSession } from "../review/session.ts";
import { createHub } from "../server/events.ts";
import { startServer } from "../server/http.ts";
import { getDiff, getFileContext } from "../git/diff.ts";
import { readAttachment, saveAttachment } from "../review/attach.ts";
import { collectStatuses } from "../review/status.ts";
import { webSelectionKey } from "../shared/web-review.ts";
import { readContext, readContextPart } from "../review/context.ts";

// Opt-in because the ordinary suite and released executable require no installed browser.
const browserTest = process.env.LCR_TEST_BROWSER === "1" ? test : test.skip;
interface Target {
  targetId: string;
  type: string;
  url: string;
}
interface DomNode {
  nodeId: number;
  shadowRoots?: DomNode[];
  children?: DomNode[];
}
interface FrameNode {
  frame: { id: string; url: string };
  childFrames?: FrameNode[];
}
browserTest(
  "one review: diff and visual notes share editors, attachments, links, replies and references",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lcr-browser-test-"));
    async function git(...args: string[]) {
      const child = Bun.spawn(["git", ...args], {
        cwd: dir,
        stdout: "ignore",
        stderr: "pipe",
      });
      if (await child.exited)
        throw new Error(await new Response(child.stderr).text());
    }
    await git("init", "-q");
    await writeFile(path.join(dir, ".gitignore"), ".review/\n");
    await writeFile(
      path.join(dir, "settings.ts"),
      "export const padding = 24;\n",
    );
    await git("add", ".");
    await git(
      "-c",
      "user.name=Browser test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "initial",
    );
    await writeFile(
      path.join(dir, "settings.ts"),
      "export const padding = 60;\n",
    );
    const source = { repoRoot: dir, context: 5, diffArgs: [] };
    let version = 1;
    const app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          `<!doctype html><html><head><title>Studio settings</title><style>
    body{margin:0;background:#f6f5fa;color:#262538;font:16px system-ui}header{padding:30px 60px;background:white;border-bottom:1px solid #ddd}main{max-width:1000px;margin:60px auto}h1{font-size:38px;margin:0 0 8px}.card{background:white;padding:32px;border:1px solid #dedce9;border-radius:16px;margin:30px 0}button{background:${version === 1 ? "#714ed9" : "#227d62"};color:white;border:0;padding:16px ${version === 1 ? "24" : "60"}px;border-radius:8px;font-size:16px}p{color:#66637b}.spacer{height:1000px}
    </style></head><body><header>STUDIO / SETTINGS</header><main><h1>Make room for your next idea.</h1><p>Manage your workspace and keep your team in sync.</p><section class="card"><h2>Workspace details</h2><p>Changes apply to everyone on your team.</p><button id="save" data-testid="save">Save changes</button></section><div class="spacer"></div><button id="bottom">Bottom action</button></main><script>
    window.clicks=0;document.querySelector('#save').onclick=()=>window.clicks++;
    document.querySelector('#save')['__reactFiber$fixture']={type:{name:'WorkspaceSettings'},_debugSource:{fileName:'src/WorkspaceSettings.tsx',lineNumber:24},return:null};
    document.querySelector('.card').__vueParentComponent={type:{__name:'SettingsCard',__file:'src/SettingsCard.vue'},parent:null};
    </script></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    });
    const session = createSession(dir, ".review", "HEAD");
    const hub = createHub();
    let reviewUrl = "",
      delivered = 0;
    const agent = {
      agent: "External ACP agent",
      publish: async () => {
        delivered++;
        return { state: "queued" as const, count: 1 };
      },
    };
    const web = createWebReview({
      url: "http://127.0.0.1:" + app.port,
      repoRoot: dir,
      outDir: ".review",
      browserProfile: "project",
      session,
      hub,
      reviewUrl: () => reviewUrl,
      browserArgs: [
        "--headless=new",
        "--window-size=1280,900",
        "--force-device-scale-factor=2",
      ],
    });
    const server = startServer({
      port: 0,
      repoRoot: dir,
      outDir: ".review",
      range: "HEAD",
      reviewId: "",
      context: 5,
      getDiff: () => getDiff(source),
      getContext: (file, start, end) =>
        getFileContext(source, file, start, end),
      readBlob: async () => null,
      saveAttachment: (b, t) => saveAttachment(dir, ".review", b, t),
      readAttachment: (n) => readAttachment(dir, ".review", n),
      openFile: async () => false,
      getStatuses: () => collectStatuses(dir, ".review"),
      listReviews: async () => [],
      deleteReviews: async () => [],
      describeReviews: async () => [],
      getGhosts: async () => [],
      importNote: async () => null,
      session,
      hub,
      agent,
      web,
    });
    reviewUrl = "http://127.0.0.1:" + server.port;
    let cdp: Cdp | null = null;
    try {
      await web.open();
      const active = (
        await readFile(
          path.join(dir, ".review/.browser/DevToolsActivePort"),
          "utf8",
        )
      )
        .trim()
        .split("\n");
      cdp = await Cdp.connect("ws://127.0.0.1:" + active[0] + active[1]);
      const targets = async (): Promise<Target[]> =>
        (await cdp!.send("Target.getTargets")).targetInfos;
      const reviewTarget = (await targets()).find(
        (t) => t.url === reviewUrl + "/",
      )!;
      let appTarget = (await targets()).find(
        (t) => t.url === web.status().url,
      )!;
      let sid = (
        await cdp.send("Target.attachToTarget", {
          targetId: appTarget.targetId,
          flatten: true,
        })
      ).sessionId;
      const reviewSid = (
        await cdp.send("Target.attachToTarget", {
          targetId: reviewTarget.targetId,
          flatten: true,
        })
      ).sessionId;
      const send = (method: string, params: Record<string, unknown> = {}) =>
        cdp!.send(method, params, sid);
      let acceptingDrawingDiscard = false;
      const errors: string[] = [];
      cdp.on("Runtime.exceptionThrown", (p) =>
        errors.push(
          p.exceptionDetails.exception?.description || p.exceptionDetails.text,
        ),
      );
      cdp.on("Page.javascriptDialogOpening", (event, eventSid) => {
        if (acceptingDrawingDiscard) {
          acceptingDrawingDiscard = false;
          if (
            event.type !== "confirm" ||
            !event.message.includes("Discard your drawing changes?")
          )
            errors.push(
              "Wrong drawing dialog: " + event.type + " " + event.message,
            );
          void cdp!.send(
            "Page.handleJavaScriptDialog",
            { accept: true },
            eventSid,
          );
        } else
          errors.push("Unexpected dialog: " + event.type + " " + event.message);
      });
      await send("Runtime.enable");
      await cdp.send("Runtime.enable", {}, reviewSid);
      await send("Page.enable");
      await cdp.send("Page.enable", {}, reviewSid);
      async function evaluate(
        expression: string,
        session = sid,
        contextId?: number,
      ) {
        const r = await cdp!
          .send(
            "Runtime.evaluate",
            {
              expression,
              awaitPromise: true,
              returnByValue: true,
              ...(contextId ? { contextId } : {}),
            },
            session,
          )
          .catch((error) => {
            throw new Error(
              "Browser expression " +
                expression +
                ": " +
                String(error) +
                "; " +
                errors.join("\n"),
            );
          });
        if (r.exceptionDetails)
          throw new Error(
            r.exceptionDetails.exception?.description ||
              r.exceptionDetails.text,
          );
        return r.result.value;
      }
      const js = (expression: string) => evaluate(expression);
      const reviewJs = (expression: string) => evaluate(expression, reviewSid);
      // These polls cross into a separate real Chrome process; fake timers cannot drive its lifecycle.
      async function until(fn: () => Promise<unknown>, message: string) {
        for (let i = 0; i < 150; i++) {
          if (await fn()) return;
          await Bun.sleep(100);
        }
        throw new Error(
          "Timed out: " +
            message +
            "; browser errors: " +
            errors.join("\n") +
            "; review: " +
            (await reviewJs("document.body.innerText")) +
            "; saved notes: " +
            JSON.stringify(
              (await session.read()).notes.map((n) => ({
                id: n.id,
                body: n.body,
                extra: n.web?.additional?.length,
              })),
            ) +
            "; global bodies: " +
            (await reviewJs(
              'JSON.stringify([...document.querySelectorAll("#loGlobal .nbody")].map(n=>n.textContent))',
            )),
        );
      }
      async function root() {
        await until(
          () => js('!!document.querySelector("[id^=__lcr_]")'),
          "overlay",
        );
        const doc: { root: DomNode } = await send("DOM.getDocument", {
          depth: -1,
          pierce: true,
        });
        function visit(n: DomNode): DomNode | undefined {
          return n.shadowRoots?.[0] || n.children?.map(visit).find(Boolean);
        }
        const shadow = visit(doc.root)!;
        const resolved = await send("DOM.resolveNode", {
          nodeId: shadow.nodeId,
        });
        await send("Runtime.callFunctionOn", {
          objectId: resolved.object.objectId,
          functionDeclaration: "function(){globalThis.testRoot=this;}",
        });
      }
      const click = (selector: string) =>
        js(`testRoot.querySelector(${JSON.stringify(selector)}).click()`);
      async function mouse(type: string, x: number, y: number, modifiers = 0) {
        await send("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          modifiers,
          button: "left",
          clickCount: 1,
          ...(type === "mousePressed" ? { buttons: 1 } : {}),
        });
      }
      let frameContext = 0;
      async function frame(expectedNoteId?: string) {
        await until(
          () => js('!!testRoot.querySelector("iframe")'),
          "shared note frame",
        );
        let id = "";
        await until(async () => {
          const tree: { frameTree: FrameNode } =
            await send("Page.getFrameTree");
          id =
            tree.frameTree.childFrames?.find((f) =>
              expectedNoteId
                ? f.frame.url.includes("?ui-note=") &&
                  new URL(f.frame.url).searchParams.get("ui-note") ===
                    expectedNoteId
                : f.frame.url.includes("?ui-"),
            )?.frame.id || "";
          return id;
        }, "loaded note frame");
        frameContext = (
          await send("Page.createIsolatedWorld", {
            frameId: id,
            worldName: "lcr-integration",
          })
        ).executionContextId;
        await until(
          () =>
            frameJs(
              expectedNoteId
                ? `document.querySelector("#uiNote [data-nid]")?.dataset.nid===${JSON.stringify(expectedNoteId)}&&!!document.querySelector("#uiNote .nbox")`
                : '!!document.querySelector("#uiNote .nbox")',
            ),
          "shared note editor",
        );
      }
      const frameJs = (expression: string) =>
        evaluate(expression, sid, frameContext);
      async function writeComment(body: string) {
        await frameJs(
          `(()=>{const ta=document.querySelector('#uiNote textarea');ta.value=${JSON.stringify(body)};ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus();})()`,
        );
      }
      async function saveFrame(body: string, key?: "modified" | "plain") {
        await writeComment(body);
        if (key) {
          const modifiers = key === "modified" ? 2 : 0;
          await send("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Enter",
            code: "Enter",
            modifiers,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            modifiers,
          });
        } else
          await frameJs(
            'document.querySelector("#uiNote [data-save-note]").click()',
          );
        await until(
          () => js('testRoot.querySelector(".dock").hidden'),
          "editor closes after save",
        );
      }
      await root();
      await cdp.send("Target.activateTarget", {
        targetId: reviewTarget.targetId,
      });
      await until(
        () => reviewJs('!!document.querySelector("tr.r")'),
        "Git diff alongside live page",
      );
      expect(
        await reviewJs(
          'getComputedStyle(document.querySelector("#tree")).display',
        ),
      ).not.toBe("none");
      // Save a real diff comment first; it must be available in the visual editor's reference picker.
      await reviewJs(
        'document.querySelector("tr.r").click();document.querySelector(".nbox textarea").value="Use the same padding in the live UI.";document.querySelector("[data-save-note]").click()',
      );
      await until(
        async () => (await session.read()).notes.length === 1,
        "diff comment saved",
      );
      const diffNote = (await session.read()).notes[0]!;
      const diffRef = diffNote.id.split("|#").at(-1)!;
      expect(diffNote.file).toBe("settings.ts");
      await cdp.send("Target.activateTarget", { targetId: appTarget.targetId });
      expect(
        await js('getComputedStyle(testRoot.querySelector(".bar")).display'),
      ).toBe("none");
      // Moving the collapsed launcher does not annotate or open it.
      const launcher = await js(
        '(()=>{const r=testRoot.querySelector("[data-launcher]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
      );
      await mouse("mousePressed", launcher.x, launcher.y);
      await mouse("mouseMoved", launcher.x + 80, launcher.y - 80);
      await mouse("mouseReleased", launcher.x + 80, launcher.y - 80);
      expect(
        await js(
          'testRoot.querySelector("[data-launcher]").getAttribute("aria-expanded")',
        ),
      ).toBe("false");
      const moved = await js(
        'testRoot.querySelector("[data-launcher]").getBoundingClientRect().x',
      );
      expect(moved).toBeCloseTo(launcher.x - 22 + 80);
      expect(
        await js(
          'testRoot.querySelector("[data-launcher]").getAttribute("aria-pressed")',
        ),
      ).toBe("true");
      const box = await js(
        '(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+10,y:r.y+10,width:r.width,height:r.height}})()',
      );
      // A short click turns selection off without opening tools; the app receives normal clicks.
      async function pressLauncher(hold = false) {
        const p = await js(
          '(()=>{const r=testRoot.querySelector("[data-launcher]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
        );
        await mouse("mousePressed", p.x, p.y);
        if (hold)
          await until(
            () => js('!testRoot.querySelector(".bar").hidden'),
            "hold opens tools",
          );
        await mouse("mouseReleased", p.x, p.y);
      }
      await pressLauncher();
      expect(
        await js(
          'testRoot.querySelector("[data-launcher]").getAttribute("aria-pressed")',
        ),
      ).toBe("false");
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      await mouse("mousePressed", box.x, box.y);
      await mouse("mouseReleased", box.x, box.y);
      expect(await js("window.clicks")).toBe(1);
      expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
      // Holding opens the menu without changing selection, including on release.
      await pressLauncher(true);
      expect(
        await js(
          'testRoot.querySelector("[data-launcher]").getAttribute("aria-pressed")',
        ),
      ).toBe("false");
      await click('[data-mode="block"]');
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      await pressLauncher();
      await pressLauncher();
      expect(
        await js(
          'testRoot.querySelector("[data-mode=block]").getAttribute("aria-pressed")',
        ),
      ).toBe("true");
      // Outside clicks dismiss the one-use menu even in Browse mode.
      await pressLauncher();
      await pressLauncher(true);
      await mouse("mousePressed", box.x, box.y);
      await mouse("mouseReleased", box.x, box.y);
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      await pressLauncher(true);
      await js(
        'testRoot.querySelector("[data-launcher]").focus();document.querySelector("#save").focus()',
      );
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      await pressLauncher(true);
      // Headless target activation does not emit OS window blur, so deliver that browser event directly.
      await js('dispatchEvent(new Event("blur"))');
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      await pressLauncher(true);
      await click('[data-mode="element"]');
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      // Freeze a real CSS hover state, then capture its saved pixels and DOM hints after it disappears.
      await js(`(()=>{
        const fixture=document.createElement("div");fixture.id="hover-fixture";fixture.tabIndex=-1;
        fixture.innerHTML='<style>#hover-fixture{position:fixed;left:20px;top:30px;width:100px;height:40px;z-index:50;background:white}#hover-tooltip{display:none;position:absolute;left:0;top:50px;width:140px;height:50px;background:#ff0000;color:white}#hover-fixture:hover #hover-tooltip{display:block}</style>Hover here<div id="hover-tooltip">Hover-only menu</div><input id="freeze-input" style="position:absolute;left:180px;top:0">';
        document.body.append(fixture);
      })()`);
      async function freezeKey() {
        for (const type of ["keyDown", "keyUp"])
          await send("Input.dispatchKeyEvent", {
            type,
            key: "F",
            code: "KeyF",
            modifiers: 10,
          });
      }
      await js('document.querySelector("#freeze-input").focus()');
      // Option+F is ordinary macOS text input; the freeze shortcut must not depend on it.
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ƒ",
        code: "KeyF",
        text: "ƒ",
        modifiers: 1,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ƒ",
        code: "KeyF",
        modifiers: 1,
      });
      expect(await js('!!testRoot.querySelector(".frozen-page")')).toBe(false);
      expect(await js('document.querySelector("#freeze-input").value')).toBe(
        "ƒ",
      );
      // Hovering does not blur a text field. Freeze must still work without editing its value.
      await mouse("mouseMoved", 30, 40);
      expect(
        await js(
          'getComputedStyle(document.querySelector("#hover-tooltip")).display',
        ),
      ).toBe("block");
      web.configureContext({
        aiContext: true,
        contextHtml: true,
        contextFullPage: true,
      });
      await js(`(() => {
        const secrets = document.createElement("div");
        secrets.hidden = true;
        secrets.textContent = "hidden-context-secret";
        document.body.append(secrets);
        document.querySelector("#freeze-input").value = "input-context-secret";
        document.querySelector("#hover-tooltip").setAttribute("data-secret", "attribute-context-secret");
      })()`);
      await freezeKey();
      await until(
        () => js('!!testRoot.querySelector(".frozen-page")'),
        "hover view frozen",
      );
      expect(await js('document.querySelector("#freeze-input").value')).toBe(
        "input-context-secret",
      );
      expect(await js('testRoot.querySelector(".freeze-status").hidden')).toBe(
        false,
      );
      expect(
        await js(
          'testRoot.querySelector("[data-mode=area]").getAttribute("aria-pressed")',
        ),
      ).toBe("true");
      expect(
        await js('testRoot.querySelector("[data-mode=element]").disabled'),
      ).toBe(true);
      const freezeSource = await js(
        'testRoot.querySelector(".frozen-page").src',
      );
      // Settings and live DOM changes must not rewrite a frozen context snapshot.
      web.configureContext({
        aiContext: false,
        contextHtml: false,
        contextFullPage: false,
      });
      await mouse("mouseMoved", 300, 200);
      expect(
        await js(
          'getComputedStyle(document.querySelector("#hover-tooltip")).display',
        ),
      ).toBe("none");
      await js('document.querySelector("#hover-fixture").remove()');
      await mouse("mousePressed", 22, 82);
      await mouse("mouseMoved", 150, 120);
      await mouse("mouseReleased", 150, 120);
      await frame();
      const frozenDraftId = await js(
        'new URL(testRoot.querySelector("iframe").src).searchParams.get("ui-draft")',
      );
      const frozenEvidence = web.draft(frozenDraftId)!.before;
      expect(frozenEvidence.context).toBeDefined();
      const frozenManifest = await readContext(
        dir,
        ".review",
        frozenEvidence.context!.id,
      );
      const htmlPart = await readContextPart(
        dir,
        ".review",
        frozenEvidence.context!.id,
        "selected-html",
      );
      const html = new TextDecoder().decode(htmlPart!.bytes);
      expect(html).toContain("frozen viewport");
      expect(html).toContain("Hover-only menu");
      expect(html).not.toContain("hidden-context-secret");
      expect(html).not.toContain("input-context-secret");
      expect(html).not.toContain("attribute-context-secret");
      const htmlSnapshot = JSON.parse(html);
      expect(
        htmlSnapshot.nodes.some(
          (node: { selector: string; rect: { width: number } }) =>
            node.selector.includes("hover-tooltip") && node.rect.width > 0,
        ),
      ).toBe(true);
      const documentPart = frozenManifest!.parts.find(
        (part) => part.name === "full-page",
      )!;
      expect(documentPart.status).toBe("available");
      const documentImage = await readAttachment(
        dir,
        ".review",
        documentPart.attachment!,
      );
      const documentPng = Buffer.from(documentImage!.bytes);
      expect(documentPng.readUInt32BE(20)).toBeGreaterThan(
        frozenEvidence.viewport.height * frozenEvidence.viewport.dpr,
      );
      expect(documentImage!.bytes.byteLength).toBeLessThanOrEqual(
        12 * 1024 * 1024,
      );
      expect(frozenEvidence.mode).toBe("area");
      expect(frozenEvidence.rect).toEqual({
        x: 22,
        y: 82,
        width: 128,
        height: 38,
      });
      expect(
        frozenEvidence.selections!.some(
          (s) =>
            s.element?.attributes.id === "hover-tooltip" &&
            s.element.text === "Hover-only menu",
        ),
      ).toBe(true);
      const frozenPage = await readFile(
        path.join(dir, ".review", frozenEvidence.page),
      );
      const frozenArea = await readFile(
        path.join(dir, ".review", frozenEvidence.area),
      );
      expect("data:image/png;base64," + frozenPage.toString("base64")).toBe(
        freezeSource,
      );
      const cropScale =
        frozenPage.readUInt32BE(16) / frozenEvidence.viewport.width;
      expect(frozenArea.readUInt32BE(16)).toBe(Math.round(128 * cropScale));
      expect(frozenArea.readUInt32BE(20)).toBe(Math.round(38 * cropScale));
      expect(
        await js(
          `(async()=>{const image=new Image();image.src=${JSON.stringify("data:image/png;base64," + frozenArea.toString("base64"))};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(canvas.width-2,canvas.height-2,1,1).data]})()`,
        ),
      ).toEqual([255, 0, 0, 255]);
      const updatedFrozen = await web.annotate({
        draftId: frozenDraftId,
        target: {
          kind: "selection",
          index: 0,
          key: webSelectionKey(frozenEvidence),
          expected: "",
        },
        annotation: {
          image: frozenEvidence.area,
          width: frozenArea.readUInt32BE(16),
          height: frozenArea.readUInt32BE(20),
          padding: 0,
          marks: [
            {
              tool: "pen",
              color: "#ff0000",
              width: 1,
              points: [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
              ],
            },
          ],
        },
      });
      expect(updatedFrozen.web.before.context!.id).not.toBe(
        frozenEvidence.context!.id,
      );
      const updatedHtml = await readContextPart(
        dir,
        ".review",
        updatedFrozen.web.before.context!.id,
        "selected-html",
      );
      expect(new TextDecoder().decode(updatedHtml!.bytes)).toBe(html);
      const savedCapture = await readContextPart(
        dir,
        ".review",
        updatedFrozen.web.before.context!.id,
        "capture",
      );
      expect(
        JSON.parse(new TextDecoder().decode(savedCapture!.bytes)).annotation
          .marks,
      ).toHaveLength(1);
      expect(web.draft(frozenDraftId)!.before.context).toEqual(
        updatedFrozen.web.before.context,
      );
      // Resuming never closes or recreates an editor, including its half-written text and caret.
      await writeComment("Keep this frozen hover evidence.");
      await frameJs(
        'window.frozenEditor=document.querySelector("#uiNote textarea");frozenEditor.setSelectionRange(5,9)',
      );
      // The note textarea keeps keyboard focus even when the pointer is over the page.
      await freezeKey();
      await until(
        () => js('!testRoot.querySelector(".frozen-page")'),
        "resume from the focused note editor",
      );
      expect(await js('!!testRoot.querySelector(".frozen-page")')).toBe(false);
      expect(
        await js(
          'testRoot.querySelector("[data-mode=element]").getAttribute("aria-pressed")',
        ),
      ).toBe("true");
      expect(
        await frameJs(
          'document.querySelector("#uiNote textarea")===frozenEditor&&frozenEditor.value==="Keep this frozen hover evidence."&&frozenEditor.selectionStart===5&&frozenEditor.selectionEnd===9',
        ),
      ).toBe(true);
      // Freeze works from the editor too; Escape restores the mode without discarding the draft.
      await freezeKey();
      await until(
        () => js('!!testRoot.querySelector(".frozen-page")'),
        "freeze with a draft",
      );
      await click('[data-mode="point"]');
      await js(
        'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
      );
      expect(await js('!!testRoot.querySelector(".frozen-page")')).toBe(false);
      expect(
        await frameJs(
          'document.querySelector("#uiNote textarea")===frozenEditor&&frozenEditor.value==="Keep this frozen hover evidence."',
        ),
      ).toBe(true);
      await freezeKey();
      await until(
        () => js('!!testRoot.querySelector(".frozen-page")'),
        "freeze before resize",
      );
      await js('dispatchEvent(new Event("resize"))');
      expect(await js('!!testRoot.querySelector(".frozen-page")')).toBe(false);
      await click("[data-close]");
      await until(
        async () => !web.draft(frozenDraftId),
        "frozen draft discarded",
      );
      web.configureContext({
        aiContext: true,
        contextHtml: false,
        contextFullPage: false,
      });
      await mouse("mouseMoved", box.x, box.y);
      await mouse("mousePressed", box.x, box.y);
      await mouse("mouseReleased", box.x, box.y);
      await frame();
      const optionalDraftId = await js(
        'new URL(testRoot.querySelector("iframe").src).searchParams.get("ui-draft")',
      );
      const optionalCapture = web.draft(optionalDraftId)!.before;
      expect(optionalCapture.context).toBeDefined();
      const optionalManifest = await readContext(
        dir,
        ".review",
        optionalCapture.context!.id,
      );
      expect(
        optionalManifest!.parts.find((part) => part.name === "selected-html")!
          .status,
      ).toBe("excluded");
      expect(
        optionalManifest!.parts.find((part) => part.name === "full-page")!
          .status,
      ).toBe("excluded");
      web.configureContext({
        aiContext: true,
        contextHtml: true,
        contextFullPage: false,
      });
      const prepared = await js(
        `globalThis[testRoot.host.id].prepare(${JSON.stringify(optionalCapture)})`,
      );
      const selectedHtml = JSON.parse(prepared.contextHtml.data);
      expect(
        selectedHtml.nodes.some(
          (node: { html: string; selector: string }) =>
            node.selector.includes("save") &&
            node.html.includes("Save changes"),
        ),
      ).toBe(true);
      await js(
        `(()=>{scrollTo({left:${optionalCapture.scroll.x},top:${optionalCapture.scroll.y},behavior:"instant"});const {promise,resolve}=Promise.withResolvers();requestAnimationFrame(()=>requestAnimationFrame(resolve));return promise})()`,
      );
      await click("[data-close]");
      await until(
        async () => !web.draft(optionalDraftId),
        "optional context draft discarded",
      );
      web.configureContext({
        aiContext: false,
        contextHtml: false,
        contextFullPage: false,
      });
      await js("window.clicks=0");
      // Alt uses the app normally; an unmodified click annotates without expanding the launcher.
      await mouse("mousePressed", box.x, box.y, 1);
      await mouse("mouseReleased", box.x, box.y, 1);
      expect(await js("window.clicks")).toBe(1);
      await mouse("mouseMoved", box.x, box.y);
      await mouse("mousePressed", box.x, box.y);
      expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
      await mouse("mouseMoved", box.x + 2, box.y + 1);
      await mouse("mouseReleased", box.x + 2, box.y + 1);
      await frame();
      expect(await js("window.clicks")).toBe(1);
      expect(await frameJs('!!document.querySelector("#uiNote .attb")')).toBe(
        true,
      );
      // Drawing is a proposal beside immutable captured pixels, not a replacement screenshot.
      const drawingDraft = await js(
        'new URL(testRoot.querySelector("iframe").src).searchParams.get("ui-draft")',
      );
      const originalDrawingCapture = web.draft(drawingDraft)!.before;
      await frameJs(
        'window.drawingTextarea=document.querySelector("#uiNote textarea");drawingTextarea.value="Keep this text and selection while drawing.";drawingTextarea.dispatchEvent(new Event("input",{bubbles:true}));drawingTextarea.setSelectionRange(5,9);document.querySelector("#uiNote button[data-web-annotate]").click()',
      );
      await until(
        () =>
          frameJs(
            '!!document.querySelector("[data-annotation-editor] canvas")&&!document.querySelector("[data-command=apply]").disabled',
          ),
        "drawing editor loads original PNG",
      );
      await frameJs('document.querySelector("[data-tool=rectangle]").click()');
      const drawingBounds = await frameJs(
        '(()=>{const r=document.querySelector("[data-annotation-editor] canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()',
      );
      const drawingFrame = await js(
        '(()=>{const r=testRoot.querySelector("iframe").getBoundingClientRect();return {x:r.x,y:r.y}})()',
      );
      const drawX =
        drawingFrame.x + drawingBounds.x + drawingBounds.width * 0.3;
      const drawY =
        drawingFrame.y + drawingBounds.y + drawingBounds.height * 0.3;
      await mouse("mouseMoved", drawX, drawY);
      await mouse("mousePressed", drawX, drawY);
      await mouse(
        "mouseMoved",
        drawX + drawingBounds.width * 0.3,
        drawY + drawingBounds.height * 0.3,
      );
      await mouse(
        "mouseReleased",
        drawX + drawingBounds.width * 0.3,
        drawY + drawingBounds.height * 0.3,
      );
      expect(
        await frameJs('document.querySelector("[data-command=undo]").disabled'),
      ).toBe(false);
      await frameJs('document.querySelector("[data-command=undo]").click()');
      expect(
        await frameJs(
          'document.querySelectorAll("[data-field=mark] option").length',
        ),
      ).toBe(1);
      await frameJs('document.querySelector("[data-command=redo]").click()');
      expect(
        await frameJs(
          'document.querySelectorAll("[data-field=mark] option").length',
        ),
      ).toBe(2);
      await frameJs('document.querySelector("[data-command=apply]").click()');
      await until(
        () => frameJs('!document.querySelector("[data-annotation-editor]")'),
        "drawing saves and returns to the same note editor",
      );
      const annotatedDraft = web.draft(drawingDraft)!;
      const proposal = annotatedDraft.before.annotation!;
      expect(proposal.marks).toHaveLength(1);
      expect(proposal.marks[0]!.tool).toBe("rectangle");
      expect({ ...annotatedDraft.before, annotation: undefined }).toEqual({
        ...originalDrawingCapture,
        annotation: undefined,
      });
      const proposalBytes = await readAttachment(
        dir,
        ".review",
        proposal.image,
      );
      expect(proposalBytes?.type).toBe("image/png");
      const proposalPng = Buffer.from(proposalBytes!.bytes);
      expect(proposalPng.readUInt32BE(16)).toBe(
        proposal.width + 2 * proposal.padding,
      );
      expect(proposalPng.readUInt32BE(20)).toBe(
        proposal.height + 2 * proposal.padding,
      );
      expect(
        await frameJs(
          'document.querySelector("#uiNote textarea")===drawingTextarea',
        ),
      ).toBe(true);
      expect(
        await frameJs(
          "[drawingTextarea.value,drawingTextarea.selectionStart,drawingTextarea.selectionEnd]",
        ),
      ).toEqual(["Keep this text and selection while drawing.", 5, 9]);
      await frameJs(
        'document.querySelector("#uiNote button[data-web-annotate]").click()',
      );
      await until(
        () =>
          frameJs(
            '!!document.querySelector("[data-annotation-editor]")&&!document.querySelector("[data-command=clear]").disabled',
          ),
        "saved drawing reopens for editing",
      );
      await frameJs('document.querySelector("[data-command=clear]").click()');
      acceptingDrawingDiscard = true;
      // Defer in Chrome so its modal dialog cannot block the CDP evaluate response.
      await frameJs(
        'setTimeout(()=>document.querySelector("[data-command=cancel]").click(),0);void 0',
      );
      await until(
        () => frameJs('!document.querySelector("[data-annotation-editor]")'),
        "canceling a changed drawing closes only the drawing editor",
      );
      expect(web.draft(drawingDraft)!.before.annotation).toEqual(proposal);
      await expect(
        web.annotate({
          draftId: drawingDraft,
          target: {
            kind: "selection",
            index: 0,
            key: webSelectionKey(originalDrawingCapture),
            expected: "",
          },
          annotation: null,
        }),
      ).rejects.toThrow("changed");
      expect(web.draft(drawingDraft)!.before.annotation).toEqual(proposal);
      await frameJs('document.querySelector("#uiNote .refb").click()');
      expect(
        await frameJs('document.querySelector("#refpop").textContent'),
      ).toContain("Use the same padding");
      await frameJs('document.querySelector("#refpop .rfitem").click()');
      expect(
        await frameJs('document.querySelector("#uiNote textarea").value'),
      ).toContain("#" + diffRef);
      expect(
        await frameJs(
          'document.querySelectorAll("#uiNote .nedit .cancel").length',
        ),
      ).toBe(0);
      await writeComment("Keep this draft while moving and adding targets.");
      await frameJs(
        'window.movingDraft=document.querySelector("#uiNote textarea");movingDraft.setSelectionRange(5,9)',
      );
      await until(
        () =>
          js(
            '!testRoot.querySelector(".dock").classList.contains("annotating")',
          ),
        "note panel restored after drawing",
      );
      const dockBefore = await js(
        '(()=>{const r=testRoot.querySelector(".dock").getBoundingClientRect();return {x:r.x,y:r.y,targetX:innerWidth-r.width-24,targetY:24}})()',
      );
      await mouse("mousePressed", dockBefore.x + 100, dockBefore.y + 20);
      await mouse(
        "mouseMoved",
        dockBefore.targetX + 100,
        dockBefore.targetY + 20,
      );
      await mouse(
        "mouseReleased",
        dockBefore.targetX + 100,
        dockBefore.targetY + 20,
      );
      expect(
        await js('testRoot.querySelector(".dock").getBoundingClientRect().x'),
      ).toBeCloseTo(dockBefore.targetX);
      expect(
        await js('testRoot.querySelector(".dock").getBoundingClientRect().y'),
      ).toBeCloseTo(dockBefore.targetY);
      const editorViewport = await frameJs("[innerWidth,innerHeight]");
      await click("[data-minimize]");
      expect(
        await js(
          'testRoot.querySelector(".content").checkVisibility({checkVisibilityCSS:true})',
        ),
      ).toBe(false);
      expect(await frameJs("[innerWidth,innerHeight]")).toEqual(editorViewport);
      const extraHeading = await js(
        '(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {x:r.x+60,y:r.y+10}})()',
      );
      await js(
        "(()=>{const api=globalThis[testRoot.host.id],original=api.visible;api.visible=async value=>{if(!value)await new Promise(resolve=>window.releaseCapture=resolve);return original(value)};window.restoreCapture=()=>{api.visible=original;window.releaseCapture()}})()",
      );
      await mouse("mousePressed", extraHeading.x, extraHeading.y);
      await mouse("mouseReleased", extraHeading.x, extraHeading.y);
      await until(
        () =>
          frameJs(
            'document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "capture blocks save",
      );
      await frameJs(
        'movingDraft.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true,cancelable:true}))',
      );
      expect((await session.read()).notes.filter((n) => n.web)).toHaveLength(0);
      await js("window.restoreCapture()");
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===2',
          ),
        "selection appended to minimized draft",
      );
      expect(
        await js(
          'testRoot.querySelector(".dock").classList.contains("minimized")',
        ),
      ).toBe(true);
      await click("[data-minimize]");
      expect(
        await frameJs(
          'document.querySelector("#uiNote textarea")===window.movingDraft',
        ),
      ).toBe(true);
      expect(await frameJs("window.movingDraft.value")).toBe(
        "Keep this draft while moving and adding targets.",
      );
      expect(
        await frameJs("[movingDraft.selectionStart,movingDraft.selectionEnd]"),
      ).toEqual([5, 9]);
      await frameJs(
        'document.querySelector("#uiNote [data-web-remove=\\"1\\"]").click()',
      );
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===1&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "draft selection removed",
      );
      expect(
        await frameJs(
          'document.querySelector("#uiNote textarea")===window.movingDraft',
        ),
      ).toBe(true);
      expect(
        await frameJs("[movingDraft.selectionStart,movingDraft.selectionEnd]"),
      ).toEqual([5, 9]);
      await mouse("mousePressed", extraHeading.x, extraHeading.y);
      await mouse("mouseReleased", extraHeading.x, extraHeading.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===2&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "draft selection added again",
      );
      await frameJs(
        'document.querySelector("#uiNote [data-web-remove=\\"0\\"]").click()',
      );
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===1&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "next draft selection promoted",
      );
      const liveDraft = await js(
        'new URL(testRoot.querySelector("iframe").src).searchParams.get("ui-draft")',
      );
      expect(
        (
          await (
            await fetch(reviewUrl + "/api/web/draft?id=" + liveDraft)
          ).json()
        ).web.before.element.tag,
      ).toBe("h1");
      await frameJs(
        'document.querySelector("#uiNote [data-web-remove=\\"0\\"]").click()',
      );
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===0&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "draft can have no captures",
      );
      const emptyDraft = await fetch(
        reviewUrl + "/api/web/draft?id=" + liveDraft,
      );
      expect(emptyDraft.status).toBe(200);
      expect((await emptyDraft.json()).web).toBeNull();
      expect(await frameJs("movingDraft.value")).toBe(
        "Keep this draft while moving and adding targets.",
      );
      expect(
        await frameJs(
          'document.querySelectorAll("#uiNote .nedit .cancel").length',
        ),
      ).toBe(0);
      await mouse("mousePressed", box.x, box.y);
      await mouse("mouseReleased", box.x, box.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===1&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "empty draft accepts new capture",
      );
      await mouse("mousePressed", extraHeading.x, extraHeading.y);
      await mouse("mouseReleased", extraHeading.x, extraHeading.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===2&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "restored draft accepts another capture",
      );
      await saveFrame(
        "Give the save button more breathing room. See #" + diffRef,
        "modified",
      );
      const note = (await session.read()).notes.find((n) => n.web)!;
      expect(note.web!.before.mode).toBe("element");
      expect(note.web!.before.components.map((c) => c.name)).toEqual([
        "WorkspaceSettings",
        "SettingsCard",
      ]);
      expect(note.web!.before.element!.attributes["data-testid"]).toBe("save");
      expect(note.web!.before.element!.styles["background-color"]).toBe(
        "rgb(113, 78, 217)",
      );
      expect(note.web!.additional![0]!.element!.tag).toBe("h1");
      const page = await readFile(
          path.join(dir, ".review", note.web!.before.page),
        ),
        area = await readFile(path.join(dir, ".review", note.web!.before.area));
      const scale = page.readUInt32BE(16) / note.web!.before.viewport.width;
      expect(note.web!.before.viewport.dpr).toBe(2);
      expect(page.readUInt32BE(20)).toBe(
        note.web!.before.viewport.height * scale,
      );
      expect(
        Math.abs(area.readUInt32BE(16) - box.width * scale),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(area.readUInt32BE(20) - box.height * scale),
      ).toBeLessThanOrEqual(2);
      expect(delivered).toBe(0);
      await until(
        () => reviewJs('!!document.querySelector(".web-capture")'),
        "visual note next to diff",
      );
      expect(
        await reviewJs('document.querySelector(".nref").dataset.nref'),
      ).toBe(diffNote.id);
      // References work in the other direction, including the visual capture in the shared preview.
      const visualRef = note.id.split("|#").at(-1)!;
      await web.review(diffNote.id).catch((error) => {
        throw new Error(
          "Review navigation: " + String(error) + "; " + errors.join("\n"),
        );
      });
      await until(
        () =>
          reviewJs(
            `[...document.querySelectorAll('.nrow')].some(r=>r.dataset.nid===${JSON.stringify(diffNote.id)})`,
          ),
        "reference target mounted in diff",
      );
      await reviewJs(
        `(()=>{const row=[...document.querySelectorAll('.nrow')].find(r=>r.dataset.nid===${JSON.stringify(diffNote.id)});row.querySelector('.edit').click();row.querySelector('textarea').value='Match the visual result in #${visualRef}';row.querySelector('[data-save-note]').click();})()`,
      );
      await until(
        () => reviewJs('!!document.querySelector(".refpreview .web-capture")'),
        "visual reference preview in diff comment",
      );
      await cdp.send("Target.activateTarget", { targetId: appTarget.targetId });
      // The page conversation is the same component, with real reply/edit/image/ref controls.
      await until(() => js('!!testRoot.querySelector(".pin")'), "saved pin");
      await click(".pin");
      await frame();
      const submittedTarget = await js(
        '(()=>{const r=document.querySelector("h2").getBoundingClientRect();return {x:r.x+60,y:r.y+10}})()',
      );
      await mouse("mousePressed", submittedTarget.x, submittedTarget.y);
      await mouse("mouseReleased", submittedTarget.x, submittedTarget.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote [data-reply-evidence] .web-observation").length===1',
          ),
        "saved original routes new page selection to follow-up",
      );
      expect(
        (await session.read()).notes.find((n) => n.id === note.id)!.web,
      ).toEqual(note.web);
      await frameJs(
        'document.querySelector("#uiNote [data-reply-evidence] [data-web-remove=\\"0\\"]").click()',
      );
      await until(
        () =>
          frameJs(
            '!document.querySelector("#uiNote .reply").hasAttribute("data-evidence")&&!document.querySelector("#uiNote .reply [data-reply-save]").disabled',
          ),
        "empty follow-up retains original captures",
      );
      await session.answer(
        session.file,
        note.id,
        "Updated the button padding.",
        "applied",
      );
      hub.emit({ type: "review", file: session.file });
      await until(
        () =>
          frameJs(
            'document.querySelector("#uiNote").textContent.includes("Updated the button padding.")',
          ),
        "live agent reply",
      );
      await writeComment("Keep the rounded corners too.");
      await frameJs(
        'document.querySelector("#uiNote [data-reply-save]").click()',
      );
      await until(
        async () =>
          (await session.read()).notes.find((n) => n.id === note.id)!.messages
            .length === 2,
        "shared follow-up",
      );
      await until(
        () =>
          frameJs(
            'document.querySelector("#uiNote .reply textarea").value===""&&document.querySelector("#uiNote .thread").textContent.includes("Keep the rounded corners too.")',
          ),
        "reply response adopted with an empty persistent composer",
      );
      expect(await frameJs('!!document.querySelector("#uiNote .edit")')).toBe(
        false,
      );
      expect(
        await frameJs('!!document.querySelector("#uiNote .msg.r .rewrite")'),
      ).toBe(true);
      const originalEvidence = structuredClone(note.web);
      await writeComment("Compare these new selections.");
      await frameJs(
        'window.editedBox=document.querySelector("#uiNote .reply textarea");editedBox.setSelectionRange(3,7)',
      );
      const extraSubheading = await js(
        '(()=>{const r=document.querySelector("h2").getBoundingClientRect();return {x:r.x+60,y:r.y+10}})()',
      );
      await mouse("mousePressed", extraSubheading.x, extraSubheading.y);
      await mouse("mouseReleased", extraSubheading.x, extraSubheading.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote [data-reply-evidence] .web-observation").length===1',
          ),
        "answered note selection belongs to the next reply",
      );
      const followup = web.replyDraft(note.id);
      expect(followup.web!.before.element!.tag).toBe("h2");
      expect(
        (await session.read()).notes.find((n) => n.id === note.id)!.web,
      ).toEqual(originalEvidence);
      await mouse("mousePressed", extraHeading.x, extraHeading.y);
      await mouse("mouseReleased", extraHeading.x, extraHeading.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote [data-reply-evidence] .web-observation").length===2',
          ),
        "next reply collects its own additional selection",
      );
      await frameJs(
        'document.querySelector("#uiNote [data-reply-evidence] [data-web-remove=\\"0\\"]").click()',
      );
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote [data-reply-evidence] .web-observation").length===1&&!document.querySelector("#uiNote .reply [data-reply-save]").disabled',
          ),
        "reply selection removed without changing original evidence",
      );
      expect(web.replyDraft(note.id).web!.before.element!.tag).toBe("h1");
      expect(
        await frameJs(
          'document.querySelector("#uiNote .reply textarea")===window.editedBox',
        ),
      ).toBe(true);
      expect(
        await frameJs("[editedBox.selectionStart,editedBox.selectionEnd]"),
      ).toEqual([3, 7]);
      expect(
        (await session.read()).notes.find((n) => n.id === note.id)!.web,
      ).toEqual(originalEvidence);
      await frameJs(
        "editedBox.setSelectionRange(editedBox.value.length,editedBox.value.length)",
      );
      // Pasted images are attachments on this follow-up, not edits to the opening note.
      await frameJs(
        `(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(area.toString("base64"))}),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'screenshot.png',{type:'image/png'}));editedBox.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));})()`,
      );
      await until(
        () =>
          frameJs(
            'document.querySelector("#uiNote .reply textarea").value.includes("images/")',
          ),
        "pasted screenshot attaches to follow-up",
      );
      await frameJs(
        'document.querySelector("#uiNote .reply [data-ask-note]").click()',
      );
      await until(
        () =>
          frameJs(
            'document.querySelector("#uiNote .reply textarea").value===""&&!document.querySelector("#uiNote .reply").hasAttribute("data-evidence")',
          ),
        "follow-up submitted and composer cleared",
      );
      const answered = (await session.read()).notes.find(
        (n) => n.id === note.id,
      )!;
      expect(answered.body).toBe(note.body);
      expect(answered.web).toEqual(originalEvidence);
      expect(answered.messages.at(-1)!.body).toContain(
        "Compare these new selections.",
      );
      expect(answered.messages.at(-1)!.body).toContain("images/");
      expect(answered.messages.at(-1)!.body).toContain("h1");
      expect(web.draft(followup.draftId!)).toBeUndefined();
      expect(delivered).toBe(1);
      expect(
        await readFile(path.join(dir, ".review", note.web!.before.area)),
      ).toEqual(area);
      expect(
        await frameJs('!!document.querySelector("#uiNote .shot img")'),
      ).toBe(true);
      // Full conversation and reference links focus the existing tab instead of creating one.
      const pagesBefore = (await targets()).filter(
        (t) => t.type === "page",
      ).length;
      await click(".head [data-panel-review]");
      await until(
        () =>
          reviewJs("location.hash===" + JSON.stringify("#note=" + visualRef)),
        "existing review note link",
      );
      expect((await targets()).filter((t) => t.type === "page")).toHaveLength(
        pagesBefore,
      );
      await click(".head [data-panel-review]");
      expect((await targets()).filter((t) => t.type === "page")).toHaveLength(
        pagesBefore,
      );
      await cdp.send("Target.activateTarget", { targetId: appTarget.targetId });
      await click("[data-close]");
      await js(
        'document.querySelector("#save").style.padding="16px 60px";document.querySelector("#save").style.background="#227d62"',
      );
      const comparison = await web.captureAfter(note.id).catch((error) => {
        throw new Error(
          "Comparison capture: " + String(error) + "; " + errors.join("\n"),
        );
      });
      expect(comparison.reply).toBe(true);
      expect(comparison.web.before.rect.width).toBeGreaterThan(
        note.web!.before.rect.width,
      );
      expect(
        (await session.read()).notes.find((n) => n.id === note.id)!.web,
      ).toEqual(note.web);
      await web.discardDraft(comparison.draftId);
      // A new drag defaults to Area without opening the circle or preselecting Area.
      await js(`(()=>{
      const region=document.createElement('div');region.id='area-fixture';
      region.innerHTML='<div id="area-obscured" style="position:fixed;left:210px;top:230px;width:120px;height:100px;background:red;z-index:1"></div>'+
        '<section id="area-panel" style="position:fixed;left:210px;top:230px;width:120px;height:100px;background:white;z-index:2">'+
        '<button id="area-target" style="margin:10px;padding:4px">Area action</button><span id="area-hidden" style="visibility:hidden">Hidden</span></section>'+
        '<button id="area-outside" style="position:fixed;left:600px;top:230px">Outside</button>';
      document.body.append(region);
      document.querySelector('#area-panel')['__reactFiber$fixture']={type:{name:'AreaPanel'},_debugSource:{fileName:'src/AreaPanel.tsx',lineNumber:8},return:null};
    })()`);
      await mouse("mousePressed", 200, 220);
      await mouse("mouseMoved", 430, 350);
      await mouse("mouseReleased", 430, 350);
      await frame();
      await js(
        'window.testDirty=false;window.addEventListener("message",event=>{if(event.data?.type==="lcr:ui"&&event.data.action==="dirty"&&event.data.dirty)window.testDirty=true;})',
      );
      await writeComment("Keep this unfinished draft.");
      await js("window.confirm=()=>false");
      // A live settings change reaches an existing dirty embedded draft without replacing its editor.
      await frameJs(
        'window.draftBox=document.querySelector("#uiNote textarea");draftBox.setSelectionRange(5,5)',
      );
      await reviewJs(
        'document.querySelector("#cfgEnter").checked=true;document.querySelector("#cfgEnter").dispatchEvent(new Event("change",{bubbles:true}))',
      );
      await until(
        () => frameJs('document.querySelector("#cfgEnter").checked'),
        "save setting reaches active embedded editor",
      );
      expect(
        await frameJs(
          'document.querySelector("#uiNote textarea")===window.draftBox',
        ),
      ).toBe(true);
      expect(await frameJs("window.draftBox.value")).toBe(
        "Keep this unfinished draft.",
      );
      expect(await frameJs("window.draftBox.selectionStart")).toBe(5);
      await until(
        () => js("window.testDirty"),
        "cross-origin dirty notification",
      );
      const discarded = await js(
        'new URL(testRoot.querySelector("iframe").src).searchParams.get("ui-draft")',
      );
      const discardedWeb = (
        await (await fetch(reviewUrl + "/api/web/draft?id=" + discarded)).json()
      ).web;
      const discardedBytes = await readFile(
        path.join(dir, ".review", discardedWeb.before.area),
      );
      await click("[data-close]");
      expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
      await until(
        async () =>
          (await fetch(reviewUrl + "/api/web/draft?id=" + discarded)).status ===
          404,
        "closed draft invalidated",
      );
      expect(
        await readFile(path.join(dir, ".review", discardedWeb.before.area)),
      ).toEqual(discardedBytes);
      expect((await session.read()).notes.filter((n) => n.web)).toHaveLength(1);
      await mouse("mousePressed", 200, 220);
      await mouse("mouseMoved", 430, 350);
      await mouse("mouseReleased", 430, 350);
      await frame();
      await saveFrame("Align this section with the heading.", "plain");
      const areaNote = (await session.read()).notes
        .filter((n) => n.web)
        .at(-1)!;
      expect(areaNote.web!.before.mode).toBe("area");
      expect(areaNote.web!.before.rect).toEqual({
        x: 200,
        y: 220,
        width: 230,
        height: 130,
      });
      expect(
        areaNote.web!.before.selections!.some(
          (s) => s.selector === "button#area-target",
        ),
      ).toBe(true);
      expect(areaNote.web!.before.components.map((c) => c.name)).toContain(
        "AreaPanel",
      );
      expect(
        areaNote.web!.before.components.find((c) => c.name === "AreaPanel")!
          .file,
      ).toBe("src/AreaPanel.tsx");
      expect(
        areaNote.web!.before.selections!.some((s) =>
          /area-(hidden|outside|obscured)|__lcr_/.test(s.selector || ""),
        ),
      ).toBe(false);
      await until(
        () =>
          js(
            'testRoot.querySelectorAll(".pin[title=\\"Align this section with the heading.\\"]").length===1',
          ),
        "area evidence keeps one region pin",
      );
      await js('history.pushState({},"","/other-view")');
      await until(
        () => js('testRoot.querySelectorAll(".pin").length===0'),
        "notes never cross page URLs",
      );
      await js('history.replaceState({},"","/")');
      await until(
        () =>
          js(
            '[...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")',
          ),
        "area circle returns on its own page",
      );
      // Area circles move with matched contents, not with the old screenshot coordinates.
      await js(
        'document.querySelector("#area-panel").style.left="270px";document.querySelector("#area-panel").style.top="245px"',
      );
      await until(
        () =>
          js(
            '(()=>{const p=[...testRoot.querySelectorAll(".pin")].find(p=>p.title==="Align this section with the heading.");return p&&Math.abs(p.getBoundingClientRect().left-260)<1})()',
          ),
        "area circle follows its DOM anchors",
      );
      await js(
        '(()=>{const clone=document.querySelector("#area-panel").cloneNode(true);clone.dataset.duplicate="";document.body.append(clone)})()',
      );
      await until(
        () =>
          js(
            '![...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")',
          ),
        "ambiguous area selectors suppress circle",
      );
      await js('document.querySelector("[data-duplicate]").remove()');
      await until(
        () =>
          js(
            '[...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")',
          ),
        "unique area anchors restore circle",
      );
      const areaComparison = await web.captureAfter(areaNote.id);
      const areaAfter = areaComparison.web.before;
      expect(
        (await session.read()).notes.find((n) => n.id === areaNote.id)!.web!
          .after,
      ).toEqual([]);
      expect(areaAfter.rect).toEqual({
        ...areaNote.web!.before.rect,
        x: 260,
        y: 235,
      });
      expect(
        areaAfter.selections!.some((s) => s.selector === "button#area-target"),
      ).toBe(true);
      await web.discardDraft(areaComparison.draftId);
      await js(
        'document.querySelector("#area-target").outerHTML="<button id=\\"area-replacement\\">New action</button>"',
      );
      await until(
        () =>
          js(
            '![...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")',
          ),
        "changed area content suppresses stale circle",
      );
      await expect(web.captureAfter(areaNote.id)).rejects.toThrow(
        "cannot be matched",
      );
      // Reload restores pins and the launcher location, not the requirement to expand tools.
      const navigated = Promise.withResolvers<void>();
      const offNavigation = cdp.on("Page.frameNavigated", (event, eventSid) => {
        if (eventSid === sid && !event.frame.parentId) {
          offNavigation();
          navigated.resolve();
        }
      });
      version = 2;
      await send("Page.reload");
      await navigated.promise;
      await root();
      await until(
        () =>
          js(
            'testRoot.querySelectorAll(".pin").length===2&&![...testRoot.querySelectorAll(".pin")].some(pin=>pin.title==="Align this section with the heading.")',
          ),
        "only original button and heading pins restored; follow-up selections and stale area stay hidden",
      );
      expect(
        await js(
          'testRoot.querySelector("[data-launcher]").getBoundingClientRect().x',
        ),
      ).toBeCloseTo(moved);
      const imagesBeforePoint = await readdir(path.join(dir, ".review/images"));
      await pressLauncher(true);
      await click('[data-mode="point"]');
      await mouse("mousePressed", 240, 170);
      await mouse("mouseReleased", 240, 170);
      await frame();
      expect(await frameJs('document.querySelector("#cfgEnter").checked')).toBe(
        true,
      );
      expect(
        await frameJs(
          'document.querySelectorAll("#uiNote [data-web-evidence] img").length',
        ),
      ).toBe(0);
      await saveFrame("Add space at this location.", "plain");
      expect(
        (await session.read()).notes.filter((n) => n.web).at(-1)!.web!.before
          .rect,
      ).toEqual({ x: 192, y: 122, width: 96, height: 96 });
      const pointCapture = (await session.read()).notes
        .filter((n) => n.web)
        .at(-1)!.web!.before;
      expect(pointCapture.mode).toBe("point");
      expect(pointCapture.page).toBeUndefined();
      expect(pointCapture.area).toBeUndefined();
      expect(pointCapture.element?.tag).toBe("h1");
      expect(await readdir(path.join(dir, ".review/images"))).toEqual(
        imagesBeforePoint,
      );
      await pressLauncher(true);
      await click('[data-mode="block"]');
      await mouse("mouseMoved", box.x + 40, box.y);
      await mouse("mousePressed", box.x + 40, box.y);
      await mouse("mouseReleased", box.x + 40, box.y);
      await frame();
      await saveFrame("Group these settings.");
      expect(
        (await session.read()).notes.filter((n) => n.web).at(-1)!.web!.before
          .element!.tag,
      ).toBe("section");
      await pressLauncher(true);
      await click('[data-mode="element"]');
      // Pins follow the element offscreen rather than sticking to the viewport edge.
      await js(
        'scrollBy(0,document.querySelector("#save").getBoundingClientRect().top+10)',
      );
      await until(
        () =>
          js(
            '(()=>{const p=[...testRoot.querySelectorAll(".pin")].find(p=>p.title.includes("Give the save button"));return p&&p.getBoundingClientRect().top<0})()',
          ),
        "partly visible element pin scrolls past viewport edge",
      );
      await js("scrollTo(0,0)");
      // Shift-click collects/toggles elements without opening an editor.
      const heading = await js(
        '(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {x:r.x+100,y:r.y+30}})()',
      );
      const currentSave = await js(
        '(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
      );
      await mouse("mousePressed", heading.x, heading.y, 8);
      await mouse("mouseReleased", heading.x, heading.y, 8);
      await mouse("mousePressed", currentSave.x, currentSave.y, 8);
      await mouse("mouseReleased", currentSave.x, currentSave.y, 8);
      expect(await js('testRoot.querySelectorAll(".selected").length')).toBe(2);
      expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
      await mouse("mousePressed", heading.x, heading.y, 8);
      await mouse("mouseReleased", heading.x, heading.y, 8);
      expect(await js('testRoot.querySelectorAll(".selected").length')).toBe(1);
      await mouse("mousePressed", heading.x, heading.y, 8);
      await mouse("mouseReleased", heading.x, heading.y, 8);
      await click("[data-write]");
      await frame();
      await saveFrame("Align the heading and save action together.");
      const multi = (await session.read()).notes.filter((n) => n.web).at(-1)!;
      expect(multi.web!.before.selections!.map((s) => s.element!.tag)).toEqual([
        "button",
        "h1",
      ]);
      expect(multi.web!.before.rect.height).toBeGreaterThan(100);
      await until(
        () =>
          js(
            'testRoot.querySelectorAll(".pin[title=\\"Align the heading and save action together.\\"]").length===2',
          ),
        "one pin per selected element",
      );
      const shownPins = await js('testRoot.querySelectorAll(".pin").length');
      await pressLauncher();
      expect(await js('testRoot.querySelectorAll(".pin").length')).toBe(0);
      await js("scrollBy(0,1)");
      await js(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
      expect(await js('testRoot.querySelectorAll(".pin").length')).toBe(0);
      await pressLauncher();
      expect(await js('testRoot.querySelectorAll(".pin").length')).toBe(
        shownPins,
      );
      const multiComparison = await web.captureAfter(multi.id);
      expect(
        multiComparison.web.before.selections!.map(
          (s: { selector?: string }) => s.selector,
        ),
      ).toEqual(multi.web!.before.selections!.map((s) => s.selector));
      expect(
        (await session.read()).notes.find((n) => n.id === multi.id)!.web!.after,
      ).toEqual([]);
      await web.discardDraft(multiComparison.draftId);
      await until(
        () =>
          reviewJs(
            'document.querySelector("#loGlobal").textContent.includes("Align the heading and save action together.")',
          ),
        "multi-element evidence in review",
      );
      await pressLauncher(true);
      await click("[data-multiple]");
      expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
      const multiBox = await js(
        '(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
      );
      await mouse("mousePressed", multiBox.x, multiBox.y);
      await mouse("mouseReleased", multiBox.x, multiBox.y);
      expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
      expect(await js('testRoot.querySelectorAll(".selected").length')).toBe(1);
      await click("[data-clear]");
      await pressLauncher(true);
      await click('[data-mode="element"]');
      await js(
        '[...testRoot.querySelectorAll(".pin")].find(p=>p.title==="Align the heading and save action together.").click()',
      );
      await frame();
      const multiBytes = await readFile(
        path.join(dir, ".review", multi.web!.before.area),
      );
      await frameJs('document.querySelector("#uiNote .edit").click()');
      await frameJs(
        'document.querySelector("#uiNote [data-web-remove=\\"0\\"]").click()',
      );
      await until(
        async () =>
          !(await session.read()).notes.find((n) => n.id === multi.id)!.web,
        "last saved capture removed",
      );
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===0',
          ),
        "cleared note displayed as overall",
      );
      const cleared = (await session.read()).notes.find(
        (n) => n.id === multi.id,
      )!;
      expect(cleared.body).toBe("Align the heading and save action together.");
      expect(cleared.scope).toBe("global");
      expect(
        await readFile(path.join(dir, ".review", multi.web!.before.area)),
      ).toEqual(multiBytes);
      await writeComment(
        "Selection replaced without deleting the conversation.",
      );
      const replacementBox = await js(
        '(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
      );
      await mouse("mousePressed", replacementBox.x, replacementBox.y);
      await mouse("mouseReleased", replacementBox.x, replacementBox.y);
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===1&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "saved overall note accepts new capture",
      );
      await saveFrame("Selection replaced without deleting the conversation.");
      expect(
        (await session.read()).notes.find((n) => n.id === multi.id)!.web!.after,
      ).toEqual([]);
      await js(
        'document.querySelector("#bottom").scrollIntoView({block:"center"})',
      );
      const bottom = await js(
        '(()=>{const r=document.querySelector("#bottom").getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()',
      );
      await mouse("mouseMoved", bottom.x, bottom.y);
      await mouse("mousePressed", bottom.x, bottom.y);
      await mouse("mouseReleased", bottom.x, bottom.y);
      await frame();
      await saveFrame("Review this lower action.");
      expect(
        (await session.read()).notes.filter((n) => n.web).at(-1)!.web!.before
          .scroll.y,
      ).toBeGreaterThan(0);
      const removed = (await session.read()).notes.filter((n) => n.web).at(-1)!;
      await until(
        () =>
          reviewJs(
            `[...document.querySelectorAll('#loGlobal .nrow')].some(row=>row.dataset.nid===${JSON.stringify(removed.id)})`,
          ),
        "visual note adopted before external deletion",
      );
      await fetch(
        reviewUrl + "/api/note?id=" + encodeURIComponent(removed.id),
        { method: "DELETE" },
      );
      await until(
        () =>
          reviewJs(
            `[...document.querySelectorAll('#loGlobal .nrow')].every(row=>row.dataset.nid!==${JSON.stringify(removed.id)})`,
          ),
        "deletion adopted across tabs",
      );
      await js("scrollTo(0,0)");
      const bareBox = await js(
        '(()=>{const r=document.querySelector("h2").getBoundingClientRect();return {x:r.x+100,y:r.y+10}})()',
      );
      await mouse("mousePressed", bareBox.x, bareBox.y);
      await mouse("mouseReleased", bareBox.x, bareBox.y);
      await frame();
      const bareId = await frameJs(
        'document.querySelector("#uiNote .nrow").dataset.nid',
      );
      await frameJs(
        'document.querySelector("#uiNote [data-web-remove=\\"0\\"]").click()',
      );
      await until(
        () =>
          frameJs(
            'document.querySelectorAll("#uiNote .web-observation").length===0&&!document.querySelector("#uiNote [data-save-note]").disabled',
          ),
        "new note can be saved without captures",
      );
      await saveFrame("Keep this as an overall observation.");
      const bare = (await session.read()).notes.find((n) => n.id === bareId)!;
      expect(bare.web).toBeUndefined();
      expect(bare.body).toBe("Keep this as an overall observation.");
      await send("Page.captureScreenshot", { format: "png" }).then((r) =>
        Bun.write(
          "/tmp/lcr-web-overlay-smoke.png",
          Buffer.from(r.data, "base64"),
        ),
      );
      await cdp
        .send("Page.captureScreenshot", { format: "png" }, reviewSid)
        .then((r) =>
          Bun.write(
            "/tmp/lcr-web-review-smoke.png",
            Buffer.from(r.data, "base64"),
          ),
        );
      await cdp.send("Target.closeTarget", { targetId: appTarget.targetId });
      await until(
        async () => web.status().state === "closed",
        "reviewed tab close notification",
      );
      await web.open();
      appTarget = (await targets()).find((t) => t.url === web.status().url)!;
      sid = (
        await cdp.send("Target.attachToTarget", {
          targetId: appTarget.targetId,
          flatten: true,
        })
      ).sessionId;
      await root();
      expect(
        (await targets()).filter(
          (t) => t.type === "page" && t.url.startsWith(reviewUrl),
        ),
      ).toHaveLength(1);
      expect((await session.read()).notes.filter((n) => n.web)).toHaveLength(5);
      expect(errors).toEqual([]);
      // History is read-only navigation over the same page, even above a dirty note editor.
      const beforeHistory = (await session.read()).notes;
      await reviewJs(`location.hash=${JSON.stringify("#note=" + diffRef)}`);
      await until(
        () =>
          reviewJs(
            `[...document.querySelectorAll('.nrow')].some(row=>row.dataset.nid===${JSON.stringify(diffNote.id)}&&row.querySelector('.edit'))`,
          ),
        "diff note is mounted before opening its editor",
      );
      await reviewJs(
        `(()=>{const row=[...document.querySelectorAll('.nrow')].find(row=>row.dataset.nid===${JSON.stringify(diffNote.id)});row.querySelector('.edit').click();window.historyDraft=row.querySelector('textarea');historyDraft.value='Unsent text must survive history navigation';historyDraft.dispatchEvent(new Event('input',{bubbles:true}));historyDraft.setSelectionRange(4,11);historyDraft.focus();})()`,
      );
      const historyDepth = await reviewJs("history.length");
      await reviewJs('document.querySelector("#showHistory").click()');
      await until(
        () =>
          reviewJs(
            '!document.querySelector("#historyPanel").hidden&&!!document.querySelector("#historyList [data-revision]")',
          ),
        "persisted browser history opens",
      );
      expect(await reviewJs("history.length")).toBe(historyDepth + 1);
      await reviewJs(
        '(()=>{const search=document.querySelector("#historySearch");search.value="Match the visual result";search.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#historyMode").click();})()',
      );
      await until(
        () =>
          reviewJs(
            'document.querySelector("#historyDetail").textContent.includes("Match the visual result")',
          ),
        "history snapshot contains the saved note rather than the open draft",
      );
      expect(
        await reviewJs(
          'document.querySelector("#historyDetail").textContent.includes(historyDraft.value)',
        ),
      ).toBe(false);
      expect(
        await reviewJs(
          'document.querySelector("#historyDetail textarea,[contenteditable=true]")===null',
        ),
      ).toBe(true);
      expect(await reviewJs("history.length")).toBe(historyDepth + 1);
      await reviewJs("history.back()");
      await until(
        () => reviewJs('document.querySelector("#historyPanel").hidden'),
        "Back closes history without closing the note editor",
      );
      expect(
        await reviewJs(
          "historyDraft.isConnected&&document.activeElement===historyDraft",
        ),
      ).toBe(true);
      expect(
        await reviewJs(
          "[historyDraft.value,historyDraft.selectionStart,historyDraft.selectionEnd]",
        ),
      ).toEqual(["Unsent text must survive history navigation", 4, 11]);
      await reviewJs("history.forward()");
      await until(
        () =>
          reviewJs(
            '!document.querySelector("#historyPanel").hidden&&document.querySelector("#historySearch").value==="Match the visual result"',
          ),
        "Forward restores the selected history view",
      );
      await reviewJs(
        'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
      );
      await until(
        () => reviewJs('document.querySelector("#historyPanel").hidden'),
        "Escape closes only the history overlay",
      );
      expect(
        await reviewJs("historyDraft.isConnected&&historyDraft.value"),
      ).toBe("Unsent text must survive history navigation");
      await reviewJs(
        'historyDraft.closest(".nbox").querySelector(".cancel").click()',
      );
      expect((await session.read()).notes).toEqual(beforeHistory);
      // Losing the whole browser process must reconnect to a fresh profile connection,
      // not retain dead target/session IDs from the previous instance.
      const persistedBeforeRestart = (await session.read()).notes;
      await cdp.send("Browser.close").catch(() => {});
      await until(
        async () => web.status().state === "closed",
        "browser process exit notification",
      );
      cdp.close();
      await Promise.all([web.open(), web.open()]);
      expect(web.status().state).toBe("ready");
      const reopenedPort = (
        await readFile(
          path.join(dir, ".review/.browser/DevToolsActivePort"),
          "utf8",
        )
      )
        .trim()
        .split("\n");
      cdp = await Cdp.connect(
        "ws://127.0.0.1:" + reopenedPort[0] + reopenedPort[1],
      );
      appTarget = (await targets()).find((t) => t.url === web.status().url)!;
      sid = (
        await cdp.send("Target.attachToTarget", {
          targetId: appTarget.targetId,
          flatten: true,
        })
      ).sessionId;
      await root();
      expect(
        (await targets()).filter(
          (t) => t.type === "page" && t.url.startsWith(reviewUrl),
        ),
      ).toHaveLength(1);
      expect((await session.read()).notes).toEqual(persistedBeforeRestart);
      const reopenedNote = persistedBeforeRestart.find(
        (saved) => saved.id === note.id,
      )!;
      await web.focus(note.id);
      await frame(reopenedNote.id);
      expect(
        await frameJs('document.querySelector("#uiNote .nbody").textContent'),
      ).toContain(reopenedNote.body.split("#" + diffRef)[0]!);
      expect(
        await frameJs(
          'document.querySelector("#uiNote .nbody .nref").dataset.nref',
        ),
      ).toBe(diffNote.id);
      // Comparisons never silently navigate to an old URL or attach evidence from another route.
      const otherRoute = new URL("/another-workspace", web.status().url).href;
      await send("Page.navigate", { url: otherRoute });
      await root();
      await expect(web.captureAfter(note.id)).rejects.toThrow(
        "cannot be matched",
      );
      expect(await js("location.href")).toBe(otherRoute);
      expect(web.replyDraft(note.id)).toEqual({ reply: true, web: null });
      expect((await session.read()).notes).toEqual(persistedBeforeRestart);
      // The new-document injection is restricted to the reviewed origin, even in the owned tab.
      await send("Page.navigate", { url: reviewUrl });
      await until(
        () =>
          js(
            `location.origin===${JSON.stringify(reviewUrl)}&&document.readyState==="complete"`,
          ),
        "cross-origin navigation finishes",
      );
      expect(await js('!!document.querySelector("[id^=__lcr_]")')).toBe(false);
      await send("Page.navigate", { url: web.status().url });
      await root();
      await web.focus(note.id);
      await frame(reopenedNote.id);
      expect(
        await frameJs('document.querySelector("#uiNote .nbody").textContent'),
      ).toContain(reopenedNote.body.split("#" + diffRef)[0]!);
      expect(
        await frameJs(
          'document.querySelector("#uiNote .nbody .nref").dataset.nref',
        ),
      ).toBe(diffNote.id);
    } finally {
      cdp?.close();
      await web.close();
      server.stop(true);
      app.stop(true);
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
  120_000,
);
