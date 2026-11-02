import { esc } from "../app/state.ts";

/* ---------- paths that keep both ends in view ---------- */

const ELLIPSIS = "…";

/** The shortest useful form of a path: its beginning and its complete final segment. */
function shortestPath(path: string, separator = "/") {
  const slash = path.lastIndexOf(separator);
  if (slash < (separator === "/" ? 3 : 1)) return path;
  return Array.from(path)[0] + ELLIPSIS + path.slice(slash);
}

/**
 * Removes one contiguous run from the middle of a path until it fits. The file name is outside the
 * removable run, so it never acquires an ellipsis of its own; the kept directory characters are
 * balanced between the beginning and end, like a native middle-truncated label.
 * Component paths use their arrow separator to keep the final component intact instead.
 */
export function middleElidePath(
  path: string,
  fits: (text: string) => boolean,
  separator = "/",
) {
  const text = String(path),
    chars = Array.from(text),
    slash = text.lastIndexOf(separator);
  if (fits(text) || slash < (separator === "/" ? 3 : 1)) return text;

  const name = Array.from(text.slice(slash));
  const directory = chars.slice(0, chars.length - name.length);
  const candidate = (removed: number) => {
    const kept = directory.length - removed;
    const left = Math.ceil(kept / 2),
      right = Math.floor(kept / 2);
    return (
      directory.slice(0, left).join("") +
      ELLIPSIS +
      directory.slice(directory.length - right).join("") +
      name.join("")
    );
  };

  let low = 1,
    high = directory.length - 1,
    answer = shortestPath(text, separator);
  while (low <= high) {
    const removed = Math.floor((low + high) / 2),
      next = candidate(removed);
    if (fits(next)) {
      answer = next;
      high = removed - 1;
    } else low = removed + 1;
  }
  return answer;
}

type PathOptions = {
  className?: "from" | "to" | "was";
  title?: string;
  separator?: string;
};

/** One measured label; `watchPaths` decides how much of its middle can be shown once it is mounted. */
export function pathHtml(path: unknown, options: PathOptions = {}) {
  const text = String(path),
    cls = "pth" + (options.className ? " " + options.className : "");
  return (
    '<span class="' +
    cls +
    '"' +
    (options.title ? ' title="' + esc(options.title) + '"' : "") +
    (options.separator
      ? ' data-path-separator="' + esc(options.separator) + '"'
      : "") +
    ' data-path="' +
    esc(text) +
    '"><span class="ptx">' +
    esc(text) +
    "</span></span>"
  );
}

/** A rename names both sides of the move, while every other file keeps its ordinary path. */
export const filePathHtml = (file: { path: string; from?: string }) =>
  file.from && file.from !== file.path
    ? pathHtml(file.from, { className: "from" }) +
      '<span class="arrow">→</span>' +
      pathHtml(file.path, { className: "to" })
    : pathHtml(file.path);
export const filePathTitle = (file: { path: string; from?: string }) =>
  file.from && file.from !== file.path
    ? file.from + " → " + file.path
    : file.path;

/** Measures with the rendered font instead of guessing from character counts. */
function measure(label: HTMLElement, text: string) {
  label.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(label);
  return range.getBoundingClientRect().width;
}

/** The outer rename label is another flex item, so it reserves the minimums of both path sides. */
function reserveFileNames(container: HTMLElement) {
  const group = container.parentElement;
  if (!group || !group.classList.contains("file-path")) return;
  const required = [...group.children].reduce((width, child) => {
    if (!(child instanceof HTMLElement)) return width;
    return (
      width +
      (child.classList.contains("pth")
        ? parseFloat(child.style.minWidth) || 0
        : child.getBoundingClientRect().width)
    );
  }, 0);
  const minWidth = Math.ceil(required) + "px";
  if (group.style.minWidth !== minWidth) group.style.minWidth = minWidth;
}

function fitPath(container: HTMLElement) {
  const label = container.querySelector<HTMLElement>(".ptx");
  if (!label) return;
  const path = container.dataset.path || "",
    separator = container.dataset.pathSeparator || "/";
  const required = Math.ceil(measure(label, shortestPath(path, separator)));
  const minWidth = required + "px";
  if (container.style.minWidth !== minWidth)
    container.style.minWidth = minWidth;
  reserveFileNames(container);
  const available = container.getBoundingClientRect().width + 0.5;
  label.textContent = middleElidePath(
    path,
    (text) => measure(label, text) <= available,
    separator,
  );
}

/**
 * Paths are created by several independent renders. One observer adopts each label as it appears.
 * Resize delivery only queues work: reserving filename minimums can resize the observed paths, so
 * fitting runs once per path in the next frame, outside the observer's layout-delivery loop.
 */
export function watchPaths() {
  const pending = new Set<HTMLElement>();
  let frame: number | undefined;
  const schedule = (path: HTMLElement) => {
    if (!path.isConnected) return;
    pending.add(path);
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const paths = [...pending];
      pending.clear();
      paths.forEach((path) => {
        if (path.isConnected) fitPath(path);
      });
    });
  };
  const resize = new ResizeObserver((entries) =>
    entries.forEach((entry) => schedule(entry.target as HTMLElement)),
  );
  const adopt = (path: HTMLElement) => {
    if (!path.isConnected) return;
    resize.observe(path);
    schedule(path);
  };
  const visit = (node: Node, observe: boolean) => {
    if (!(node instanceof Element)) return;
    const paths = [
      ...(node.matches(".pth[data-path]") ? [node] : []),
      ...node.querySelectorAll<HTMLElement>(".pth[data-path]"),
    ];
    paths.forEach((path) => {
      if (observe) adopt(path as HTMLElement);
      else if (!path.isConnected) {
        resize.unobserve(path);
        pending.delete(path as HTMLElement);
      }
    });
  };
  document.querySelectorAll<HTMLElement>(".pth[data-path]").forEach(adopt);
  new MutationObserver((entries) =>
    entries.forEach((entry) => {
      entry.addedNodes.forEach((node) => visit(node, true));
      entry.removedNodes.forEach((node) => visit(node, false));
    }),
  ).observe(document.body, { childList: true, subtree: true });
}
