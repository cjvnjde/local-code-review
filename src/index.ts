#!/usr/bin/env bun
import { openInBrowser } from "./browser.ts";
import { parseArgs } from "./cli.ts";
import { diffRangeLabel, getDiff, getFileContext } from "./diff.ts";
import { findRepoRoot } from "./git.ts";
import { excludeRelativeOutput, saveReview } from "./output.ts";
import { startServer } from "./server.ts";
import { installSkill, previewSkill } from "./skill.ts";
import { collectStatuses } from "./status.ts";

const options = parseArgs(process.argv.slice(2));
const invocationRoot = process.cwd();
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
  saveReview: (submission) => saveReview(repoRoot, options.outDir, range, submission),
  previewSkill: () => previewSkill(invocationRoot),
  installSkill: (directory, expectedState, expectedRevision) =>
    installSkill(invocationRoot, directory, expectedState, expectedRevision),
});

if (options.open && !openInBrowser(`http://localhost:${server.port}`)) {
  console.log("  could not open browser; open the URL above manually\n");
}
