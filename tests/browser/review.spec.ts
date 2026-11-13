import { test, expect, chromium } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { DEFAULT_UI_SETTINGS } from "../../src/shared/settings.ts";

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
    env: { ...process.env, XDG_CONFIG_HOME: path.join(root, "config") },
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
test.beforeEach(async ({ request }) => {
  const response = await request.put(`${url}/api/settings`, {
    data: DEFAULT_UI_SETTINGS,
  });
  expect(response.ok()).toBe(true);
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
  const notesPanel = page.getByRole("complementary", { name: "Review notes" });
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
  // The next file pushes the pinned header away instead of overlapping it.
  const readingPane = page.getByRole("region", { name: "Code diff" });
  const firstHeader = readingPane.locator(
    '[data-diff-kind="header"][data-file-path="src/app.ts"]',
  );
  const nextHeader = readingPane.locator(
    '[data-diff-kind="header"][data-file-path="src/deleted.ts"]',
  );
  const nextTop = await nextHeader.evaluate((header) => {
    const pane = header.closest('[role="region"]')!;
    return (
      header.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop
    );
  });
  await readingPane.evaluate((pane, top) => {
    pane.scrollTop = top - 14;
  }, nextTop);
  await expect
    .poll(async () => {
      const first = await firstHeader.boundingBox(),
        next = await nextHeader.boundingBox();
      return first && next
        ? Math.abs(first.y + first.height - next.y)
        : Infinity;
    })
    .toBeLessThan(2);
  await readingPane.evaluate((pane) => {
    pane.scrollTop = 0;
  });
  const addedCode = page
    .locator('[data-file-path="src/app.ts"] [data-code-cell]')
    .filter({ hasText: "hello world" });
  const codeLeft = (await addedCode.boundingBox())!.x;
  await page
    .locator('[data-file-path="src/app.ts"][data-diff-kind="row"]')
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
  await expect(notesPanel.getByRole("article")).toHaveCount(1);
  await expect(notesPanel.locator("article table")).toBeVisible();
  expect((await addedCode.boundingBox())!.x).toBe(codeLeft);
  await expect(addedCode).toHaveText("  return 'hello world';");
  let review = await (await page.request.get(`${url}/api/review`)).json();
  const reviewPath = path.join(directory, review.file);
  expect(await readFile(reviewPath, "utf8")).toContain(
    "<!-- lcr:src/app.ts|n2|n2|#",
  );
  expect(review.notes[0].code).toBe("+  return 'hello world';");
  // An external agent appends a verdict and answer while the reviewer is typing.
  await notesPanel.getByRole("button", { name: "Reply", exact: true }).click();
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
    notesPanel
      .locator("article")
      .getByText("This greeting is intentionally local."),
  ).toBeVisible();
  await expect(
    notesPanel.locator("article").getByText("Keep this"),
  ).toBeVisible();
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
  await expect(page.locator("[data-review-editor]")).toHaveCount(0);
  // A draft survives reload and never gets replaced by SSE refetches.
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Recovered draft");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Recovered draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Only a bounded window of large-file rows is mounted.
  await page
    .getByRole("navigation")
    .locator('button[title="untracked.ts"]')
    .click();
  await expect(
    page.getByRole("heading", { name: "untracked.ts", exact: true }),
  ).toBeVisible();
  expect(
    await page.getByRole("button", { name: /Comment on line/ }).count(),
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

test("line, range and character gestures keep comments inline and protect draft text", async ({
  page,
}) => {
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Code diff" });
  const editor = page.locator("[data-review-editor]");
  const code = pane
    .locator('[data-file-path="src/app.ts"] [data-code-cell]')
    .filter({ hasText: "hello world" });
  await expect(code).toBeVisible();
  await code.click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toContainText("src/app.ts:2");
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Keep my draft while changing its selection");
  // Shift-click extends the existing draft rather than replacing its body.
  await pane
    .locator('[data-file-path="src/app.ts"]')
    .getByRole("button", { name: "Comment on line 3", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(editor).toContainText("src/app.ts:2-3");
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Keep my draft while changing its selection",
  );
  // An unrelated file cannot steal a dirty draft.
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  await expect(editor).toContainText("src/app.ts:2-3");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("navigation")
    .locator('button[title="src/app.ts"]')
    .click();
  await expect(code).toBeInViewport();
  // A real native drag through syntax-highlighted text, then save/reload its columns.
  const point = async (offset: number) =>
    code.evaluate((cell, offset) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let left = offset;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (left <= node.textContent!.length) {
          const range = document.createRange();
          range.setStart(node, left);
          range.collapse(true);
          const rect = range.getBoundingClientRect();
          return { x: rect.x + 0.2, y: rect.y + rect.height / 2 };
        }
        left -= node.textContent!.length;
      }
      throw new Error("No character position");
    }, offset);
  const from = await point(10),
    to = await point(15);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  await expect(editor).toContainText("src/app.ts:2:11-15");
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Character selection round trip");
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  const review = await (await page.request.get(`${url}/api/review`)).json();
  expect(
    review.notes.find(
      (note: any) => note.body === "Character selection round trip",
    ),
  ).toMatchObject({
    ca: 10,
    cb: 15,
    snippet: "hello",
    code: "+  return 'hello world';",
  });
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(code).toBeVisible();
  // Alt-drag leaves native browser text selection and does not open an editor.
  const a = await point(10),
    b = await point(15);
  await page.keyboard.down("Alt");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "hello",
  );
  // Reverse multiline drag on adjacent rows in the continuous diff.
  await page
    .getByRole("navigation")
    .locator('button[title="untracked.ts"]')
    .click();
  const rows = pane.locator('[data-file-path="untracked.ts"]');
  const first = rows.getByRole("button", {
    name: "Comment on line 2",
    exact: true,
  });
  const last = rows.getByRole("button", {
    name: "Comment on line 4",
    exact: true,
  });
  await expect(last).toBeInViewport();
  const end = await last.boundingBox();
  const start = await first.boundingBox();
  await page.mouse.move(end!.x + 10, end!.y + 10);
  await page.mouse.down();
  await page.mouse.move(start!.x + 10, start!.y + 10, { steps: 10 });
  await page.mouse.up();
  await expect(editor).toContainText("untracked.ts:2-4");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("image attachments preview, retain editable drawings and survive note and reply saves", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  const editor = page.locator("[data-review-editor]");
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Image editing round trip");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = "#222";
    ctx.fillText("Original evidence", 20, 40);
    return c.toDataURL().split(",")[1]!;
  });
  await editor.locator('input[accept="image/*"]').setInputFiles({
    name: "evidence.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const images = editor.getByRole("region", { name: "Attached images" });
  await expect(images.getByRole("img")).toBeVisible();
  await images.getByRole("button", { name: "Preview", exact: true }).click();
  const viewer = page.locator("dialog.image-viewer");
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "100%", exact: true }).click();
  await viewer.getByRole("button", { name: "Fit", exact: true }).click();
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  await images
    .getByRole("button", { name: "Draw / edit", exact: true })
    .click();
  const drawing = page.getByRole("dialog", {
    name: "Draw on screenshot",
    exact: true,
  });
  await expect(drawing).toBeVisible();
  await drawing
    .getByRole("button", { name: "Draw a rectangle", exact: true })
    .click();
  const canvas = drawing.locator("[data-drawing-surface]");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  await page.mouse.move(
    box!.x + box!.width * 0.35,
    box!.y + box!.height * 0.35,
  );
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await drawing
    .getByRole("button", { name: "Add numbered callout", exact: true })
    .click();
  for (const [from, to] of [
    [
      [0.18, 0.2],
      [0.45, 0.45],
    ],
    [
      [0.8, 0.2],
      [0.7, 0.65],
    ],
  ]) {
    await page.mouse.move(
      box!.x + box!.width * from![0]!,
      box!.y + box!.height * from![1]!,
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width * to![0]!,
      box!.y + box!.height * to![1]!,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  await drawing
    .getByRole("textbox", { name: "Callout label", exact: true })
    .fill("Check this detail");
  await drawing
    .getByRole("button", { name: "Apply drawing", exact: true })
    .click();
  await expect(drawing).toHaveCount(0);
  const body = await page
    .getByRole("textbox", { name: "Note text" })
    .inputValue();
  const ref = /!\[[^\]]*\]\(([^)]+)\)/.exec(body)![1]!;
  const { decodeImageDrawing } =
    await import("../../src/shared/image-drawing.ts");
  const response = await page.request.get(
    `${url}/api/attachment?ref=${encodeURIComponent(ref)}`,
  );
  const metadata = decodeImageDrawing(
    new Uint8Array(await response.body()),
    ref,
  );
  expect(metadata?.annotation.marks).toHaveLength(3);
  expect(metadata?.annotation.marks[0]?.tool).toBe("rectangle");
  expect(metadata?.annotation.marks.slice(1)).toMatchObject([
    { tool: "callout", number: 1 },
    { tool: "callout", number: 2, label: "Check this detail" },
  ]);
  // Reopen uses the original image and editable vectors, not a flattened second layer.
  await images
    .getByRole("button", { name: "Draw / edit", exact: true })
    .click();
  await expect(drawing).toBeVisible();
  await drawing
    .getByRole("button", { name: "Select and edit drawings", exact: true })
    .click();
  await expect(
    drawing
      .getByRole("combobox", { name: "Select an editable drawing" })
      .locator("option"),
  ).toHaveCount(4);
  await drawing
    .getByRole("button", { name: "Close drawing editor", exact: true })
    .click();
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Review notes" });
  const card = panel
    .getByRole("article")
    .filter({ hasText: "Image editing round trip" });
  await expect(card.getByRole("img")).toBeVisible();
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill(`Reply with preview\n![same image](${ref})`);
  await expect(
    editor.getByRole("region", { name: "Attached images" }).getByRole("img"),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(card.getByRole("img")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("bookmarks, full review search, references and context stay usable across navigation", async ({
  page,
}) => {
  await page.request.post(`${url}/api/note`, {
    data: {
      comment: {
        id: "|@|@|#refseed123",
        scope: "global",
        file: "",
        start: 0,
        end: 0,
        body: "Reference target",
      },
      ask: false,
    },
  });
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Code diff" });
  const nav = page.getByRole("complementary", { name: "Changed files" });
  await pane
    .locator('[data-file-path="src/app.ts"]')
    .getByRole("button", { name: "Bookmark line 2", exact: true })
    .last()
    .click();
  await expect(nav.getByText("Bookmarks · 1")).toBeVisible();
  await page.reload();
  await expect(nav.getByText("Bookmarks · 1")).toBeVisible();
  await nav
    .getByRole("button", { name: "Hide file src/app.ts", exact: true })
    .click();
  await expect(
    pane.getByRole("heading", { name: "src/app.ts", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search review", exact: true })
    .fill("hello world");
  await page
    .getByRole("region", { name: "Search this review" })
    .getByRole("button")
    .filter({ hasText: "Added · new 2" })
    .click();
  await expect(
    pane
      .locator('[data-file-path="src/app.ts"] [data-code-cell]')
      .filter({ hasText: "hello world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  const editor = page.locator("[data-review-editor]");
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("References and context audit #refseed");
  await editor
    .getByRole("listbox", { name: "Note references" })
    .getByRole("option")
    .click();
  const reference = "refseed123";
  await editor
    .getByText("Add context · file, text or JSON", { exact: true })
    .click();
  await editor
    .getByRole("textbox", { name: "Context label", exact: true })
    .fill("Debug details");
  await editor
    .getByRole("textbox", { name: "Additional context", exact: true })
    .fill("Some independently readable context");
  await editor
    .getByRole("button", { name: "Attach context", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    /context\/.*\/manifest.json/,
  );
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  const card = page
    .getByRole("complementary", { name: "Review notes" })
    .getByRole("article")
    .filter({ hasText: "References and context audit" });
  await card
    .getByRole("button")
    .filter({ hasText: `#${reference!.slice(-8)}` })
    .click();
  await expect(
    card.getByRole("button", { name: "Go to note", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", {
      name: "Additional context: Debug details · Inspect context",
      exact: true,
    })
    .click();
  await card.getByRole("button", { name: "Read text", exact: true }).click();
  await expect(
    card.getByText("Some independently readable context", { exact: true }),
  ).toBeVisible();
  // Deletion confirmation belongs to the card; it never invokes a native popup.
  await card.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(
    card.getByText("Delete this note and its conversation?", { exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Keep", exact: true }).click();
});

test("folder controls, color edits and local resolution preserve the underlying conversation", async ({
  page,
}) => {
  await page.request.delete(`${url}/api/review`);
  await page.request.post(`${url}/api/note`, {
    data: {
      comment: {
        id: "src/app.ts|n2|n2|#resolve123",
        file: "src/app.ts",
        start: 2,
        end: 2,
        side: "new",
        label: "2",
        code: "+  return 'hello world';",
        body: "Local acknowledgement audit",
      },
      ask: false,
    },
  });
  let review = await (await page.request.get(`${url}/api/review`)).json();
  const file = path.join(directory, review.file);
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      "Status: pending",
      "Status: answered\n\n**Agent** <!-- lcr:m 2026-11-11T10:00:00.000Z -->\n\nFirst answer.",
    ),
  );
  await page.goto(url);
  const nav = page.getByRole("navigation");
  await nav
    .getByRole("button", { name: "Collapse folders", exact: true })
    .click();
  await expect(nav.locator('button[title="src/app.ts"]')).toHaveCount(0);
  await nav
    .getByRole("button", { name: "Reveal current file", exact: true })
    .click();
  await expect(nav.locator('button[title="src/app.ts"]')).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Review notes" });
  const card = panel
    .getByRole("article")
    .filter({ hasText: "Local acknowledgement audit" });
  await expect(card.getByText("First answer.", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(card).toHaveCount(0);
  const resolved = panel.getByRole("checkbox", { name: /Show resolved/ });
  await resolved.check();
  await expect(
    card.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    card.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await resolved.uncheck();
  // A later agent message invalidates the local acknowledgement without changing its status on disk.
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      "First answer.",
      "First answer.\n\n**Agent** <!-- lcr:m 2026-11-11T11:00:00.000Z -->\n\nA new answer needs your attention.",
    ),
  );
  await expect(
    card.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("A new answer needs your attention.", { exact: true }),
  ).toBeVisible();
  review = await (await page.request.get(`${url}/api/review`)).json();
  expect(review.notes[0].messages).toHaveLength(2);
  expect(review.notes[0].status).toBe("answered");
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  const editor = page.locator("[data-review-editor]");
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Use #123456 for this border.");
  await editor.getByText("Colors · 1", { exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Color value #123456", exact: true })
    .fill("#22c55e80");
  await editor
    .getByRole("button", { name: "Apply color", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Use #22c55e80 for this border.",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("continuous scrolling follows files, reopens viewed files, and preserves the reading anchor", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saved = await (await page.request.get(`${url}/api/review`)).json();
  if (
    !saved.notes.some(
      (note: { body: string }) =>
        note.body === "Please **rename** this greeting.",
    )
  ) {
    await page.request.post(`${url}/api/note`, {
      data: {
        comment: {
          id: "src/app.ts|n2|n2|#scrolltest",
          file: "src/app.ts",
          start: 2,
          end: 2,
          side: "new",
          code: "+  return 'hello world';",
          body: "Please **rename** this greeting.",
        },
        ask: false,
      },
    });
  }
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Code diff", exact: true });
  const navigation = page.getByRole("navigation");
  const notesPanel = page.getByRole("complementary", { name: "Review notes" });
  await expect(pane).toHaveCount(1);
  await expect(
    navigation.locator('button[title="src/app.ts"]'),
  ).toHaveAttribute("aria-current", "true");
  await navigation.locator('button[title="src/app.ts"]').click();
  await expect(
    pane.getByRole("heading", { name: "src/app.ts", exact: true }),
  ).toBeInViewport();
  // One wheel gesture carries the review into subsequent files, without picking a file.
  await pane.hover();
  await page.mouse.wheel(0, 2000);
  await expect
    .poll(() => pane.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(500);
  await expect
    .poll(async () =>
      navigation.locator('[aria-current="true"]').getAttribute("title"),
    )
    .not.toBe("src/app.ts");
  // The end of the same scroll surface contains the final large file.
  await pane.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    navigation.locator('button[title="untracked.ts"]'),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    pane.getByRole("heading", { name: "untracked.ts", exact: true }),
  ).toBeVisible();
  expect(await pane.locator('[data-diff-kind="row"]').count()).toBeLessThan(
    100,
  );
  // A sidebar jump reuses that pane and reaches files even when their rows aren't mounted.
  await navigation.locator('button[title="src/app.ts"]').click();
  await expect(
    pane.getByRole("heading", { name: "src/app.ts", exact: true }),
  ).toBeVisible();
  await pane
    .getByRole("button", { name: "Mark viewed: src/app.ts", exact: true })
    .click();
  await expect(
    pane.getByRole("button", { name: "Expand src/app.ts", exact: true }),
  ).toBeVisible();
  await navigation.locator('button[title="src/app.ts"]').click();
  await expect(
    pane.getByRole("button", { name: "Collapse src/app.ts", exact: true }),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", {
      name: "Mark unviewed: src/app.ts",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  // The note list can bring an anchored conversation back into the stream.
  await pane
    .getByRole("button", { name: "Collapse src/app.ts", exact: true })
    .click();
  const codeNote = notesPanel
    .getByRole("article")
    .filter({ hasText: "Please rename this greeting." });
  await codeNote.getByRole("button", { name: "In diff", exact: true }).click();
  await expect(
    pane
      .getByRole("article")
      .filter({ hasText: "Please rename this greeting." }),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "Collapse src/app.ts", exact: true }),
  ).toBeVisible();
  // Each collapsed deletion has an explicit way to read it again.
  await navigation.locator('button[title="src/deleted.ts"]').click();
  const removedToggle = pane
    .locator('[data-file-path="src/deleted.ts"][data-diff-kind="tools"]')
    .getByRole("checkbox", { name: "Fold removed lines" });
  await removedToggle.check();
  await pane
    .getByRole("button", { name: "Show 1 removed lines", exact: true })
    .click();
  await expect(
    pane.getByRole("button", { name: "Hide 1 removed lines", exact: true }),
  ).toBeVisible();
  // Hold a middle row of a large file still while an earlier file grows.
  await navigation.locator('button[title="untracked.ts"]').click();
  await pane.evaluate((element) => {
    element.scrollTop += 26 * 600;
  });
  await expect(
    navigation.locator('button[title="untracked.ts"]'),
  ).toHaveAttribute("aria-current", "true");
  async function topRow() {
    return pane.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const header = element.querySelector<HTMLElement>('[data-sticky="true"]');
      const top = bounds.top + (header?.offsetHeight || 0);
      const row = [
        ...element.querySelectorAll<HTMLElement>('[data-diff-kind="row"]'),
      ].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= top - 1 && rect.bottom <= bounds.bottom;
      });
      return row
        ? {
            key: row.dataset.itemKey,
            y: row.getBoundingClientRect().top - bounds.top,
          }
        : null;
    });
  }
  await expect.poll(topRow).not.toBeNull();
  const before = (await topRow())!;
  const source = await readFile(path.join(directory, "src/app.ts"), "utf8");
  await writeFile(
    path.join(directory, "src/app.ts"),
    source +
      Array.from(
        { length: 200 },
        (_, i) => `export const extra${i} = ${i};`,
      ).join("\n") +
      "\n",
  );
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${url}/api/diff`)).json()).files.find(
          (file: { path: string }) => file.path === "src/app.ts",
        ).rows.length,
    )
    .toBeGreaterThan(200);
  await expect.poll(async () => (await topRow())?.key).toBe(before.key);
  await expect
    .poll(async () => Math.abs(((await topRow())?.y || 0) - before.y))
    .toBeLessThan(2);
  // A diff refresh is deferred while an editor owns the selected subject and text.
  await pane
    .getByRole("button", { name: /Comment on line/ })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Do not replace my subject while I write.");
  await writeFile(
    path.join(directory, "src/app.ts"),
    source + "export const changedAgain = true;\n",
  );
  await expect(
    page.getByText("Diff update waiting for the open editor to close."),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Do not replace my subject while I write.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Diff update waiting for the open editor to close."),
  ).toHaveCount(0);
  await expect(
    navigation.locator('button[title="untracked.ts"]'),
  ).toHaveAttribute("aria-current", "true");
  await page.screenshot({ path: "/tmp/lcr-continuous-ui.png" });
  expect(errors).toEqual([]);
});

test("image-region comments, audio playback, preferences and the resume marker remain available", async ({
  page,
}) => {
  await writeFile(
    path.join(directory, "screenshot.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="white"/><rect x="30" y="30" width="90" height="60" fill="#22c55e"/></svg>',
  );
  const wav = Buffer.alloc(46);
  wav.write("RIFF");
  wav.writeUInt32LE(38, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(2, 40);
  await writeFile(path.join(directory, "sound.wav"), wav);
  await page.goto(url);
  const nav = page.getByRole("navigation");
  const pane = page.getByRole("region", { name: "Code diff" });
  await nav.locator('button[title="screenshot.svg"]').click();
  const image = pane.getByRole("img", {
    name: "After: screenshot.svg",
    exact: true,
  });
  await expect(image).toBeInViewport();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(240);
  const box = await image.boundingBox();
  await page.mouse.move(box!.x + 30, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 90, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator("[data-review-editor]");
  await expect(
    editor.getByRole("img", {
      name: "Selected screenshot region",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Screenshot region round trip");
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const review = await (await page.request.get(`${url}/api/review`)).json();
  const note = review.notes.find(
    (note: any) => note.body === "Screenshot region round trip",
  );
  expect(note.image).toMatchObject({
    side: "new",
    x: 30,
    y: 30,
    width: 90,
    height: 60,
    imageWidth: 240,
    imageHeight: 160,
  });
  await nav.locator('button[title="sound.wav"]').click();
  await expect(pane.locator("audio[controls]")).toBeVisible();
  expect(
    (
      await page.request.get(
        new URL((await pane.locator("audio").getAttribute("src"))!, url).href,
      )
    ).headers()["content-type"],
  ).toBe("audio/wav");
  await nav.locator('button[title="untracked.ts"]').click();
  await expect(
    pane.getByRole("button", { name: "Comment on line 5", exact: true }),
  ).toBeInViewport();
  await pane.hover();
  await page.mouse.wheel(0, 260);
  const resume = page.getByRole("button", {
    name: "Resume reading",
    exact: true,
  });
  await expect(resume).toBeVisible();
  await page.reload();
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(nav.locator('button[title="untracked.ts"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("checkbox", {
      name: "Enter saves · Shift+Enter inserts a newline",
      exact: true,
    })
    .check();
  await settings
    .getByRole("combobox", { name: "Context expansion", exact: true })
    .click();
  await page.getByRole("option", { name: "50 lines", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Overall note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Enter preference saves inline");
  await page.getByRole("textbox", { name: "Note text" }).press("Enter");
  await expect(editor).toHaveCount(0);
});

test("Base UI focus and pane resizing preserve drafts, reading position and saved widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.hover();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "External editor", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await settings.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 300);
  await expect(dialog).toHaveCount(0);

  const files = page.getByRole("complementary", { name: "Changed files" });
  const notes = page.getByRole("complementary", { name: "Review notes" });
  const left = page.getByRole("separator", {
    name: "Resize file sidebar",
    exact: true,
  });
  const right = page.getByRole("separator", {
    name: "Resize conversation pane",
    exact: true,
  });
  const width = (locator: typeof files) =>
    locator.evaluate((element) => element.getBoundingClientRect().width);
  const initialLeft = await width(files),
    initialRight = await width(notes);
  async function drag(handle: typeof left, delta: number) {
    const box = await handle.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + delta,
      box!.y + box!.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  }
  await drag(left, 100);
  await expect.poll(() => width(files)).toBeCloseTo(initialLeft + 100, 0);
  await expect.poll(() => width(notes)).toBeCloseTo(initialRight, 0);
  await drag(right, -100);
  await expect.poll(() => width(notes)).toBeCloseTo(initialRight + 100, 0);
  const savedLeft = await width(files),
    savedRight = await width(notes);
  await page.reload();
  await expect.poll(() => width(files)).toBeCloseTo(savedLeft, 0);
  await expect.poll(() => width(notes)).toBeCloseTo(savedRight, 0);
  await left.focus();
  await left.press("ArrowRight");
  await expect.poll(() => width(files)).toBeGreaterThan(savedLeft + 1);
  await left.press("Home");
  await expect.poll(() => width(files)).toBeCloseTo(180, 0);
  await left.dblclick();
  await right.dblclick();
  await expect.poll(() => width(files)).toBeCloseTo(256, 0);
  await expect.poll(() => width(notes)).toBeCloseTo(390, 0);

  const pane = page.getByRole("region", { name: "Code diff" });
  await page
    .getByRole("navigation")
    .locator('button[title="untracked.ts"]')
    .click();
  await expect(
    pane.getByRole("heading", { name: "untracked.ts", exact: true }),
  ).toBeInViewport();
  await pane.evaluate((element) => (element.scrollTop += 26 * 250));
  async function topRow() {
    return pane.evaluate((element) => {
      const top =
        element.getBoundingClientRect().top +
        (element.querySelector<HTMLElement>('[data-sticky="true"]')
          ?.offsetHeight || 0);
      const row = [
        ...element.querySelectorAll<HTMLElement>('[data-diff-kind="row"]'),
      ].find((row) => row.getBoundingClientRect().top >= top - 1);
      return row
        ? { key: row.dataset.itemKey, y: row.getBoundingClientRect().top - top }
        : null;
    });
  }
  await expect.poll(topRow).not.toBeNull();
  const before = (await topRow())!;
  await drag(left, 80);
  await drag(right, 60);
  await expect.poll(async () => (await topRow())?.key).toBe(before.key);
  await expect
    .poll(async () => Math.abs((await topRow())!.y - before.y))
    .toBeLessThan(2);
  await pane
    .getByRole("button", { name: /Comment on line/ })
    .first()
    .click();
  const text = page.getByRole("textbox", { name: "Note text", exact: true });
  await text.fill("Preserve this draft while resizing panels");
  await text.evaluate((text: HTMLTextAreaElement) =>
    text.setSelectionRange(9, 13),
  );
  await drag(left, -40);
  await drag(right, -40);
  await expect(text).toHaveValue("Preserve this draft while resizing panels");
  expect(
    await text.evaluate((text: HTMLTextAreaElement) => [
      text.selectionStart,
      text.selectionEnd,
    ]),
  ).toEqual([9, 13]);
  const desktopLeft = await width(files),
    desktopRight = await width(notes);
  await page
    .getByRole("button", { name: "Hide file sidebar", exact: true })
    .click();
  await expect(left).toHaveCount(0);
  await expect(text).toHaveValue("Preserve this draft while resizing panels");
  await page
    .getByRole("button", { name: "Show file sidebar", exact: true })
    .click();
  await expect(left).toBeVisible();
  await expect.poll(() => width(files)).toBeCloseTo(desktopLeft, 0);
  await expect.poll(() => width(notes)).toBeCloseTo(desktopRight, 0);
  const notesToggle = page.getByRole("button", {
    name: /^(Hide|Show) notes panel$/,
  });
  await notesToggle.click();
  await expect(right).toHaveCount(0);
  await expect(text).toHaveValue("Preserve this draft while resizing panels");
  await notesToggle.click();
  await expect(right).toBeVisible();
  await expect.poll(() => width(notes)).toBeCloseTo(desktopRight, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("separator")).toHaveCount(0);
  await expect(text).toHaveValue("Preserve this draft while resizing panels");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect.poll(() => width(files)).toBeCloseTo(desktopLeft, 0);
  await expect.poll(() => width(notes)).toBeCloseTo(desktopRight, 0);
  await expect(text).toHaveValue("Preserve this draft while resizing panels");
  await page
    .locator("[data-review-editor]")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.screenshot({ path: "/tmp/lcr-base-ui-resizable.png" });
  expect(errors).toEqual([]);
});

test("overall notes and formatting tools preserve the code reading position", async ({
  page,
}) => {
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Code diff" });
  await page
    .getByRole("navigation")
    .locator('button[title="untracked.ts"]')
    .click();
  await expect(
    pane.getByRole("heading", { name: "untracked.ts", exact: true }),
  ).toBeInViewport();
  await pane.evaluate((element) => (element.scrollTop += 26 * 300));
  async function position() {
    return pane.evaluate((element) => {
      const top =
        element.getBoundingClientRect().top +
        (element.querySelector<HTMLElement>('[data-sticky="true"]')
          ?.offsetHeight || 0);
      const row = [
        ...element.querySelectorAll<HTMLElement>('[data-diff-kind="row"]'),
      ].find((row) => row.getBoundingClientRect().top >= top - 1);
      return row
        ? { key: row.dataset.itemKey, y: row.getBoundingClientRect().top - top }
        : null;
    });
  }
  await expect.poll(position).not.toBeNull();
  const before = (await position())!;
  const scrollTop = await pane.evaluate((element) => element.scrollTop);
  const notes = page.getByRole("region", { name: "Overall note editor" });
  const overall = page.getByRole("button", {
    name: "Overall note",
    exact: true,
  });
  await overall.click();
  const editor = notes.locator("[data-review-editor]");
  const text = editor.getByRole("textbox", { name: "Note text", exact: true });
  await expect(text).toBeFocused();
  await expect
    .poll(() => pane.evaluate((element) => element.scrollTop))
    .toBe(scrollTop);
  const toolbar = editor.getByRole("toolbar", { name: "Text formatting" });
  const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
  await expect(bold.locator("svg")).toBeVisible();
  await expect(bold).toHaveText("");
  await text.fill("Overall feedback without losing my place");
  await text.evaluate((field: HTMLTextAreaElement) =>
    field.setSelectionRange(0, 7),
  );
  await bold.click();
  await expect(text).toHaveValue(
    "**Overall** feedback without losing my place",
  );
  await toolbar.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("Overall");
  await toolbar.getByRole("button", { name: "Write", exact: true }).click();
  await expect(text).toBeFocused();
  await page.screenshot({ path: "/tmp/lcr-overall-composer.png" });
  await expect.poll(position).toEqual(before);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(position).toEqual(before);
  await overall.click();
  await text.fill("Save overall feedback without jumping");
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await position())?.key).toBe(before.key);
  await expect
    .poll(async () => Math.abs((await position())!.y - before.y))
    .toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTop = await pane.evaluate((element) => element.scrollTop);
  await overall.click();
  await expect(text).toBeVisible();
  await page.screenshot({ path: "/tmp/lcr-overall-composer-mobile.png" });
  await expect
    .poll(() => pane.evaluate((element) => element.scrollTop))
    .toBe(mobileTop);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("live page capture keeps its editor at the bottom and previews images across the viewport", async ({
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
    const iframe = target.locator('iframe[title="New visual review note"]');
    const input = frame.getByRole("textbox", {
      name: "Note text",
      exact: true,
    });
    const evidence = frame.getByRole("region", {
      name: "Evidence and attachments",
    });
    const inputY = (await input.boundingBox())!.y;
    await frame.getByText("Selection details", { exact: true }).click();
    await evidence.evaluate(
      (element) => (element.scrollTop = element.scrollHeight),
    );
    expect((await input.boundingBox())!.y).toBeCloseTo(inputY, 0);
    await expect(
      frame.getByRole("button", { name: "Save note", exact: true }),
    ).toBeInViewport();
    await input.fill(
      Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n"),
    );
    expect((await input.boundingBox())!.height).toBeLessThanOrEqual(200);
    await expect(
      frame.getByRole("button", { name: "Save note", exact: true }),
    ).toBeInViewport();
    await input.fill("Keep this draft through fullscreen previews");
    await target.screenshot({ path: "/tmp/lcr-web-composer.png" });
    const panel = (await iframe.boundingBox())!;
    await frame
      .getByRole("link", { name: "Preview Selection 1", exact: true })
      .click();
    const viewer = frame.locator("dialog.image-viewer");
    await expect(viewer).toBeVisible();
    await expect
      .poll(async () => (await iframe.boundingBox())!.width)
      .toBe(1200);
    await expect
      .poll(async () => (await iframe.boundingBox())!.height)
      .toBe(900);
    expect((await viewer.boundingBox())!.width).toBeGreaterThan(1100);
    await target.screenshot({ path: "/tmp/lcr-web-image-preview.png" });
    await viewer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await expect.poll(() => iframe.boundingBox()).toEqual(panel);
    await expect(input).toHaveValue(
      "Keep this draft through fullscreen previews",
    );
    // Browser Back also restores the panel, and a preview can hand over to drawing without shrinking it.
    await frame
      .getByRole("link", { name: "Preview Selection 1", exact: true })
      .click();
    await expect
      .poll(async () => (await iframe.boundingBox())!.width)
      .toBe(1200);
    await input.evaluate(() => history.back());
    await expect(viewer).toHaveCount(0);
    await expect.poll(() => iframe.boundingBox()).toEqual(panel);
    await frame
      .getByRole("link", { name: "Preview Selection 1", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "Draw / edit", exact: true })
      .click();
    const drawing = frame.getByRole("dialog", {
      name: "Draw on screenshot",
      exact: true,
    });
    await expect(drawing).toBeVisible();
    await expect
      .poll(async () => (await iframe.boundingBox())!.width)
      .toBe(1200);
    await drawing
      .getByRole("button", { name: "Close drawing editor", exact: true })
      .click();
    await expect(drawing).toHaveCount(0);
    await expect.poll(() => iframe.boundingBox()).toEqual(panel);
    await expect(input).toHaveValue(
      "Keep this draft through fullscreen previews",
    );
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
    const card = page
      .getByRole("complementary", { name: "Review notes" })
      .getByRole("article")
      .filter({ hasText: "Increase this checkout target size." });
    await expect(card).toBeVisible();
    await target
      .locator("#target")
      .evaluate((element) => (element.style.backgroundColor = "#22c55e"));
    await card
      .getByRole("button", { name: "Capture after", exact: true })
      .click();
    const reply = page.locator("[data-review-editor]");
    await expect(reply).toBeVisible();
    await page
      .getByRole("textbox", { name: "Note text" })
      .fill("Updated checkout appearance.");
    await reply
      .getByRole("button", { name: "Send reply", exact: true })
      .click();
    await expect(reply).toHaveCount(0);
    await expect(
      card.getByText("Updated checkout appearance.", { exact: true }),
    ).toBeVisible();
    await card
      .getByText("Compare original screenshots", { exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Wipe", exact: true }),
    ).toBeEnabled();
    await card.getByRole("button", { name: "Wipe", exact: true }).click();
    await expect(
      card.getByRole("slider", { name: "Comparison wipe", exact: true }),
    ).toBeVisible();
  } finally {
    await stop();
    await context.close();
    await new Promise<void>((resolve) => app.close(() => resolve()));
  }
});
