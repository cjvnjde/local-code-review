import type { UiSettings } from "../../../shared/settings.ts";

const cache = new Map<string, RegExp | null>();
/**
 * Glob subset: `*` stays inside one path segment, `**` crosses segments, `?` is one character.
 * A pattern without `/` matches the file name anywhere; a trailing `/` means everything below it.
 */
export function globRx(pattern: string) {
  if (cache.has(pattern)) return cache.get(pattern);
  let p = pattern.trim();
  if (p.startsWith("./")) p = p.slice(2);
  if (!p || p.startsWith("#")) {
    cache.set(pattern, null);
    return null;
  }
  const anchored = p.includes("/") && !p.endsWith("/");
  if (p.endsWith("/")) p += "**";
  let body = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] !== "*") {
        body += "[^/]*";
        continue;
      }
      i++;
      if (p[i + 1] === "/") {
        i++;
        body += "(?:[^/]+/)*";
      } // `a/**/b` also matches `a/b`
      else body += ".*";
    } else if (c === "?") body += "[^/]";
    else body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const rx = new RegExp("^" + (anchored ? "" : "(?:.*/)?") + body + "$");
  cache.set(pattern, rx);
  return rx;
}
export const hidePatterns = (text: string) => [
  ...new Set(
    String(text || "")
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("#")),
  ),
];
function compileHide(text: string, disabled: string[]) {
  const off = new Set(disabled);
  return hidePatterns(text)
    .filter((p) => !off.has(p))
    .flatMap((pattern) => {
      const rx = globRx(pattern);
      return rx ? [{ pattern, rx }] : [];
    });
}

/** A boolean is a manual eye setting. A list records the globs explicitly bypassed for one file. */
export type VisibilityOverrides = Record<string, boolean | string[]>;

export function filterFiles<T extends { path: string; status: string }>(
  files: readonly T[],
  settings: Pick<
    UiSettings,
    "hide" | "disabledHide" | "hideEnabled" | "hideDeleted"
  >,
  overrides: Readonly<VisibilityOverrides>,
) {
  const patterns = settings.hideEnabled
    ? compileHide(settings.hide, settings.disabledHide)
    : [];
  const treeFiles: T[] = [];
  const visibleFiles: T[] = [];
  const hiddenPaths = new Set<string>();
  const matchedRules = new Map<string, string[]>();
  for (const file of files) {
    const override = overrides[file.path];
    const matches = patterns
      .filter(({ rx }) => rx.test(file.path))
      .map(({ pattern }) => pattern);
    if (matches.length) {
      matchedRules.set(file.path, matches);
      if (
        !Array.isArray(override) ||
        !matches.every((pattern) => override.includes(pattern))
      ) {
        hiddenPaths.add(file.path);
        continue;
      }
    }
    treeFiles.push(file);
    if (
      override === true ||
      (!matches.length &&
        override !== false &&
        settings.hideDeleted &&
        file.status === "deleted")
    ) {
      hiddenPaths.add(file.path);
    } else {
      visibleFiles.push(file);
    }
  }
  return { treeFiles, visibleFiles, hiddenPaths, matchedRules };
}
