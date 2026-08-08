#!/usr/bin/env bun
import { openInBrowser } from "./browser.ts";
import { parseArgs } from "./cli.ts";
import { diffRangeLabel, getDiff, getFileContext } from "./diff.ts";
import { findRepoRoot } from "./git.ts";
import { deleteReviews, excludeRelativeOutput, listReviews, saveReview } from "./output.ts";
import { startServer } from "./server.ts";
import { collectStatuses } from "./status.ts";

const options = parseArgs(process.argv.slice(2));
const repoRoot = await findRepoRoot();
process.chdir(repoRoot);

await excludeRelativeOutput(repoRoot, options.outDir);
const range = diffRangeLabel(options.diffArgs);
const diffSource = {
  repoRoot,
  context: options.context,
  diffArgs: options.diffArgs,
};

const server = startServer({
  port: options.port,
  repoRoot,
  outDir: options.outDir,
  range,
  context: options.context,
  getDiff: () => getDiff(diffSource),
  getContext: (path, start, end) => getFileContext(diffSource, path, start, end),
  getStatuses: () => collectStatuses(repoRoot, options.outDir),
  listReviews: () => listReviews(repoRoot, options.outDir),
  deleteReviews: () => deleteReviews(repoRoot, options.outDir),
  saveReview: (submission, replace) => saveReview(repoRoot, options.outDir, range, submission, replace),
});

if (options.open && !openInBrowser(`http://localhost:${server.port}`)) {
  console.log("  could not open browser; open the URL above manually\n");
}
