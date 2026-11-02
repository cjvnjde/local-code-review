import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
      expect(statSync(profile).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(profile, ".lcr-owner.lock")).mode & 0o777).toBe(
        0o600,
      );
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
    expect(browser.child.exitCode).toBe(0);
    expect(existsSync(path.join(profile, "terminated"))).toBe(false);
    expect(existsSync(path.join(profile, ".lcr-owner.lock"))).toBe(false);
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
    expect(existsSync(path.join(profile, ".lcr-owner.lock"))).toBe(false);
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
    expect(existsSync(path.join(profile, ".lcr-owner.lock"))).toBe(false);
  },
);

test.skipIf(process.platform === "win32")(
  "a concurrent launch cannot disturb the owning browser, and shutdown releases the profile for reuse",
  async () => {
    const profile = fixture();
    const first = await launchReviewBrowser(profile);
    try {
      const endpoint = readFileSync(
        path.join(profile, "DevToolsActivePort"),
        "utf8",
      );
      await expect(launchReviewBrowser(profile)).rejects.toThrow(
        "already in use",
      );
      expect(
        readFileSync(path.join(profile, "DevToolsActivePort"), "utf8"),
      ).toBe(endpoint);
      expect(await first.cdp.send("Browser.getVersion")).toEqual({
        product: "LifecycleFixture/1",
      });
    } finally {
      await first.close();
    }
    const second = await launchReviewBrowser(profile);
    await second.close();
  },
);

test.skipIf(process.platform === "win32")(
  "a leftover owner lock requires explicit recovery without touching browser state",
  async () => {
    const profile = fixture();
    const lock = path.join(profile, ".lcr-owner.lock");
    writeFileSync(lock, '{"pid":123}');
    writeFileSync(
      path.join(profile, "DevToolsActivePort"),
      "untouched endpoint",
    );
    await expect(launchReviewBrowser(profile)).rejects.toThrow(
      "only remove it after verifying",
    );
    expect(readFileSync(lock, "utf8")).toBe('{"pid":123}');
    expect(readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")).toBe(
      "untouched endpoint",
    );
  },
);
