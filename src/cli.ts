import type { CliOptions } from "./types.ts";

export function parseArgs(argv: string[]): CliOptions {
  let port = 7777;
  let outDir = ".review";
  let context = 5;
  const diffArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") port = Number(argv[++i]);
    else if (arg === "--out") outDir = argv[++i] as string;
    else if (arg === "--context") context = Number(argv[++i]);
    else diffArgs.push(arg);
  }

  return { port, outDir, context, diffArgs };
}
