import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startWebPlayground } from "../../scripts/web-playground.ts";
import { Cdp } from "../browser/cdp.ts";
import { browserEndpoint } from "../browser/existing-browser.ts";
import { runGit } from "../git/commands.ts";
import type { WebCapture } from "../shared/web-review.ts";

test.skipIf(process.env.LCR_TEST_BROWSER !== "1")(
  "playground selects the real floating launcher and note card without activating them",
  async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "lcr-playground-test-"));
    let playground: Awaited<ReturnType<typeof startWebPlayground>> | undefined;
    let cdp: Cdp | undefined;
    try {
      await runGit(["init", "-q"], repoRoot);
      await writeFile(
        path.join(repoRoot, "sample.ts"),
        "export const size = 20;\n",
      );
      await runGit(["add", "."], repoRoot);
      await runGit(
        [
          "-c",
          "user.name=Browser test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "-qm",
          "initial",
        ],
        repoRoot,
      );
      await writeFile(
        path.join(repoRoot, "sample.ts"),
        "export const size = 32;\n",
      );
      playground = await startWebPlayground({
        repoRoot,
        browserArgs: ["--headless=new", "--window-size=1280,900"],
      });
      cdp = await Cdp.connect(
        browserEndpoint(
          await readFile(
            path.join(playground.profile, "DevToolsActivePort"),
            "utf8",
          ),
        ),
      );
      const target = (await cdp.send("Target.getTargets")).targetInfos.find(
        (target: { url: string }) => target.url === playground!.url,
      );
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      const send = (method: string, params: Record<string, unknown> = {}) =>
        cdp!.send(method, params, sessionId);
      async function js(expression: string) {
        const result = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails)
          throw new Error(
            result.exceptionDetails.exception?.description ||
              result.exceptionDetails.text,
          );
        return result.result.value;
      }
      async function until(expression: string) {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (await js(expression)) return;
          await Bun.sleep(50);
        }
        throw new Error("Timed out: " + expression);
      }
      const example =
        "document.getElementById(window.__lcr_playground_example__)";
      const reviewer = "document.getElementById(window.__lcr_page_review__)";
      const a = example + ".shadowRoot";
      const b = reviewer + ".shadowRoot";
      async function bounds(expression: string) {
        return js(
          `(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
        );
      }
      const center = (rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      async function mouse(type: string, point: { x: number; y: number }) {
        await send("Input.dispatchMouseEvent", {
          type,
          ...point,
          button: "left",
          clickCount: 1,
          ...(type === "mousePressed" ? { buttons: 1 } : {}),
        });
      }
      async function click(expression: string) {
        const point = center(await bounds(expression));
        await mouse("mouseMoved", point);
        await mouse("mousePressed", point);
        await mouse("mouseReleased", point);
      }
      const mode = (value: string) =>
        click(`document.querySelector('[data-playground-mode="${value}"]')`);
      async function capture() {
        await until(`!!${b}.querySelector('iframe')`);
        const id = await js(
          `new URL(${b}.querySelector('iframe').src).searchParams.get('ui-draft')`,
        );
        const response = await fetch(
          `${playground!.feedbackUrl}/api/web/draft?id=${id}`,
        );
        expect(response.status).toBe(200);
        return (await response.json()).web.before as WebCapture;
      }
      const closeReviewer = () => click(`${b}.querySelector('[data-close]')`);

      await until(
        "document.querySelector('#playground-controls').dataset.ready==='true'",
      );
      const launcher = `${a}.querySelector('[data-launcher]')`;
      const original = await bounds(launcher);
      await mode("review");
      await mouse("mouseMoved", center(original));
      expect(await bounds(`${b}.querySelector('.outline')`)).toEqual(original);
      await click(launcher);
      const buttonCapture = await capture();
      expect(buttonCapture.element?.tag).toBe("button");
      expect(buttonCapture.element?.attributes["aria-label"]).toBe(
        "Selection mode",
      );
      expect(buttonCapture.rect).toEqual(original);
      expect(await js(`${launcher}.getAttribute('aria-pressed')`)).toBe("true");
      expect(await js(`${example}.inert`)).toBe(true);
      expect(
        (
          await js(
            `window[window.__lcr_page_review__].prepare(${JSON.stringify(buttonCapture)})`,
          )
        ).rect,
      ).toEqual(original);

      await closeReviewer();
      await mode("example");
      const start = center(original);
      const finish = { x: start.x + 150, y: start.y - 60 };
      await mouse("mouseMoved", start);
      await mouse("mousePressed", start);
      await mouse("mouseMoved", finish);
      await mouse("mouseReleased", finish);
      await mode("review");
      const moved = await bounds(launcher);
      expect(moved.x).toBe(original.x + 150);
      expect(moved.y).toBe(original.y - 60);
      expect(
        (
          await js(
            `window[window.__lcr_page_review__].prepare(${JSON.stringify(buttonCapture)})`,
          )
        ).rect,
      ).toEqual(moved);

      await mode("example");
      await click("document.querySelector('#workspace-card h2')");
      await until(`!!${a}.querySelector('iframe')`);
      const frameUrl = await js(`${a}.querySelector('iframe').src`);
      const card = `${a}.querySelector('.dock')`;
      const cardBounds = await bounds(card);
      await mode("review");
      await mouse("mouseMoved", center(cardBounds));
      expect(await bounds(`${b}.querySelector('.outline')`)).toEqual(
        cardBounds,
      );
      await click(card);
      const cardCapture = await capture();
      expect(cardCapture.rect).toEqual(cardBounds);
      expect(cardCapture.element?.tag).toBe("div");
      expect(await js(`${a}.querySelector('iframe').src`)).toBe(frameUrl);
      expect(await js(`${example}.inert`)).toBe(true);
      await closeReviewer();
      await mode("example");
      expect(await js(`${a}.querySelector('iframe').src`)).toBe(frameUrl);
      expect(await js(`${example}.inert`)).toBe(false);
    } finally {
      cdp?.close();
      await playground?.close();
      await rm(repoRoot, { recursive: true, force: true });
    }
  },
  60_000,
);
