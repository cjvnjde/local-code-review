import path from "node:path";
import { userConfigFile } from "../cli/config.ts";
import type { CliOptions } from "../shared/review-types.ts";

export function reviewBrowserProfile(
  repoRoot: string,
  outDir: string,
  scope: Exclude<CliOptions["browserProfile"], "existing"> = "shared",
  configFile = userConfigFile(),
): string {
  return scope === "project"
    ? path.resolve(repoRoot, outDir, ".browser")
    : path.join(path.dirname(configFile), "browser");
}
