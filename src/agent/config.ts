import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { CliOptions } from "../shared/review-types.ts";

/** User-owned settings only: opening a repository must not execute its own agent configuration. */
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

/** Explicit CLI selection wins; settings paths are relative to the settings file, never the repo. */
export async function resolveAcpPath(
  options: Pick<CliOptions, "acp" | "noAgent">,
  repoRoot: string,
  settingsFile = userConfigFile(),
): Promise<string | null> {
  if (options.noAgent) return null;
  if (options.acp) return path.resolve(repoRoot, expandHome(options.acp));
  let source: string;
  try {
    source = await readFile(settingsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Could not read lcr settings at ${settingsFile}. Check the file or use --no-agent.`,
    );
  }
  let settings: unknown;
  try {
    settings = JSON.parse(source);
  } catch {
    throw new Error(
      `Invalid JSON in ${settingsFile}. Fix the settings or use --no-agent.`,
    );
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error(
      `Expected a settings object in ${settingsFile}. Use {"acp":"agents/omp.json"} or {"acp":null}.`,
    );
  const acp = (settings as { acp?: unknown }).acp;
  if (acp === undefined || acp === null) return null;
  if (typeof acp !== "string" || !acp.trim() || acp.includes("\0"))
    throw new Error(
      `The acp setting in ${settingsFile} must be a non-empty profile path or null.`,
    );
  return path.resolve(path.dirname(settingsFile), expandHome(acp.trim()));
}
