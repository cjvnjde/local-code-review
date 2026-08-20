import { isAbsolute, relative, resolve, sep } from "node:path";

/** Absolute path to one working-tree file, or null when the name leaves the repository. */
export function workingFilePath(repoRoot: string, file: string): string | null {
  const absolute = resolve(repoRoot, file);
  const fromRoot = relative(repoRoot, absolute);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return null;
  }
  return absolute;
}

/** Command that asks the operating system to open a file with its configured default application. */
export function editorCommand(file: string, platform: string = process.platform): string[] {
  if (platform === "darwin") return ["open", file];
  if (platform === "win32") return ["explorer.exe", file];
  return ["xdg-open", file];
}

/** A configured editor is one executable name or path; arguments are never parsed through a shell. */
export function configuredEditorCommand(
  file: string,
  configured: string,
  platform: string = process.platform,
  which: (command: string) => string | null = (command) => Bun.which(command),
): string[] | null {
  const editor = configured.trim();
  if (/[\x00-\x1f]/.test(editor)) return null;
  if (!editor) return editorCommand(file, platform);
  const executable = isAbsolute(editor) ? editor : which(editor);
  return executable ? [executable, file] : null;
}

/**
 * Opens one existing working-tree file without a shell. A configured executable wins; otherwise the
 * operating system's file association decides which editor receives it.
 */
export async function openInEditor(repoRoot: string, file: string, editor = ""): Promise<boolean> {
  const absolute = workingFilePath(repoRoot, file);
  if (!absolute || !(await Bun.file(absolute).exists())) return false;
  const command = configuredEditorCommand(absolute, editor);
  if (!command) return false;
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
