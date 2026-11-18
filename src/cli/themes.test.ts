import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadThemes, saveTheme } from "./themes.ts";
import { loadUserSettings, saveUiSettings } from "./config.ts";
import { BUILTIN_THEMES, type ThemeDraft } from "../shared/themes.ts";
import { DEFAULT_UI_SETTINGS } from "../shared/settings.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-themes-"));
  roots.push(root);
  return {
    root,
    config: path.join(root, "config.json"),
    directory: path.join(root, "themes"),
  };
}
const draft = (): ThemeDraft => ({
  name: "My palette",
  mode: "light",
  extends: "catppuccin-latte",
  colors: { ...BUILTIN_THEMES[2]!.colors },
});

test("independent snapshots survive reload beside config and preserve existing preferences", async () => {
  const { config, directory } = await fixture();
  expect((await loadThemes(config)).themes).toEqual(BUILTIN_THEMES);
  await writeFile(
    config,
    JSON.stringify({
      port: 8123,
      outDir: "custom-review",
      ui: { enterSaves: false },
    }),
  );
  const original = draft();
  const first = await saveTheme(original, config);
  original.colors.background = "#123456";
  const second = await saveTheme(original, config);
  expect(first.theme.id).not.toBe(second.theme.id);
  expect(first.theme.id).toMatch(/^custom-[a-f0-9-]+$/);
  expect(first.theme.extends).toBe("catppuccin-latte");
  expect(JSON.parse(await readFile(first.file, "utf8"))).toEqual(first.theme);
  expect(path.basename(first.file)).toBe(`${first.theme.id}.json`);
  expect((await stat(first.file)).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect((await readdir(directory)).sort()).toEqual(
    [`${first.theme.id}.json`, `${second.theme.id}.json`].sort(),
  );
  const reloaded = await loadThemes(config);
  expect(reloaded.errors).toEqual([]);
  expect(reloaded.themes).toContainEqual(first.theme);
  expect(reloaded.themes).toContainEqual(second.theme);
  expect(first.theme.colors.background).not.toBe(
    second.theme.colors.background,
  );
  await saveUiSettings({ theme: second.theme.id }, config);
  expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
    port: 8123,
    outDir: "custom-review",
    ui: { ...DEFAULT_UI_SETTINGS, enterSaves: false, theme: second.theme.id },
  });
  expect((await loadUserSettings({}, config)).ui?.theme).toBe(second.theme.id);
});

test("malformed, oversized, duplicate and symlinked files cannot hide valid themes or builtins", async () => {
  const { root, config, directory } = await fixture();
  const saved = await saveTheme(draft(), config);
  await writeFile(path.join(directory, "bad.json"), "{");
  await writeFile(
    path.join(directory, "shadow.json"),
    JSON.stringify(BUILTIN_THEMES[0]),
  );
  await writeFile(
    path.join(directory, "unsafe.json"),
    JSON.stringify({ ...saved.theme, id: "../escape" }),
  );
  await writeFile(path.join(directory, "large.json"), " ".repeat(32769));
  await writeFile(
    path.join(directory, "duplicate.json"),
    JSON.stringify(saved.theme),
  );
  await writeFile(
    path.join(root, "outside.json"),
    JSON.stringify({ ...saved.theme, id: "outside" }),
  );
  await symlink(
    path.join(root, "outside.json"),
    path.join(directory, "link.json"),
  );
  const catalog = await loadThemes(config);
  expect(catalog.themes.slice(0, 4)).toEqual(BUILTIN_THEMES);
  expect(catalog.themes).toHaveLength(5);
  expect(catalog.themes).toContainEqual(saved.theme);
  expect(catalog.errors).toHaveLength(6);
  for (const name of [
    "bad.json",
    "shadow.json",
    "unsafe.json",
    "large.json",
    "link.json",
  ])
    expect(catalog.errors.some((error) => error.startsWith(`${name}:`))).toBe(
      true,
    );
});

test("theme-directory symlinks are never followed for reads or writes", async () => {
  const { root, config, directory } = await fixture();
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(
    path.join(outside, "custom.json"),
    JSON.stringify({ ...draft(), id: "outside" }),
  );
  await symlink(outside, directory);
  const catalog = await loadThemes(config);
  expect(catalog.themes).toEqual(BUILTIN_THEMES);
  expect(catalog.errors).toHaveLength(1);
  await expect(saveTheme(draft(), config)).rejects.toThrow("symbolic link");
  expect(await readdir(outside)).toEqual(["custom.json"]);
});

test("untrusted names never become paths and unsafe drafts never reach disk", async () => {
  const { root, config, directory } = await fixture();
  const saved = await saveTheme({ ...draft(), name: "../../outside" }, config);
  expect(path.dirname(saved.file)).toBe(await realpath(directory));
  expect(saved.theme.name).toBe("../../outside");
  for (const patch of [
    { id: "../../outside" },
    { file: "../../outside" },
    { extends: "../dark" },
    { colors: { ...draft().colors, background: "url(https://evil.example)" } },
    { colors: { ...draft().colors, foreground: "#fff; color:red" } },
    { colors: { ...draft().colors, __proto__: { background: "#000000" } } },
  ])
    await expect(
      saveTheme({ ...draft(), ...patch } as ThemeDraft, config),
    ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([`${saved.theme.id}.json`]);
  expect(await readdir(root)).toEqual(["themes"]);
});
