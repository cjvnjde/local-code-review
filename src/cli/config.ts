import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { CliOptions } from "../shared/review-types.ts";
import {
  parseUiSettings,
  uiSettingsPatchSchema,
  type UiSettings,
} from "../shared/settings.ts";
import { localWebUrl } from "../shared/web-review.ts";

const configString = z.string().max(32768);
const directory = configString
  .min(1)
  .refine(
    (value) => !value.startsWith("-") && !value.includes("\0"),
    "Must be a directory without NUL characters or a leading dash.",
  );
export const startupSettingsSchema = z.strictObject({
  acp: configString
    .refine(
      (value) => !!value.trim() && !value.includes("\0"),
      "Must be a non-empty profile path.",
    )
    .nullable()
    .optional(),
  port: z.number().int().min(0).max(65535).optional(),
  outDir: directory.optional(),
  context: z.number().int().nonnegative().optional(),
  open: z.boolean().optional(),
  treeSitter: z.boolean().optional(),
  id: configString.optional(),
  web: configString
    .transform((value, ctx) => {
      try {
        return localWebUrl(value);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Must be a localhost HTTP(S) URL without credentials.",
        });
        return z.NEVER;
      }
    })
    .optional(),
  browserProfile: z.enum(["shared", "project", "existing"]).optional(),
  browserDataDir: directory
    .refine((value) => !!value.trim(), "Must be a non-empty directory.")
    .optional(),
  diffArgs: z
    .custom<unknown[]>(
      (value) => Array.isArray(value) && value.length <= 1024,
      "Must be an array of at most 1024 arguments.",
    )
    .pipe(
      z.array(
        configString.refine(
          (value) => !value.includes("\0"),
          "Must not contain NUL characters.",
        ),
      ),
    )
    .optional(),
  ui: uiSettingsPatchSchema.optional(),
});
export type StartupSettings = z.infer<typeof startupSettingsSchema>;

/** User-owned settings only: repositories cannot supply startup or agent configuration. */
export function userConfigFile(
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string {
  const base =
    env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : path.join(home, ".config");
  return path.join(base, "lcr", "config.json");
}

function expandHome(file: string): string {
  return file.startsWith("~/") ? path.join(homedir(), file.slice(2)) : file;
}

/** Explicit agent flags retain their escape from unreadable or malformed legacy settings. */
export async function loadUserSettings(
  options: Pick<CliOptions, "acp" | "noAgent"> = {},
  settingsFile = userConfigFile(),
): Promise<StartupSettings> {
  const explicitAgent = !!(options.noAgent || options.acp);
  let source: string;
  try {
    source = await readFile(settingsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || explicitAgent)
      return {};
    throw new Error(
      `Could not read lcr settings at ${settingsFile}. Check the file or use --no-agent.`,
      { cause: error },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    if (explicitAgent) return {};
    throw new Error(
      `Invalid JSON in ${settingsFile}. Fix the settings or use --no-agent.`,
      { cause: error },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (explicitAgent) return {};
    throw new Error(`Expected a settings object in ${settingsFile}.`);
  }
  // An explicit agent selection ignores only this legacy field, not invalid unrelated defaults.
  if (explicitAgent) delete (value as Record<string, unknown>).acp;
  const parsed = startupSettingsSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.code === "unrecognized_keys" && !issue.path.length)
      throw new Error(
        `Unknown lcr setting "${issue.keys[0]}" in ${settingsFile}.`,
      );
    throw new Error(
      `The ${issue.path.join(".")} setting in ${settingsFile}: ${issue.message}`,
    );
  }
  const settings = parsed.data;
  if (typeof settings.acp === "string")
    settings.acp = path.resolve(
      path.dirname(settingsFile),
      expandHome(settings.acp.trim()),
    );
  if (settings.browserDataDir !== undefined)
    settings.browserDataDir = path.resolve(
      path.dirname(settingsFile),
      expandHome(settings.browserDataDir),
    );
  return settings;
}

/** Merge UI preferences without rewriting startup paths or dropping external edits. */
export async function saveUiSettings(
  patch: Partial<UiSettings>,
  settingsFile = userConfigFile(),
): Promise<void> {
  const validated = parseUiSettings(patch);
  let current: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(await readFile(settingsFile, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected a settings object.");
    current = value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        `Could not save lcr settings at ${settingsFile}: ${(error as Error).message}`,
        { cause: error },
      );
  }
  const ui = { ...parseUiSettings(current.ui ?? {}), ...validated };
  await mkdir(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({ ...current, ui }, null, 2) + "\n",
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    await rename(temporary, settingsFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** CLI paths are repo-relative; loaded defaults are already absolute beside their settings file. */
export function resolveAcpPath(
  options: Pick<CliOptions, "acp" | "noAgent">,
  repoRoot: string,
): string | null {
  if (options.noAgent || !options.acp) return null;
  return path.resolve(repoRoot, expandHome(options.acp));
}

export function resolveBrowserDataDir(
  file: string | undefined,
  repoRoot: string,
): string | undefined {
  return file ? path.resolve(repoRoot, expandHome(file)) : undefined;
}
