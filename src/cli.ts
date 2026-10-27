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
  let claudeChannel = false;
  let codexThread = "";
  const diffArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") port = Number(argv[++i]);
    else if (arg === "--out") outDir = argv[++i] as string;
    else if (arg === "--context") context = Number(argv[++i]);
    else if (arg === "--id") id = normalizeId(argv[++i] ?? "");
    else if (arg === "--no-open") open = false;
    else if (arg === "--open") open = true;
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

  if (claudeChannel && codexThread) throw new Error("Choose either --claude-channel or --codex-thread for this run.");
  return { port, outDir, context, open, id, version, claudeChannel, codexThread, diffArgs };
}
