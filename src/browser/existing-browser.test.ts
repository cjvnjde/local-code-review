import { afterEach, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachReviewBrowser,
  browserEndpoint,
  chromeDataDir,
} from "./existing-browser.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("existing Chrome discovery follows platform data directories", () => {
  expect(chromeDataDir("darwin", {}, "/home")).toBe(
    path.join("/home", "Library/Application Support/Google/Chrome"),
  );
  expect(chromeDataDir("win32", { LOCALAPPDATA: "/local" }, "/home")).toBe(
    path.join("/local", "Google/Chrome/User Data"),
  );
  expect(chromeDataDir("win32", {}, "/home")).toBe(
    path.join("/home", "AppData/Local/Google/Chrome/User Data"),
  );
  expect(chromeDataDir("linux", {}, "/home")).toBe(
    path.join("/home", ".config/google-chrome"),
  );
  expect(chromeDataDir("linux", { XDG_CONFIG_HOME: "/xdg" }, "/home")).toBe(
    path.join("/xdg", "google-chrome"),
  );
  expect(
    chromeDataDir(
      "linux",
      { XDG_CONFIG_HOME: "relative", CHROME_CONFIG_HOME: "/chrome" },
      "/home",
    ),
  ).toBe(path.join("/chrome", "google-chrome"));
});

test("discovered endpoints are strictly loopback browser sockets, including approval-only paths", () => {
  expect(browserEndpoint("9222\n/devtools/browser/token-123\n")).toBe(
    "ws://127.0.0.1:9222/devtools/browser/token-123",
  );
  expect(browserEndpoint(" 9222\r\n/devtools/browser\r\n")).toBe(
    "ws://127.0.0.1:9222/devtools/browser",
  );
  for (const source of [
    "",
    "0\n/devtools/browser/x",
    "65536\n/devtools/browser/x",
    "3.4\n/devtools/browser/x",
    "1e3\n/devtools/browser/x",
    "9222\n//remote.example/x",
    "9222\n/devtools/page/x",
    "9222\n/devtools/browser/x?secret",
    "9222\n/devtools/browser/../../x",
    "9222\n/devtools/browser/x\nextra",
  ])
    expect(() => browserEndpoint(source)).toThrow("Invalid DevToolsActivePort");
});

test("missing connection discovery never creates or changes a browser data directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-existing-missing-"));
  roots.push(root);
  await expect(attachReviewBrowser(root)).rejects.toThrow(
    "chrome://inspect/#remote-debugging",
  );
  expect(await readdir(root)).toEqual([]);
  const absent = path.join(root, "absent");
  await expect(attachReviewBrowser(absent)).rejects.toThrow(
    "--browser-data-dir",
  );
  expect(await readdir(root)).toEqual([]);
});

test.each([true, false])(
  "existing attachment waits for Chrome's consent (%s) and never sends Browser.close",
  async (allow) => {
    const root = await mkdtemp(path.join(tmpdir(), "lcr-existing-consent-"));
    roots.push(root);
    const gate = Promise.withResolvers<boolean>();
    const requested = Promise.withResolvers<void>();
    const methods: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request, server) {
        requested.resolve();
        if ((await gate.promise) && server.upgrade(request)) return;
        return new Response("Denied", { status: 403 });
      },
      websocket: {
        message(socket, raw) {
          const message = JSON.parse(String(raw));
          methods.push(message.method);
          socket.send(
            JSON.stringify({
              id: message.id,
              result: { product: "ExistingChrome/144" },
            }),
          );
        },
      },
    });
    const file = path.join(root, "DevToolsActivePort"),
      source = `${server.port}\n/devtools/browser/consent\n`;
    await writeFile(file, source);
    const before = await stat(root);
    let settled = false;
    const pending = attachReviewBrowser(root).then((browser) => {
      settled = true;
      return browser;
    });
    const result = Promise.allSettled([pending]);
    try {
      await requested.promise;
      expect(settled).toBe(false);
      gate.resolve(allow);
      if (allow) {
        const browser = await pending;
        expect(await browser.cdp.send("Browser.getVersion")).toEqual({
          product: "ExistingChrome/144",
        });
        await browser.close();
        expect(methods).toEqual(["Browser.getVersion"]);
      } else {
        expect((await result)[0].status).toBe("rejected");
        await expect(pending).rejects.toThrow(
          "Allow the connection in Chrome's dialog",
        );
      }
      expect(await readFile(file, "utf8")).toBe(source);
      expect((await stat(root)).mode).toBe(before.mode);
      expect(await readdir(root)).toEqual(["DevToolsActivePort"]);
    } finally {
      gate.resolve(false);
      server.stop(true);
    }
  },
);
