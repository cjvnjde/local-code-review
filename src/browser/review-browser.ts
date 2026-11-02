import { chmod, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Cdp } from "./cdp.ts";

export interface ReviewBrowser {
  cdp: Cdp;
  child?: ReturnType<typeof Bun.spawn>;
  close(): Promise<void>;
}

export function chromeCandidates(platform = process.platform): string[] {
  if (process.env.LCR_BROWSER_PATH) return [process.env.LCR_BROWSER_PATH];
  if (platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  if (platform === "win32")
    return [
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Google/Chrome/Application/chrome.exe",
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Microsoft/Edge/Application/msedge.exe",
      ),
    ];
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
  ];
}
export async function launchReviewBrowser(
  profile: string,
  extraArgs: string[] = [],
) {
  const executable = chromeCandidates()
    .map((candidate) => Bun.which(candidate))
    .find(Boolean);
  if (!executable)
    throw new Error(
      "Chrome/Chromium was not found. Install it or set LCR_BROWSER_PATH to its executable.",
    );
  await mkdir(profile, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(profile, 0o700);
  const lockFile = path.join(profile, ".lcr-owner.lock");
  const lock = await open(lockFile, "wx", 0o600).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      `Browser profile is already in use, or a previous lcr run crashed. Check ${lockFile}; only remove it after verifying that lcr and its browser have stopped. Use --browser-profile project for an isolated run.`,
    );
  });
  let releasing: Promise<void> | undefined;
  const release = () =>
    (releasing ??= lock.close().finally(() => rm(lockFile, { force: true })));
  const active = path.join(profile, "DevToolsActivePort");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
    );
    // Only the owner may discard a stale endpoint; another run must leave it alone.
    await rm(active, { force: true });
    const launched = Bun.spawn(
      [
        executable,
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        ...extraArgs,
        "about:blank",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );
    child = launched;
    void launched.exited.then(release).catch(() => {});
    let endpoint = "";
    for (let i = 0; i < 150; i++) {
      if (launched.exitCode !== null)
        throw new Error(
          `The review browser exited. Close any other browser using ${profile} and retry, or use --browser-profile project.`,
        );
      const lines = (await readFile(active, "utf8").catch(() => ""))
        .trim()
        .split("\n");
      if (
        /^\d+$/.test(lines[0] || "") &&
        /^\/devtools\/browser\/[\w-]+$/.test(lines[1] || "")
      ) {
        endpoint = "ws://127.0.0.1:" + lines[0] + lines[1];
        break;
      }
      await Bun.sleep(100);
    }
    if (!endpoint)
      throw new Error(
        "Chrome did not expose its review connection within 15 seconds.",
      );
    const cdp = await Cdp.connect(endpoint);
    return {
      cdp,
      child: launched,
      async close() {
        // Chrome flushes cookies and storage while exiting. Killing after the CDP reply can
        // discard that state; allow a graceful exit before falling back to termination.
        const timeout = setTimeout(() => launched.kill(), 3000);
        try {
          await cdp.send("Browser.close").catch(() => {});
          await launched.exited;
        } finally {
          clearTimeout(timeout);
          cdp.close();
          await release();
        }
      },
    };
  } catch (error) {
    if (child) {
      child.kill();
      await child.exited;
    }
    await release();
    throw error;
  }
}
