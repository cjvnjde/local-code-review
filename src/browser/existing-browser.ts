import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Cdp } from "./cdp.ts";

/** The browser owns this directory. Discovery must never create, chmod, lock or delete in it. */
export function chromeDataDir(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string {
  if (platform === "darwin")
    return path.join(home, "Library/Application Support/Google/Chrome");
  if (platform === "win32")
    return path.join(
      env.LOCALAPPDATA || path.join(home, "AppData/Local"),
      "Google/Chrome/User Data",
    );
  const base = [env.CHROME_CONFIG_HOME, env.XDG_CONFIG_HOME].find(
    (dir) => dir && path.isAbsolute(dir),
  );
  return path.join(base || path.join(home, ".config"), "google-chrome");
}

export function browserEndpoint(source: string): string {
  const lines = source
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
  const port = Number(lines[0]);
  if (
    lines.length !== 2 ||
    !/^\d+$/.test(lines[0] || "") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^\/devtools\/browser(?:\/[\w-]+)?$/.test(lines[1] || "")
  )
    throw new Error(
      "Invalid DevToolsActivePort. Re-enable remote debugging in Chrome and retry.",
    );
  return `ws://127.0.0.1:${port}${lines[1]}`;
}

export async function attachReviewBrowser(
  dataDir = chromeDataDir(),
  signal?: AbortSignal,
) {
  let source: string;
  try {
    source = await readFile(path.join(dataDir, "DevToolsActivePort"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM")
      throw new Error(
        `Cannot read Chrome's connection file in ${dataDir}. Allow your terminal access to Chrome's data in OS privacy settings, or use --browser-data-dir for the running browser.`,
      );
    throw new Error(
      `No readable browser connection in ${dataDir}. Start Chrome 144+, enable remote debugging at chrome://inspect/#remote-debugging, and retry. Use --browser-data-dir for another browser's user data directory.`,
    );
  }
  const endpoint = browserEndpoint(source);
  try {
    const cdp = await Cdp.connect(endpoint, { timeout: 60000, signal });
    return {
      cdp,
      async close() {
        cdp.close();
      },
    };
  } catch (error) {
    throw new Error(
      `Could not attach to Chrome. Allow the connection in Chrome's dialog; check chrome://inspect/#remote-debugging if it was denied, revoked, or timed out. ${(error as Error).message}`,
    );
  }
}
