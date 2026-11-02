import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { CliOptions } from "../shared/review-types.ts";
import { parseUiSettings, type UiSettings } from "../shared/settings.ts";
import { localWebUrl } from "../shared/web-review.ts";

export interface StartupSettings {
  acp?: string | null;
  port?: number;
  outDir?: string;
  context?: number;
  open?: boolean;
  id?: string;
  web?: string;
  browserProfile?: CliOptions["browserProfile"];
  diffArgs?: string[];
  ui?: Partial<UiSettings>;
}

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
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    if (explicitAgent) return {};
    throw new Error(
      `Invalid JSON in ${settingsFile}. Fix the settings or use --no-agent.`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (explicitAgent) return {};
    throw new Error(`Expected a settings object in ${settingsFile}.`);
  }
  const settings: StartupSettings = {};
  function invalid(key: string, expected: string): never {
    throw new Error(
      `The ${key} setting in ${settingsFile} must be ${expected}.`,
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    switch (key) {
      case "acp":
        if (explicitAgent) break;
        if (entry === null) settings.acp = null;
        else if (
          typeof entry === "string" &&
          entry.trim() &&
          !entry.includes("\0")
        )
          settings.acp = path.resolve(
            path.dirname(settingsFile),
            expandHome(entry.trim()),
          );
        else invalid(key, "a non-empty profile path or null");
        break;
      case "port":
        if (
          typeof entry !== "number" ||
          !Number.isInteger(entry) ||
          entry < 0 ||
          entry > 65535
        )
          invalid(key, "an integer from 0 to 65535");
        settings.port = entry;
        break;
      case "context":
        if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0)
          invalid(key, "a non-negative integer");
        settings.context = entry;
        break;
      case "outDir":
        if (
          typeof entry !== "string" ||
          !entry ||
          entry.startsWith("-") ||
          entry.includes("\0")
        )
          invalid(
            key,
            "a non-empty directory without NUL characters or a leading dash",
          );
        settings.outDir = entry;
        break;
      case "open":
        if (typeof entry !== "boolean") invalid(key, "a boolean");
        settings.open = entry;
        break;
      case "id":
        if (typeof entry !== "string") invalid(key, "a string");
        settings.id = entry;
        break;
      case "web":
        if (typeof entry !== "string") invalid(key, "a localhost HTTP(S) URL");
        try {
          settings.web = localWebUrl(entry);
        } catch {
          invalid(key, "a localhost HTTP(S) URL without credentials");
        }
        break;
      case "diffArgs":
        if (
          !Array.isArray(entry) ||
          !entry.every((arg) => typeof arg === "string" && !arg.includes("\0"))
        )
          invalid(key, "an array of strings without NUL characters");
        settings.diffArgs = entry;
        break;
      case "browserProfile":
        if (entry !== "shared" && entry !== "project")
          invalid(key, '"shared" or "project"');
        settings.browserProfile = entry;
        break;
      case "ui":
        try {
          settings.ui = parseUiSettings(entry);
        } catch (error) {
          throw new Error(
            `Invalid ui setting in ${settingsFile}: ${(error as Error).message}`,
          );
        }
        break;
      default:
        throw new Error(`Unknown lcr setting "${key}" in ${settingsFile}.`);
    }
  }
  return settings;
}

/** CLI paths are repo-relative; loaded defaults are already absolute beside their settings file. */
export function resolveAcpPath(
  options: Pick<CliOptions, "acp" | "noAgent">,
  repoRoot: string,
): string | null {
  if (options.noAgent || !options.acp) return null;
  return path.resolve(repoRoot, expandHome(options.acp));
}
