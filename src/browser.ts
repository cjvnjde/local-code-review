/**
 * Command that hands a URL to the platform's default browser. Returns `null` for anything that is
 * not a plain HTTP(S) URL so no unexpected value can reach the launcher.
 */
export function browserCommand(url: string, platform: string = process.platform): string[] | null {
  if (!/^https?:\/\/[^\s"]+$/.test(url)) return null;
  if (platform === "darwin") return ["open", url];
  if (platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}

/**
 * Best-effort launch of the review page. Never waits on the handler and never throws: a missing
 * `xdg-open` or a headless session only means the printed URL has to be opened by hand.
 */
export function openInBrowser(url: string): boolean {
  const command = browserCommand(url);
  if (!command) return false;
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
