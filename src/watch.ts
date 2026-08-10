import { existsSync, watch } from "node:fs";

export interface Watcher {
  close(): void;
}

/** Paths that change constantly and never change what the review shows. */
const NOISE = /(^|\/)(\.git|node_modules|\.next|\.turbo|dist|build|target|__pycache__)(\/|$)/;

export function isNoise(relative: string): boolean {
  return NOISE.test(relative.split("\\").join("/"));
}

/**
 * A debounced change signal for a directory tree. Recursive watching is not available everywhere, so
 * a platform that refuses it falls back to a slow tick: `onChange` decides for itself whether
 * anything actually moved, which makes both paths behave the same from the outside.
 */
export function watchTree(
  root: string,
  onChange: () => void,
  options: { ignore?: (relative: string) => boolean; delay?: number; poll?: number } = {},
): Watcher {
  const { ignore = isNoise, delay = 350, poll = 2000 } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, delay);
  };

  try {
    const watcher = watch(root, { recursive: true }, (_event, file) => {
      if (typeof file === "string" && ignore(file)) return;
      fire();
    });
    watcher.on("error", () => {});
    return {
      close() {
        if (timer) clearTimeout(timer);
        watcher.close();
      },
    };
  } catch {
    const tick = setInterval(onChange, poll);
    return {
      close() {
        if (timer) clearTimeout(timer);
        clearInterval(tick);
      },
    };
  }
}

/**
 * Watches one directory that may not exist yet — the output directory is only created by the first
 * save — and keeps trying until it does.
 */
export function watchDir(dir: string, onChange: (file: string) => void, delay = 120): Watcher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setInterval> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let last = "";
  let closed = false;

  const fire = (file: string) => {
    last = file;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onChange(last);
      // Deleting the directory kills the watcher, on most platforms without a word; the events
      // its contents fired on the way out are the cue to start waiting for it to come back.
      if (!existsSync(dir)) detach();
    }, delay);
  };

  const rearm = () => {
    if (closed || retry) return;
    retry = setInterval(() => {
      if (attach() && retry) {
        clearInterval(retry);
        retry = null;
      }
    }, 1000);
  };

  /** A watcher that died is let go and re-attached when the directory allows it again. */
  const detach = () => {
    watcher?.close();
    watcher = null;
    rearm();
  };

  const attach = () => {
    if (closed || watcher) return true;
    if (!existsSync(dir)) return false;
    try {
      watcher = watch(dir, (_event, file) => {
        if (typeof file === "string") fire(file);
      });
      watcher.on("error", detach);
      return true;
    } catch {
      return false;
    }
  };

  if (!attach()) rearm();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (retry) clearInterval(retry);
      watcher?.close();
    },
  };
}
