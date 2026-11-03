import { localWebUrl } from "../shared/web-review.ts";
import type { CliOptions } from "../shared/review-types.ts";
import type { StartupSettings } from "./config.ts";

/** A backtick or a control character: what an id may not carry into the review file. */
const UNSAFE_ID = /[\x00-\x1f\x60]/g;

/**
 * The name a review is asked for by. It is written into the review file as inline code and read back
 * out of the same line, so a backtick or a control character in it would not survive that round trip
 * and the file could no longer be matched to the run that made it. Whitespace is collapsed for the
 * same reason: two ids that differ only in how they were typed are one review.
 */
export function normalizeId(raw: string): string {
  return raw.replace(UNSAFE_ID, " ").replace(/\s+/g, " ").trim();
}

export function parseArgs(
  argv: string[],
  defaults: StartupSettings = {},
): CliOptions {
  let port = defaults.port ?? 7777;
  let outDir = defaults.outDir ?? ".review";
  let context = defaults.context ?? 5;
  let open = defaults.open ?? true;
  let id = normalizeId(defaults.id ?? "");
  let version = false;
  let help = false;
  let web = defaults.web ?? "";
  let browserProfile = defaults.browserProfile;
  let browserDataDir = defaults.browserDataDir;
  let acp = defaults.acp ?? "";
  let noAgent = false;
  let worktree = false;
  const diffArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      diffArgs.push(...argv.slice(i));
      break;
    }
    if (arg === "--port") port = Number(argv[++i]);
    else if (arg === "--out") outDir = argv[++i] as string;
    else if (arg === "--context") context = Number(argv[++i]);
    else if (arg === "--id") id = normalizeId(argv[++i] ?? "");
    else if (arg === "--web") web = localWebUrl(argv[++i] ?? "");
    else if (arg === "--no-web") web = "";
    else if (arg === "--browser-profile") {
      const value = argv[++i];
      if (value !== "shared" && value !== "project" && value !== "existing")
        throw new Error(
          '--browser-profile requires "shared", "project", or "existing".',
        );
      browserProfile = value;
    } else if (arg === "--browser-data-dir") {
      browserDataDir = argv[++i];
      if (
        !browserDataDir?.trim() ||
        browserDataDir.startsWith("-") ||
        browserDataDir.includes("\0")
      )
        throw new Error(
          "--browser-data-dir requires a browser user data directory.",
        );
    } else if (arg === "--worktree") worktree = true;
    else if (arg === "--no-open") open = false;
    else if (arg === "--open") open = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version" || arg === "-v") version = true;
    else if (arg === "--no-agent") {
      noAgent = true;
      acp = "";
    } else if (arg === "--acp") {
      noAgent = false;
      acp = argv[++i]?.trim() ?? "";
      if (!acp || acp.startsWith("-"))
        throw new Error("--acp requires a JSON configuration file.");
    } else diffArgs.push(arg);
  }

  if (!help && !version) {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("--port requires an integer from 0 to 65535.");
    if (!Number.isInteger(context) || context < 0)
      throw new Error("--context requires a non-negative integer.");
    if (!outDir || outDir.startsWith("-"))
      throw new Error("--out requires a directory.");
  }
  return {
    ...(noAgent ? { noAgent: true } : {}),
    ...(acp ? { acp } : {}),
    ...(web ? { web } : {}),
    ...(browserProfile ? { browserProfile } : {}),
    ...(browserDataDir ? { browserDataDir } : {}),
    port,
    outDir,
    context,
    open,
    id,
    version,
    help,
    diffArgs:
      diffArgs.length || worktree ? diffArgs : [...(defaults.diffArgs ?? [])],
  };
}

/** Help is local to the CLI: it needs neither Git nor a running review. */
export const HELP = `Usage: lcr [options] [git diff arguments]

Review working-tree, staged, and untracked changes against HEAD by default.
User startup defaults come from $XDG_CONFIG_HOME/lcr/config.json (or ~/.config/lcr/config.json).
Explicit CLI options override those defaults; explicit Git arguments replace diffArgs.
Other arguments are passed to git diff and checked before the server starts.
Use -- to separate file paths from options and revisions.

Offline context:
  lcr context inspect <id> --review <review.md>
  lcr context read <id> --review <review.md> --part <name> [--offset N --limit N]
  lcr context --help         Read saved AI context without Git, settings, or an agent

Options:
  -h, --help                 Show this help and exit
  -v, --version              Print the build stamp and exit
  --port <number>            Starting port (default: 7777; 0 picks a free port)
  --out <directory>          Review output directory (default: .review)
  --context <lines>          Surrounding diff lines (default: 5)
  --web <url>                Also annotate a localhost UI in Chrome
  --no-web                   Ignore a configured live page
  --browser-profile <scope>  Browser: shared (default), project, or existing
  --browser-data-dir <dir>   Existing browser's data directory (default: Chrome stable)
  --worktree                 Ignore configured diffArgs; review all working-tree changes
  --id <name>                Name a review to continue it across diff changes
  --no-open                  Do not open the browser
  --open                     Open the browser (default)
  --acp <config.json>        Override the default ACP agent profile
  --no-agent                 Run manually, ignoring the default agent

Examples:
  lcr
  lcr --staged
  lcr --web http://127.0.0.1:3000 --id ui main...HEAD
  lcr HEAD~3
  lcr main...HEAD
  lcr --no-open -- src/
`;
