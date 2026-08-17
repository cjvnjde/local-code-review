#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openInBrowser } from "./browser.ts";
import { parseArgs } from "./cli.ts";
import { diffBase, diffRangeLabel, fingerprint, getDiff, getFileContext } from "./diff.ts";
import { createHub } from "./events.ts";
import { currentBranch, findRepoRoot } from "./git.ts";
import { collectGhosts, describeReviews } from "./history.ts";
import { deleteReviews, excludeRelativeOutput, listReviews } from "./output.ts";
import { createSession } from "./session.ts";
import { startServer } from "./server.ts";
import { collectStatuses } from "./status.ts";
import { parseReview } from "./thread.ts";
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

const [branch, base] = await Promise.all([currentBranch(repoRoot), diffBase(diffSource)]);
const session = createSession(repoRoot, options.outDir, range, {
  range,
  branch,
  base,
  ...(options.id ? { id: options.id } : {}),
});
// A restart on the same diff continues its conversation; any other context starts its own. A run
// given a name continues the review of that name instead, whatever diff it was opened on. The files
// that did not match are history, reachable from the page's review picker.
if (!(await session.adoptMatching())) {
  const others = (await listReviews(repoRoot, options.outDir)).length;
  if (others && options.id) console.log(`\n  nothing saved under "${options.id}" yet; starting that review`);
  else if (others) console.log(`\n  ${others} earlier review file${others === 1 ? " is" : "s are"} for other diffs; starting fresh`);
}
const hub = createHub();

/** One saved review parsed back, for reading a ghost note's thread out of its own file. */
async function readReview(name: string) {
  if (!(await listReviews(repoRoot, options.outDir)).includes(name)) return null;
  const text = await readFile(path.resolve(repoRoot, options.outDir, name), "utf8").catch(() => "");
  return text ? parseReview(text) : null;
}

const server = startServer({
  port: options.port,
  repoRoot,
  outDir: options.outDir,
  range,
  reviewId: options.id,
  context: options.context,
  getDiff: () => getDiff(diffSource),
  getContext: (file, start, end) => getFileContext(diffSource, file, start, end),
  getStatuses: () => collectStatuses(repoRoot, options.outDir),
  listReviews: () => listReviews(repoRoot, options.outDir),
  deleteReviews: () => deleteReviews(repoRoot, options.outDir),
  describeReviews: () => describeReviews(repoRoot, options.outDir),
  // The branch is asked for per request rather than kept from startup: the reviewer can check
  // another one out mid-run, and the ghosts on offer should follow them there.
  getGhosts: async () => {
    const doc = await session.read();
    const taken = new Set(doc.notes.map((note) => note.from).filter((from): from is string => !!from));
    return collectGhosts(repoRoot, options.outDir, {
      except: session.file,
      branch: await currentBranch(repoRoot),
      taken,
    });
  },
  importNote: async (from, comment) => {
    const doc = await readReview(from.file);
    const source = doc?.notes.find((note) => note.id === from.id);
    if (!source) return null;
    return session.import(comment, source.messages, `${from.file}#${from.id}`);
  },
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
