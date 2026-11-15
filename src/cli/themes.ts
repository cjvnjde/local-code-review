import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { userConfigFile } from "./config.ts";
import {
  BUILTIN_THEMES,
  parseTheme,
  parseThemeDraft,
  type Theme,
  type ThemeCatalog,
  type ThemeDraft,
} from "../shared/themes.ts";

const MAX_THEME_BYTES = 32768;

/** Never follow a themes-directory symlink, even when its target is readable. */
async function themeDirectory(
  settingsFile: string,
  create: boolean,
): Promise<string> {
  const parent = path.dirname(path.resolve(settingsFile));
  if (create) await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = path.join(await realpath(parent), "themes");
  if (create) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Theme storage must be a directory, not a symbolic link.");
  if (create) {
    const handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.chmod(0o700);
    } finally {
      await handle.close();
    }
  }
  return directory;
}

/** Invalid custom files are isolated; the built-in palettes always remain available. */
export async function loadThemes(
  settingsFile = userConfigFile(),
): Promise<ThemeCatalog> {
  const catalog: ThemeCatalog = {
    themes: [...BUILTIN_THEMES],
    directory: path.join(path.dirname(path.resolve(settingsFile)), "themes"),
    errors: [],
  };
  let directory: string;
  let names: string[];
  try {
    directory = await themeDirectory(settingsFile, false);
    names = (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      catalog.errors.push(`${catalog.directory}: ${(error as Error).message}`);
    return catalog;
  }
  const ids = new Set(catalog.themes.map((theme) => theme.id));
  for (const name of names) {
    try {
      const handle = await open(
        path.join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let value: unknown;
      try {
        const info = await handle.stat();
        if (!info.isFile())
          throw new Error("Theme must be a regular JSON file.");
        if (info.size > MAX_THEME_BYTES)
          throw new Error("Theme exceeds 32 KiB.");
        // Bound actual reads too: the file can grow after stat.
        const bytes = Buffer.alloc(MAX_THEME_BYTES + 1);
        let size = 0;
        while (size < bytes.length) {
          const { bytesRead } = await handle.read(
            bytes,
            size,
            bytes.length - size,
            null,
          );
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > MAX_THEME_BYTES) throw new Error("Theme exceeds 32 KiB.");
        value = JSON.parse(bytes.toString("utf8", 0, size));
      } finally {
        await handle.close();
      }
      const theme = parseTheme(value);
      if (ids.has(theme.id))
        throw new Error(`Duplicate or built-in theme ID: ${theme.id}`);
      ids.add(theme.id);
      catalog.themes.push(theme);
    } catch (error) {
      catalog.errors.push(`${name}: ${(error as Error).message}`);
    }
  }
  return catalog;
}

/** Publish a complete independent snapshot atomically, never replacing an existing file. */
export async function saveTheme(
  draft: ThemeDraft,
  settingsFile = userConfigFile(),
): Promise<{ theme: Theme; file: string }> {
  const validated = parseThemeDraft(draft);
  const theme: Theme = { id: `custom-${crypto.randomUUID()}`, ...validated };
  const directory = await themeDirectory(settingsFile, true);
  const file = path.join(directory, `${theme.id}.json`);
  const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(theme, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Unlike rename, link fails if a destination already exists.
    await link(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return { theme, file };
}
