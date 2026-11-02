import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reviewBrowserProfile } from "./profile.ts";
import { launchReviewBrowser } from "./review-browser.ts";

test("shared browser state follows user config across repositories, worktrees and output directories", () => {
  const config = "/user/config/lcr/config.json";
  for (const root of ["/repo", "/worktrees/feature", "/another-project"]) {
    for (const output of [".review", ".feedback", "/external/output"]) {
      expect(reviewBrowserProfile(root, output, undefined, config)).toBe(
        path.join(path.dirname(config), "browser"),
      );
      expect(reviewBrowserProfile(root, output, "shared", config)).toBe(
        path.join(path.dirname(config), "browser"),
      );
    }
  }
});

test("project state retains existing profiles and isolates worktrees and custom outputs", () => {
  expect(reviewBrowserProfile("/repo", ".review", "project")).toBe(
    path.resolve("/repo/.review/.browser"),
  );
  expect(reviewBrowserProfile("/worktrees/feature", ".review", "project")).toBe(
    path.resolve("/worktrees/feature/.review/.browser"),
  );
  expect(reviewBrowserProfile("/repo", "/external/output", "project")).toBe(
    path.resolve("/external/output/.browser"),
  );
});

test.skipIf(process.env.LCR_TEST_BROWSER !== "1")(
  "Chrome persists a shared login across worktrees while project profiles stay isolated",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lcr-profile-login-"));
    const config = path.join(root, "config/lcr/config.json");
    let browser: Awaited<ReturnType<typeof launchReviewBrowser>> | undefined;
    const launch = (repo: string, scope?: "shared" | "project") =>
      launchReviewBrowser(
        reviewBrowserProfile(path.join(root, repo), ".review", scope, config),
        ["--headless=new"],
      );
    try {
      browser = await launch("main");
      await browser.cdp.send("Storage.setCookies", {
        cookies: [
          {
            name: "lcr_test_login",
            value: "signed-in",
            url: "http://localhost/",
            expires: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
      });
      await browser.close();
      browser = await launch("worktrees/feature");
      expect((await browser.cdp.send("Storage.getCookies")).cookies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "lcr_test_login",
            value: "signed-in",
          }),
        ]),
      );
      await browser.close();
      browser = await launch("worktrees/feature", "project");
      expect((await browser.cdp.send("Storage.getCookies")).cookies).toEqual(
        [],
      );
    } finally {
      await browser?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
