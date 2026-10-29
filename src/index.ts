#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readAttachment, saveAttachment } from "./attach.ts";
import { readBlob } from "./blob.ts";
import { openInBrowser } from "./browser.ts";
import { HELP, parseArgs } from "./cli.ts";
import { claudeEndpoint, runClaudeBridge, startClaudeLink } from "./claude-link.ts";
import { createCodexChannel } from "./codex-channel.ts";
import { diffBase, diffRangeLabel, diffSides, fingerprint, getDiff, getFileContext, resolveWorktreeBase, validateDiff } from "./diff.ts";
import { openInEditor } from "./editor.ts";
import { createHub } from "./events.ts";
import { currentBranch, findRepoRoot } from "./git.ts";
import { collectGhosts, describeReviews } from "./history.ts";
import { deleteReviews, excludeRelativeOutput, listReviews } from "./output.ts";
import { createSession } from "./session.ts";
import { startServer } from "./server.ts";
import { collectStatuses } from "./status.ts";
import { parseReview } from "./thread.ts";
import { VERSION } from "./version.ts";
import { isNoise, watchDir, watchTree } from "./watch.ts";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  // Asked before anything else: which build this is is answerable outside a repository too.
  if (options.version) {
    console.log(VERSION);
    process.exit(0);
  }
  // stdout belongs exclusively to MCP in channel mode; startup and save messages remain on stderr.
  if (options.claudeChannel) console.log = console.error;
  // MCP servers can start from another directory; Claude Code supplies its stable project root.
  if (options.claudeChannel && process.env.CLAUDE_PROJECT_DIR) process.chdir(process.env.CLAUDE_PROJECT_DIR);
  const repoRoot = options.claudeChannel
    ? await findRepoRoot().catch(() => process.cwd())
    : await findRepoRoot();
  process.chdir(repoRoot);
  // Global MCP registration is only a bridge. It never starts a page, writes excludes or watches Git.
  if (options.claudeChannel) {
    await runClaudeBridge(repoRoot);
    process.exit(0);
  }

  const range = diffRangeLabel(options.diffArgs);
  const diffSource = {
    repoRoot,
    context: options.context,
    diffArgs: options.diffArgs,
    ...(options.diffArgs.length === 0 ? { worktreeBase: await resolveWorktreeBase(repoRoot) } : {}),
  };

  // Reject invalid Git options, revisions and paths before opening any review resources.
  await validateDiff(diffSource);
  await excludeRelativeOutput(repoRoot, options.outDir);
  const initialDiff = await getDiff(diffSource);

  // The revisions the diff is between are fixed by the arguments it was started with, so they are
  // worked out once; what they point at — the working tree, the index — is re-read on every request.
  const [branch, base, sides] = await Promise.all([
    currentBranch(repoRoot),
    diffBase(diffSource),
    diffSides(diffSource),
  ]);
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
  let webUrl = "";
  const claudeLink = options.codexThread ? undefined
    : await startClaudeLink(session, hub, () => webUrl, await claudeEndpoint(repoRoot)).catch((error) => {
      console.error(`  Claude link unavailable: ${error instanceof Error ? error.message : error}`);
      return undefined;
    });
  const channel = options.codexThread
    ? createCodexChannel({ repoRoot, outDir: options.outDir, thread: options.codexThread, session,
      notify: () => hub.emit({ type: "review", file: session.file }) })
    : claudeLink;

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
    readBlob: (side, file) => readBlob(repoRoot, side === "old" ? sides.old : sides.new, file),
    // Beside the review file, because that is what a note's link to one resolves against.
    saveAttachment: (bytes, type) => saveAttachment(repoRoot, options.outDir, bytes, type),
    readAttachment: (name) => readAttachment(repoRoot, options.outDir, name),
    openFile: (file, editor) => openInEditor(repoRoot, file, editor),
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
    channel,
  });
  webUrl = `http://localhost:${server.port}`;
  void channel?.check?.();

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
  let digest = fingerprint(initialDiff.map((file) => `${file.path}:${file.hash}`).join("\n"));
  let checking = false;
  let recheck = false;
  async function checkDiff(): Promise<void> {
    // A change is only worth announcing while a page is listening for it.
    if (!hub.size) return;
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
      await checkDiff();
    }
  }

  const watchers = [
    watchTree(repoRoot, () => checkDiff(), { ignore: ignoreTree }),
    watchDir(outPath, () => {
      if (hub.size) hub.emit({ type: "review", file: session.file });
    }),
  ];
  const heartbeat = setInterval(() => hub.ping(), 25_000);

  function shutdown() {
    clearInterval(heartbeat);
    for (const watcher of watchers) watcher.close();
    claudeLink?.close();
    server.stop(true);
    process.exit(0);
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, shutdown);

  if (options.open && !openInBrowser(`http://localhost:${server.port}`)) {
    console.log("  could not open browser; open the URL above manually\n");
  }
  if (options.codexThread) console.log(`  Codex feedback target: ${options.codexThread}\n`);
}

main().catch((error) => {
  console.error(`lcr: ${error instanceof Error ? error.message : error}`);
  console.error("Run lcr --help for usage.");
  process.exit(1);
});
