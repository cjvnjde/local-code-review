#!/usr/bin/env bun
import { parseArgs } from "./cli.ts";
import { diffRangeLabel, getDiff } from "./diff.ts";
import { findRepoRoot } from "./git.ts";
import { excludeRelativeOutput, saveReview } from "./output.ts";
import { startServer } from "./server.ts";
import { installSkill, previewSkill } from "./skill.ts";

const options = parseArgs(process.argv.slice(2));
const invocationRoot = process.cwd();
const repoRoot = await findRepoRoot();
process.chdir(repoRoot);

await excludeRelativeOutput(repoRoot, options.outDir);
const range = diffRangeLabel(options.diffArgs);

startServer({
  port: options.port,
  repoRoot,
  outDir: options.outDir,
  range,
  getDiff: () => getDiff({
    repoRoot,
    context: options.context,
    diffArgs: options.diffArgs,
  }),
  saveReview: (submission) => saveReview(repoRoot, options.outDir, range, submission),
  previewSkill: () => previewSkill(invocationRoot),
  installSkill: (directory, expectedState, expectedRevision) =>
    installSkill(invocationRoot, directory, expectedState, expectedRevision),
});
