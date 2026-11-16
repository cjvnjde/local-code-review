import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DiffFile } from "../../src/shared/review-types.ts";

let root: string, child: ChildProcess, url: string;

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lcr-performance-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  const binary = process.env.LCR_TEST_BINARY || path.join(root, "lcr");
  if (!process.env.LCR_TEST_BINARY)
    execFileSync("bun", ["run", "scripts/build.ts", "--outfile", binary]);
  child = spawn(binary, ["--port", "0", "--no-open", "--no-agent"], {
    cwd: repo,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(root, "config") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(output)), 15_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(output));
    });
    for (const stream of [child.stdout, child.stderr])
      stream!.on("data", (chunk) => {
        output += chunk.toString();
        const match = /http:\/\/localhost:\d+/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
  });
});

test.afterAll(async () => {
  if (child && child.exitCode === null)
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  if (root) await rm(root, { recursive: true, force: true });
});

// Match the reported review size. Exercise the real compiled UI without making
// browser interaction measurements depend on Git or filesystem throughput.
const files: DiffFile[] = Array.from({ length: 1982 }, (_, index) => {
  const added = 13 + (index < 1072 ? 1 : 0);
  const removed = 29 + (index < 1402 ? 1 : 0);
  return {
    path: `src/group-${String(Math.floor(index / 20)).padStart(3, "0")}/file-${String(index).padStart(4, "0")}.ts`,
    status: "modified",
    hash: String(index),
    added,
    removed,
    rows: [
      { t: "hunk", text: `@@ -1,${removed} +1,${added} @@` },
      ...Array.from({ length: removed }, (_, line) => ({
        t: "del" as const,
        o: line + 1,
        text: `export const oldValue${line} = ${index};`,
      })),
      ...Array.from({ length: added }, (_, line) => ({
        t: "add" as const,
        n: line + 1,
        text: `export const newValue${line} = ${index + 1};`,
      })),
    ],
  };
});

async function paint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function typeAndMeasure(page: Page, input: Locator, value: string) {
  // Measure in the page: Playwright's DOM snapshots and IPC themselves get
  // expensive with thousands of sidebar elements.
  await input.evaluate((element) => {
    const timings: number[] = [];
    Object.assign(window, { inputTimings: timings });
    element.addEventListener("keydown", () => {
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => timings.push(performance.now() - start)),
      );
    });
  });
  await input.focus();
  await page.keyboard.type(value, { delay: 40 });
  await paint(page);
  const timings = await page.evaluate(
    () => (window as unknown as { inputTimings: number[] }).inputTimings,
  );
  await expect(input).toHaveValue(value);
  await expect(input).toBeFocused();
  expect(timings.length).toBeGreaterThanOrEqual(value.length);
  return {
    max: Math.max(...timings),
    mean: timings.reduce((a, b) => a + b, 0) / timings.length,
  };
}

test("large diff note interactions stay responsive and preserve drafts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/diff", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), files } });
  });
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Code diff" });
  await expect(pane.locator('[data-diff-kind="row"]').first()).toBeVisible();
  await paint(page);
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const add = pane.getByRole("button", {
    name: `Comment on file ${files[0]!.path}`,
    exact: true,
  });
  await add.evaluate((element) => {
    element.addEventListener(
      "click",
      () => {
        const start = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            Object.assign(window, { noteOpenTime: performance.now() - start }),
          ),
        );
      },
      { once: true },
    );
  });
  await add.click();
  const text = pane.getByRole("textbox", { name: "Note text", exact: true });
  await expect(text).toBeVisible();
  await paint(page);
  const open = await page.evaluate(
    () => (window as unknown as { noteOpenTime: number }).noteOpenTime,
  );

  const first = await typeAndMeasure(page, text, "Review this change");
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.reload();
  await expect(text).toHaveValue("Review this change");
  const navigation = page.getByRole("navigation");
  const hideFirst = navigation.getByRole("button", {
    name: `Hide file ${files[0]!.path}`,
    exact: true,
  });
  await navigation.locator(`button[title="${files[0]!.path}"]`).hover();
  await hideFirst.click();
  await expect(text).toHaveValue("Review this change");
  await expect(text).toBeFocused();
  await pane.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(text).toHaveCount(0);
  await navigation.locator(`button[title="${files[0]!.path}"]`).hover();
  await hideFirst.click();
  await expect(
    pane.getByRole("heading", { name: files[0]!.path, exact: true }),
  ).toHaveCount(0);

  // Also cover a draft after every other diff row, not just one near index 0.
  const lastPath = files.at(-1)!.path;
  await page
    .getByRole("navigation")
    .locator(`button[title="${lastPath}"]`)
    .click();
  await pane
    .getByRole("button", { name: `Comment on file ${lastPath}`, exact: true })
    .click();
  await expect(text).toBeVisible();
  await paint(page);
  const scrollTop = await pane.evaluate((element) => element.scrollTop);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const last = await typeAndMeasure(page, text, "Check the final file");
  expect(await pane.evaluate((element) => element.scrollTop)).toBeCloseTo(
    scrollTop,
    0,
  );
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await pane.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(text).toHaveCount(0);

  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  const overall = page
    .getByRole("region", { name: "Overall note editor" })
    .getByRole("textbox", { name: "Note text" });
  await expect(overall).toBeVisible();
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const panel = await typeAndMeasure(page, overall, "Review summary");
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  console.log(JSON.stringify({ open, first, last, panel }));
  expect(await pane.locator('[data-diff-kind="row"]').count()).toBeLessThan(
    100,
  );
  expect(errors).toEqual([]);
  expect(open).toBeLessThan(750);
  for (const timing of [first, last, panel]) {
    expect(timing.mean).toBeLessThan(100);
    expect(timing.max).toBeLessThan(200);
  }
});
