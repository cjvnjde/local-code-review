import { test, expect, chromium } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";

let root: string,
  directory: string,
  binary: string,
  child: ChildProcess,
  url: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: directory, encoding: "utf8" });
async function launch(extra: string[] = []) {
  child = spawn(binary, ["--port", "0", "--no-open", "--no-agent", ...extra], {
    cwd: directory,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(directory, "config") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(output || "No startup banner")),
      15_000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`lcr exited ${code}: ${output}`));
    });
    for (const stream of [child.stdout, child.stderr])
      stream!.on("data", (chunk) => {
        output += chunk.toString();
        const found = /http:\/\/localhost:\d+/.exec(output);
        if (found) {
          clearTimeout(timer);
          resolve(found[0]);
        }
      });
  });
}
async function stop() {
  if (child.exitCode != null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lcr-react-e2e-"));
  directory = path.join(root, "repo");
  await mkdir(directory);
  binary = path.join(root, "lcr");
  execFileSync("bun", ["run", "scripts/build.ts", "--outfile", binary], {
    cwd: process.cwd(),
  });
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  await mkdir(path.join(directory, "src"));
  await writeFile(
    path.join(directory, "src/app.ts"),
    "export function greet() {\n  return 'hello';\n}\n",
  );
  await writeFile(path.join(directory, "src/deleted.ts"), "old content\n");
  await writeFile(path.join(directory, "staged.txt"), "old\n");
  git("add", "src", "staged.txt");
  git("commit", "--quiet", "-m", "initial");
  await writeFile(
    path.join(directory, "src/app.ts"),
    "export function greet() {\n  return 'hello world';\n}\n",
  );
  await rm(path.join(directory, "src/deleted.ts"));
  await writeFile(path.join(directory, "staged.txt"), "staged change\n");
  git("add", "staged.txt");
  await writeFile(
    path.join(directory, "untracked.ts"),
    Array.from(
      { length: 3000 },
      (_, i) => `export const item${i} = ${i};`,
    ).join("\n"),
  );
  // The executable is deliberately launched outside the checkout, with no node_modules or assets.
  await launch();
});
test.afterAll(async () => {
  if (child) await stop();
  if (root) await rm(root, { recursive: true, force: true });
});

test("compiled executable reviews changes, preserves drafts, and continues the Markdown conversation", async ({
  page,
}) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))
      remote.push(request.url());
  });
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Local code review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "src/app.ts", exact: true }),
  ).toBeVisible();
  const diff = await (await page.request.get(`${url}/api/diff`)).json();
  expect(diff.files.map((file: { path: string }) => file.path)).toEqual(
    expect.arrayContaining([
      "src/app.ts",
      "src/deleted.ts",
      "staged.txt",
      "untracked.ts",
    ]),
  );
  expect(
    await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await page
    .getByRole("button", { name: "Comment on line 2", exact: true })
    .last()
    .click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill(
      "Please **rename** this greeting.\n\n| Why | Value |\n|---|---|\n| Scope | Local |",
    );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.locator("article table")).toBeVisible();
  let review = await (await page.request.get(`${url}/api/review`)).json();
  const reviewPath = path.join(directory, review.file);
  expect(await readFile(reviewPath, "utf8")).toContain(
    "<!-- lcr:src/app.ts|n2|n2|#",
  );
  expect(review.notes[0].code).toBe("+  return 'hello world';");
  // An external agent appends a verdict and answer while the reviewer is typing.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Keep this **unsaved** follow-up.");
  await writeFile(
    reviewPath,
    (await readFile(reviewPath, "utf8")).replace(
      "Status: pending",
      "Status: answered\n\n**Agent** <!-- lcr:m 2026-11-11T10:00:00.000Z -->\n\nThis greeting is intentionally local.",
    ),
  );
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${url}/api/review`)).json()).notes[0]
          .messages.length,
    )
    .toBe(1);
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Keep this **unsaved** follow-up.",
  );
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(
    page.locator("article").getByText("This greeting is intentionally local."),
  ).toBeVisible();
  await expect(page.locator("article").getByText("Keep this")).toBeVisible();
  // Markdown and library highlights cannot turn source or note HTML into active markup.
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill(
      "<script>window.lcrInjected=true</script>\n\n![remote](https://example.com/pixel.png)",
    );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { lcrInjected?: boolean }).lcrInjected,
    ),
  ).toBeUndefined();
  expect(remote).toEqual([]);
  // A draft survives reload and never gets replaced by SSE refetches.
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Recovered draft");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Recovered draft",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Only a bounded window of large-file rows is mounted.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /untracked.ts/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "untracked.ts", exact: true }),
  ).toBeVisible();
  expect(
    await page.getByRole("button", { name: /Select line/ }).count(),
  ).toBeLessThan(100);
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.screenshot({ path: "/tmp/lcr-v2-ui.png" });
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", { name: "Select file" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Restarting the standalone binary adopts the same conversation from Markdown.
  const original = review.file;
  await page.close();
  await stop();
  await launch();
  review = await (await fetch(`${url}/api/review`)).json();
  expect(review.file).toBe(original);
  const codeNote = review.notes.find(
    (note: { file: string }) => note.file === "src/app.ts",
  );
  expect(codeNote.messages).toHaveLength(2);
  expect(codeNote.status).toBe("answered");
});

test("live page capture saves through the embedded React editor", async ({
  page,
}) => {
  await stop();
  const app = createServer((_req, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      '<!doctype html><title>Capture fixture</title><style>body{background:white;color:black}button{margin:120px;padding:24px;font:20px sans-serif}</style><button id="target">Checkout target</button>',
    );
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address() as { port: number };
  const appUrl = `http://127.0.0.1:${address.port}/`;
  const profile = path.join(root, "chrome-profile");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: true,
    args: ["--remote-debugging-port=0"],
    viewport: { width: 1200, height: 900 },
  });
  try {
    const target = await context.newPage();
    await target.goto(appUrl);
    await launch([
      "--web",
      appUrl,
      "--browser-profile",
      "existing",
      "--browser-data-dir",
      profile,
    ]);
    const opened = await page.request.post(`${url}/api/web`, { data: {} });
    expect(opened.ok()).toBe(true);
    await target.locator("#target").click();
    const frame = target.frameLocator('iframe[title="New visual review note"]');
    await expect(
      frame.getByRole("textbox", { name: "Note text" }),
    ).toBeVisible();
    await frame
      .getByRole("textbox", { name: "Note text" })
      .fill("Increase this checkout target size.");
    await frame.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      target.locator('iframe[title="New visual review note"]'),
    ).toHaveCount(0);
    const saved = await (await page.request.get(`${url}/api/review`)).json();
    const note = saved.notes.find((n: { body: string }) =>
      n.body.includes("Increase this checkout"),
    );
    expect(note.web.before.element.text).toBe("Checkout target");
    expect(note.web.before.area).toMatch(/^images\/.+\.png$/);
    const picture = await page.request.get(
      `${url}/api/attachment?ref=${encodeURIComponent(note.web.before.area)}`,
    );
    expect(picture.ok()).toBe(true);
    await page.goto(url);
    await expect(
      page
        .getByRole("article")
        .filter({ hasText: "Increase this checkout target size." }),
    ).toBeVisible();
  } finally {
    await stop();
    await context.close();
    await new Promise<void>((resolve) => app.close(() => resolve()));
  }
});
