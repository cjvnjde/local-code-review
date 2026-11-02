import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchReviewBrowser } from "../browser/review-browser.ts";
import { createSession } from "../review/session.ts";
import { createHub } from "../server/events.ts";
import { createWebReview } from "./controller.ts";

test.skipIf(process.env.LCR_TEST_BROWSER !== "1")(
  "existing attachment preserves tab state, captures notes, and detaches without closing or changing other tabs",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lcr-attach-browser-"));
    const app = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          '<!doctype html><title>Existing session</title><style>body{height:2400px}button{margin:100px}</style><input id="draft"><button id="action" onclick="window.clicks++">Save</button><script>window.clicks=0;window.loaded=crypto.randomUUID();</script>',
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
    const profile = path.join(root, "user-data");
    const owner = await launchReviewBrowser(profile, [
      "--headless=new",
      "--window-size=1280,900",
    ]);
    const source = await readFile(
      path.join(profile, "DevToolsActivePort"),
      "utf8",
    );
    const url = `http://127.0.0.1:${app.port}/`;
    const session = createSession(root, ".review", "HEAD");
    const options = {
      url,
      repoRoot: root,
      outDir: ".review",
      browserProfile: "existing" as const,
      browserDataDir: profile,
      session,
      hub: createHub(),
      reviewUrl: () => `http://127.0.0.1:${review.port}/`,
    };
    const web = createWebReview(options);
    const otherReview = createWebReview(options);
    const cdp = owner.cdp;
    async function until(f: () => Promise<boolean>, label: string) {
      for (let i = 0; i < 150; i++) {
        if (await f()) return;
        await Bun.sleep(50);
      }
      throw new Error("Timed out: " + label);
    }
    const appTarget = (await cdp.send("Target.createTarget", { url })).targetId;
    const unrelated = (
      await cdp.send("Target.createTarget", { url: url + "unrelated" })
    ).targetId;
    const sid = (
      await cdp.send("Target.attachToTarget", {
        targetId: appTarget,
        flatten: true,
      })
    ).sessionId;
    const js = async (expression: string) =>
      (
        await cdp.send(
          "Runtime.evaluate",
          { expression, returnByValue: true, awaitPromise: true },
          sid,
        )
      ).result.value;
    const targets = async () =>
      (await cdp.send("Target.getTargets")).targetInfos;
    const overlay = "document.querySelector('[id^=__lcr_]')";
    try {
      await until(
        () =>
          js(
            "document.readyState==='complete'&&!!document.querySelector('#draft')",
          ),
        "existing page loads",
      );
      const loaded = await js("loaded");
      await js(
        "document.querySelector('#draft').value='unfinished form';window.scrollTo(0,300)",
      );
      await Promise.all([web.open(), web.open()]);
      expect(web.status().state).toBe("ready");
      expect(
        await js("[loaded,document.querySelector('#draft').value,scrollY]"),
      ).toEqual([loaded, "unfinished form", 300]);
      expect((await targets()).filter((t: any) => t.url === url)).toHaveLength(
        1,
      );
      expect(await js(`!!${overlay}`)).toBe(true);
      await expect(otherReview.open()).rejects.toThrow(
        "already connected to another lcr review",
      );
      expect(web.status().state).toBe("ready");
      expect(await js(`!!${overlay}`)).toBe(true);

      // Make a real capture through the injected toolbar, without reloading the user's page.
      await js("window.scrollTo(0,0)");
      const point = await js(
        "(()=>{const r=document.querySelector('#action').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "left", clickCount: 1, ...point },
        sid,
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", button: "left", clickCount: 1, ...point },
        sid,
      );
      await until(
        () => js(`!!${overlay}?.shadowRoot.querySelector('iframe')`),
        "capture creates a draft",
      );
      const draftId = await js(
        `new URL(${overlay}.shadowRoot.querySelector('iframe').src).searchParams.get('ui-draft')`,
      );
      expect(web.draft(draftId)?.before.element?.tag).toBe("button");
      expect(await js("clicks")).toBe(0);
      await web.close();
      expect(cdp.connected).toBe(true);
      expect(await js(`!!${overlay}`)).toBe(false);
      expect(await js("document.querySelector('#draft').value")).toBe(
        "unfinished form",
      );
      await js("document.querySelector('#action').click()");
      expect(await js("clicks")).toBe(1);
      expect((await targets()).some((t: any) => t.targetId === unrelated)).toBe(
        true,
      );
      expect(
        await readFile(path.join(profile, "DevToolsActivePort"), "utf8"),
      ).toBe(source);
      await cdp.send("Page.reload", {}, sid);
      await until(
        () =>
          js(
            `document.readyState==='complete'&&loaded!==${JSON.stringify(loaded)}`,
          ),
        "reload after detach",
      );
      expect(await js(`!!${overlay}`)).toBe(false);
      await js("document.querySelector('#action').click()");
      expect(await js("clicks")).toBe(1);

      await web.open();
      expect(await js(`!!${overlay}`)).toBe(true);
      await cdp.send("Target.closeTarget", { targetId: appTarget });
      await until(
        async () => web.status().state === "closed",
        "tab close notification",
      );
      await web.open();
      expect(web.status().state).toBe("ready");
      expect((await targets()).filter((t: any) => t.url === url)).toHaveLength(
        1,
      );
      await web.close();
      const duplicate = (await cdp.send("Target.createTarget", { url }))
        .targetId;
      await until(
        async () =>
          (await targets()).filter((t: any) => t.url === url).length === 2,
        "duplicate tab loads",
      );
      await expect(web.open()).rejects.toThrow(
        "More than one browser tab matches",
      );
      expect((await targets()).some((t: any) => t.targetId === duplicate)).toBe(
        true,
      );
      expect(cdp.connected).toBe(true);
    } finally {
      await otherReview.close();
      await web.close();
      await owner.close();
      app.stop(true);
      review.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
