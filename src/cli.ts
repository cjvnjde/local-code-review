import { localWebUrl } from "./web-review-model.ts";
import type { CliOptions } from "./types.ts";

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

export function parseArgs(argv: string[]): CliOptions {
  let port = 7777;
  let outDir = ".review";
  let context = 5;
  let open = true;
  let id = "";
  let version = false;
  let help = false;
  let claudeChannel = false;
  let codexThread = "";
  let web = "";
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
    else if (arg === "--no-open") open = false;
    else if (arg === "--open") open = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version" || arg === "-v") version = true;
    else if (arg === "--claude-channel") claudeChannel = true;
    else if (arg === "--codex-thread") {
      codexThread = argv[++i]?.trim() ?? "";
      if (!codexThread || codexThread.startsWith("-") || /[\x00-\x1f]/.test(codexThread)) {
        throw new Error("--codex-thread requires a Codex session UUID or exact name.");
      }
    }
    else diffArgs.push(arg);
  }

  if (!help && !version) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port requires an integer from 0 to 65535.");
    if (!Number.isInteger(context) || context < 0) throw new Error("--context requires a non-negative integer.");
    if (!outDir || outDir.startsWith("-")) throw new Error("--out requires a directory.");
  }
  if (claudeChannel && codexThread) throw new Error("Choose either --claude-channel or --codex-thread for this run.");
  if (web && (diffArgs.length || claudeChannel)) throw new Error("--web cannot be combined with Git diff arguments or --claude-channel.");
  return { ...(web ? { web } : {}), port, outDir, context, open, id, version, help, claudeChannel, codexThread, diffArgs };
}

/** Help is local to the CLI: it needs neither Git nor a running review. */
export const HELP = `Usage: lcr [options] [git diff arguments]

Review working-tree, staged, and untracked changes against HEAD by default.
Other arguments are passed to git diff and checked before the server starts.
Use -- to separate file paths from options and revisions.

Options:
  -h, --help                 Show this help and exit
  -v, --version              Print the build stamp and exit
  --port <number>            Starting port (default: 7777; 0 picks a free port)
  --out <directory>          Review output directory (default: .review)
  --context <lines>          Surrounding diff lines (default: 5)
  --web <url>                Annotate a localhost UI in a dedicated Chrome window
  --id <name>                Name a review to continue it across diff changes
  --no-open                  Do not open the browser
  --open                     Open the browser (default)
  --codex-thread <session>   Forward feedback to an existing Codex session
  --claude-channel           Run the stdio bridge; no review server or browser

Examples:
  lcr
  lcr --staged
  lcr --web http://127.0.0.1:3000 --id ui
  lcr HEAD~3
  lcr main...HEAD
  lcr --no-open -- src/
`;
