#!/usr/bin/env bun
import { readAcpConfig } from "./agent/acp.ts";
import { createManagedAgent } from "./agent/managed-agent.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readAttachment, saveAttachment } from "./review/attach.ts";
import { readBlob } from "./git/blob.ts";
import { openInBrowser } from "./browser/open.ts";
import { HELP, parseArgs } from "./cli/args.ts";
import { loadUserSettings, resolveAcpPath } from "./cli/config.ts";
import {
  diffBase,
  diffRangeLabel,
  diffSides,
  fingerprint,
  getDiff,
  getFileContext,
  resolveWorktreeBase,
  validateDiff,
} from "./git/diff.ts";
import { openInEditor } from "./cli/editor.ts";
import { createHub } from "./server/events.ts";
import { currentBranch, findRepoRoot, runGit } from "./git/commands.ts";
import { collectGhosts, describeReviews } from "./review/history.ts";
import {
  deleteReviews,
  excludeRelativeOutput,
  listReviews,
} from "./review/output.ts";
import { createSession } from "./review/session.ts";
import { startServer } from "./server/http.ts";
import { collectStatuses } from "./review/status.ts";
import { parseReview } from "./review/thread.ts";
import { VERSION } from "./version.ts";
import { createWebReview } from "./web-review/controller.ts";
import { isNoise, watchDir, watchTree } from "./server/watch.ts";

async function main() {
  const argv = process.argv.slice(2);
  const explicit = parseArgs(argv);
  if (explicit.help) {
    console.log(HELP);
    return;
  }
  // Asked before anything else: which build this is is answerable outside a repository too.
  if (explicit.version) {
    console.log(VERSION);
    process.exit(0);
  }
  const settings = await loadUserSettings(explicit);
  const options = parseArgs(argv, settings);
  const repoRoot = await findRepoRoot();
  process.chdir(repoRoot);
  const acpFile = resolveAcpPath(options, repoRoot);
  const agentConfig = acpFile ? await readAcpConfig(acpFile) : undefined;

  const range = diffRangeLabel(options.diffArgs);
  const diffSource = {
    repoRoot,
    context: options.context,
    diffArgs: options.diffArgs,
    ...(options.diffArgs.length === 0
      ? { worktreeBase: await resolveWorktreeBase(repoRoot) }
      : {}),
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
    if (others && options.id)
      console.log(
        `\n  nothing saved under "${options.id}" yet; starting that review`,
      );
    else if (others)
      console.log(
        `\n  ${others} earlier review file${others === 1 ? " is" : "s are"} for other diffs; starting fresh`,
      );
  }
  const hub = createHub();
  let webUrl = "";
  const agent = agentConfig
    ? createManagedAgent({
        repoRoot,
        outDir: options.outDir,
        session,
        directory: path.resolve(
          repoRoot,
          (
            await runGit(["rev-parse", "--git-path", "lcr-managed"], repoRoot)
          ).trim(),
        ),
        config: agentConfig,
        notify: () => hub.emit({ type: "review", file: session.file }),
      })
    : undefined;

  /** One saved review parsed back, for reading a ghost note's thread out of its own file. */
  async function readReview(name: string) {
    if (!(await listReviews(repoRoot, options.outDir)).includes(name))
      return null;
    const text = await readFile(
      path.resolve(repoRoot, options.outDir, name),
      "utf8",
    ).catch(() => "");
    return text ? parseReview(text) : null;
  }

  let web: ReturnType<typeof createWebReview> | undefined;
  let server: ReturnType<typeof startServer>;
  try {
    web = options.web
      ? createWebReview({
          url: options.web,
          repoRoot,
          outDir: options.outDir,
          session,
          hub,
          reviewUrl: () => webUrl,
        })
      : undefined;
    server = startServer({
      port: options.port,
      repoRoot,
      outDir: options.outDir,
      range,
      reviewId: options.id,
      context: options.context,
      uiDefaults: settings.ui,
      getDiff: () => getDiff(diffSource),
      getContext: (file, start, end) =>
        getFileContext(diffSource, file, start, end),
      readBlob: (side, file) =>
        readBlob(repoRoot, side === "old" ? sides.old : sides.new, file),
      // Beside the review file, because that is what a note's link to one resolves against.
      saveAttachment: (bytes, type) =>
        saveAttachment(repoRoot, options.outDir, bytes, type),
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
        const taken = new Set(
          doc.notes
            .map((note) => note.from)
            .filter((from): from is string => !!from),
        );
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
        return session.import(
          comment,
          source.messages,
          `${from.file}#${from.id}`,
        );
      },
      session,
      hub,
      agent,
      web,
    });
  } catch (error) {
    // The queue already owns its lock; a failed HTTP bind must release that ownership.
    await agent?.close();
    await web?.close();
    throw error;
  }
  webUrl = `http://localhost:${server.port}`;
  void agent?.check?.();

  /* ---------- following the agent ---------- */

  const outPath = path.resolve(repoRoot, options.outDir);
  /** Output inside the repository is our own writing; the tree watcher must not read it as work. */
  const outRelative = path.relative(repoRoot, outPath);
  const ignoreTree = (file: string) => {
    const relative = file.split("\\").join("/");
    if (isNoise(relative)) return true;
    return (
      !!outRelative &&
      !outRelative.startsWith("..") &&
      (relative === outRelative || relative.startsWith(`${outRelative}/`))
    );
  };

  /** Fingerprint of the whole diff, so a save that changes nothing does not repaint the page. */
  let digest = fingerprint(
    initialDiff.map((file) => `${file.path}:${file.hash}`).join("\n"),
  );
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
      const next = fingerprint(
        files.map((file) => `${file.path}:${file.hash}`).join("\n"),
      );
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

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    for (const watcher of watchers) watcher.close();
    await agent?.close();
    await web?.close();
    server.stop(true);
    process.exit(0);
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, shutdown);

  if (options.open) {
    let opened = false;
    if (web) {
      opened = await web
        .open()
        .then(() => true)
        .catch((error) => {
          console.error(
            "  " + error.message + " Open the review URL to retry.",
          );
          return false;
        });
    }
    if (!opened && !openInBrowser(webUrl)) {
      console.log("  could not open browser; open the URL above manually\n");
    }
  }
}

main().catch((error) => {
  console.error(`lcr: ${error instanceof Error ? error.message : error}`);
  console.error("Run lcr --help for usage.");
  process.exit(1);
});
