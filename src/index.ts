#!/usr/bin/env bun
import path from "node:path";
import { openInBrowser } from "./browser.ts";
import { parseArgs } from "./cli.ts";
import { diffRangeLabel, fingerprint, getDiff, getFileContext } from "./diff.ts";
import { createHub } from "./events.ts";
import { findRepoRoot } from "./git.ts";
import { deleteReviews, excludeRelativeOutput, listReviews } from "./output.ts";
import { createSession } from "./session.ts";
import { startServer } from "./server.ts";
import { collectStatuses } from "./status.ts";
import { isNoise, watchDir, watchTree } from "./watch.ts";

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

const session = createSession(repoRoot, options.outDir, range);
// A restart continues the conversation it finds rather than starting a second one beside it.
await session.adoptNewest();
const hub = createHub();

const server = startServer({
  port: options.port,
  repoRoot,
  outDir: options.outDir,
  range,
  context: options.context,
  getDiff: () => getDiff(diffSource),
  getContext: (file, start, end) => getFileContext(diffSource, file, start, end),
  getStatuses: () => collectStatuses(repoRoot, options.outDir),
  listReviews: () => listReviews(repoRoot, options.outDir),
  deleteReviews: () => deleteReviews(repoRoot, options.outDir),
  session,
  hub,
});

/* ---------- following the agent ---------- */

const outPath = path.resolve(repoRoot, options.outDir);
/** Output inside the repository is our own writing; the tree watcher must not read it as work. */
const outRelative = path.relative(repoRoot, outPath);
const ignoreTree = (file: string) => {
  const relative = file.split("\\").join("/");
  if (isNoise(relative)) return true;
  return !!outRelative && !outRelative.startsWith("..") &&
    (relative === outRelative || relative.startsWith(`${outRelative}/`));
};

/** Fingerprint of the whole diff, so a save that changes nothing does not repaint the page. */
let digest = "";
let checking = false;
let recheck = false;
async function checkDiff(force = false): Promise<void> {
  // The first run only records where the diff started; after that a change is only worth
  // announcing while a page is listening for it.
  if (!hub.size && !force) return;
  // An edit that lands while git is running would otherwise be the one nobody hears about.
  if (checking) {
    recheck = true;
    return;
  }
  checking = true;
  try {
    const files = await getDiff(diffSource);
    const next = fingerprint(files.map((file) => `${file.path}:${file.hash}`).join("\n"));
    if (digest && next !== digest) hub.emit({ type: "diff" });
    digest = next;
  } catch {
    // A diff that cannot be produced right now is reported by the page's own fetch.
  } finally {
    checking = false;
  }
  if (recheck) {
    recheck = false;
    await checkDiff(force);
  }
}
await checkDiff(true);

const watchers = [
  watchTree(repoRoot, () => checkDiff(), { ignore: ignoreTree }),
  watchDir(outPath, () => {
    if (hub.size) hub.emit({ type: "review", file: session.file });
  }),
];
const heartbeat = setInterval(() => hub.ping(), 25_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(heartbeat);
    for (const watcher of watchers) watcher.close();
    server.stop(true);
    process.exit(0);
  });
}

if (options.open && !openInBrowser(`http://localhost:${server.port}`)) {
  console.log("  could not open browser; open the URL above manually\n");
}
