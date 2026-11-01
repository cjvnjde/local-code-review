import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromeCandidates, launchReviewBrowser } from "./review-browser.ts";

const roots: string[] = [];
const watchers: { close(): void }[] = [];
const previousBrowser = process.env.LCR_BROWSER_PATH;
afterEach(() => {
  if (previousBrowser === undefined) delete process.env.LCR_BROWSER_PATH;
  else process.env.LCR_BROWSER_PATH = previousBrowser;
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lcr-browser-process-"));
  roots.push(root);
  const executable = path.join(root, "browser with spaces");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(import.meta.dir, "fixtures/review-browser-process.ts"))} "$@"\n`,
  );
  chmodSync(executable, 0o700);
  process.env.LCR_BROWSER_PATH = executable;
  const profile = path.join(root, "private profile");
  mkdirSync(profile);
  return profile;
}

test("an explicit browser executable is exclusive and a missing override cannot silently launch another browser", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lcr-browser-missing-"));
  roots.push(root);
  process.env.LCR_BROWSER_PATH = path.join(root, "not-installed");
  expect(chromeCandidates("darwin")).toEqual([process.env.LCR_BROWSER_PATH]);
  expect(chromeCandidates("linux")).toEqual([process.env.LCR_BROWSER_PATH]);
  await expect(launchReviewBrowser(path.join(root, "profile"))).rejects.toThrow(
    "not found",
  );
  expect(existsSync(path.join(root, "profile"))).toBe(false);
});

test.skipIf(process.platform === "win32")(
  "browser launch discards stale endpoints, isolates its profile, connects and closes the owned child",
  async () => {
    const profile = fixture();
    writeFileSync(
      path.join(profile, "DevToolsActivePort"),
      "1\n/devtools/browser/stale\n",
    );
    writeFileSync(
      path.join(profile, "preserved-preferences"),
      "review preferences",
    );
    const browser = await launchReviewBrowser(profile, [
      "--fixture-mode=ready",
      "--disable-gpu",
    ]);
    try {
      expect(browser.cdp.connected).toBe(true);
      expect(await browser.cdp.send("Browser.getVersion")).toEqual({
        product: "LifecycleFixture/1",
      });
      const launched: unknown = JSON.parse(
        readFileSync(path.join(profile, "launch.json"), "utf8"),
      );
      expect(launched).toMatchObject({ staleEndpoint: false });
      expect(launched).toHaveProperty(
        "args",
        expect.arrayContaining([
          "--remote-debugging-port=0",
          "--remote-debugging-address=127.0.0.1",
          "--user-data-dir=" + profile,
          "--disable-gpu",
          "about:blank",
        ]),
      );
      expect(
        readFileSync(path.join(profile, "preserved-preferences"), "utf8"),
      ).toBe("review preferences");
    } finally {
      await browser.close();
      await browser.child.exited;
    }
    expect(existsSync(path.join(profile, "browser-close"))).toBe(true);
    expect(browser.cdp.connected).toBe(false);
    await expect(browser.cdp.send("Browser.getVersion")).rejects.toThrow(
      "not connected",
    );
  },
);

test.skipIf(process.platform === "win32")(
  "browser exit before publishing DevTools is reported without attaching to a stale profile endpoint",
  async () => {
    const profile = fixture();
    writeFileSync(
      path.join(profile, "DevToolsActivePort"),
      "1\n/devtools/browser/stale\n",
    );
    await expect(
      launchReviewBrowser(profile, ["--fixture-mode=exit"]),
    ).rejects.toThrow("browser exited");
    expect(existsSync(path.join(profile, "DevToolsActivePort"))).toBe(false);
  },
);

test.skipIf(process.platform === "win32")(
  "a refused DevTools connection terminates the launched child rather than leaking it",
  async () => {
    const profile = fixture();
    const terminated = Promise.withResolvers<void>();
    const watcher = watch(profile, () => {
      if (existsSync(path.join(profile, "terminated"))) terminated.resolve();
    });
    watchers.push(watcher);
    await expect(
      launchReviewBrowser(profile, ["--fixture-mode=refused"]),
    ).rejects.toThrow("Could not connect");
    await terminated.promise;
  },
);
