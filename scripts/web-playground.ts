import { readFile } from "node:fs/promises";
import path from "node:path";
import { launchReviewBrowser } from "../src/browser/review-browser.ts";
import { openInEditor } from "../src/cli/editor.ts";
import { readBlob } from "../src/git/blob.ts";
import { currentBranch, findRepoRoot } from "../src/git/commands.ts";
import {
  diffBase,
  diffRangeLabel,
  diffSides,
  fingerprint,
  getDiff,
  getFileContext,
  resolveWorktreeBase,
} from "../src/git/diff.ts";
import { readAttachment, saveAttachment } from "../src/review/attach.ts";
import { collectGhosts, describeReviews } from "../src/review/history.ts";
import {
  deleteReviews,
  excludeRelativeOutput,
  listReviews,
} from "../src/review/output.ts";
import { createSession } from "../src/review/session.ts";
import { collectStatuses } from "../src/review/status.ts";
import { parseReview } from "../src/review/thread.ts";
import { createHub } from "../src/server/events.ts";
import { startServer } from "../src/server/http.ts";
import {
  isNoise,
  watchDir,
  watchTree,
  type Watcher,
} from "../src/server/watch.ts";
import { createWebReview } from "../src/web-review/controller.ts";

/** Developer composition only: nothing in src/index.ts imports this launcher or its page. */
export async function startWebPlayground(
  options: {
    repoRoot?: string;
    outDir?: string;
    browserArgs?: string[];
    signal?: AbortSignal;
  } = {},
) {
  options.signal?.throwIfAborted();
  const repoRoot = options.repoRoot ?? (await findRepoRoot());
  const directory = options.outDir ?? ".review/playground";
  const profile = path.resolve(repoRoot, directory, ".browser");
  const source = {
    repoRoot,
    context: 5,
    diffArgs: [] as string[],
    worktreeBase: await resolveWorktreeBase(repoRoot),
  };
  const range = diffRangeLabel(source.diffArgs);
  const [branch, base, sides, initial] = await Promise.all([
    currentBranch(repoRoot),
    diffBase(source),
    diffSides(source),
    getDiff(source),
  ]);
  const html = await Bun.file(
    new URL("./web-playground.html", import.meta.url),
  ).text();
  const tokens = await Bun.file(
    new URL("../src/web/styles/tokens.css", import.meta.url),
  ).text();
  options.signal?.throwIfAborted();
  await excludeRelativeOutput(repoRoot, directory);
  const app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/" && pathname !== "/tokens.css")
        return new Response("not found", { status: 404 });
      return new Response(pathname === "/" ? html : tokens, {
        headers: {
          "content-type":
            pathname === "/"
              ? "text/html; charset=utf-8"
              : "text/css; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    },
  });
  const url = `http://127.0.0.1:${app.port}/`;
  const reviews: Array<{
    web: ReturnType<typeof createWebReview>;
    server: ReturnType<typeof startServer>;
    hub: ReturnType<typeof createHub>;
  }> = [];
  const watchers: Watcher[] = [];
  let browser: Awaited<ReturnType<typeof launchReviewBrowser>> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      clearInterval(heartbeat);
      for (const watcher of watchers) watcher.close();
      for (const review of [...reviews].reverse()) {
        await review.web.close();
        review.server.stop(true);
      }
      await browser?.close();
      app.stop(true);
    })());

  async function createReview(name: string, owner: string) {
    const outDir = path.join(directory, name);
    const id = `lcr-ui-${name}`;
    const session = createSession(repoRoot, outDir, range, {
      range,
      branch,
      base,
      id,
    });
    await session.adoptMatching();
    const hub = createHub();
    let reviewUrl = "";
    const web = createWebReview({
      url,
      repoRoot,
      outDir,
      session,
      hub,
      browserProfile: "existing",
      browserDataDir: profile,
      overlayOwnerKey: owner,
      reviewUrl: () => reviewUrl,
    });
    const server = startServer({
      port: 0,
      repoRoot,
      outDir,
      range,
      reviewId: id,
      context: source.context,
      session,
      hub,
      web,
      getDiff: () => getDiff(source),
      getContext: (file, start, end) =>
        getFileContext(source, file, start, end),
      readBlob: (side, file) =>
        readBlob(repoRoot, side === "old" ? sides.old : sides.new, file),
      saveAttachment: (bytes, type) =>
        saveAttachment(repoRoot, outDir, bytes, type),
      readAttachment: (name) => readAttachment(repoRoot, outDir, name),
      openFile: (file, editor) => openInEditor(repoRoot, file, editor),
      getStatuses: () => collectStatuses(repoRoot, outDir),
      listReviews: () => listReviews(repoRoot, outDir),
      deleteReviews: () => deleteReviews(repoRoot, outDir),
      describeReviews: () => describeReviews(repoRoot, outDir),
      getGhosts: async () => {
        const doc = await session.read();
        return collectGhosts(repoRoot, outDir, {
          except: session.file,
          branch: await currentBranch(repoRoot),
          taken: new Set(
            doc.notes.flatMap((note) => (note.from ? [note.from] : [])),
          ),
        });
      },
      importNote: async (from, comment) => {
        if (!(await listReviews(repoRoot, outDir)).includes(from.file))
          return null;
        const doc = parseReview(
          await readFile(path.resolve(repoRoot, outDir, from.file), "utf8"),
        );
        const note = doc.notes.find((note) => note.id === from.id);
        return note
          ? session.import(comment, note.messages, `${from.file}#${note.id}`)
          : null;
      },
    });
    reviewUrl = `http://localhost:${server.port}`;
    const review = { web, server, hub, url: reviewUrl, outDir };
    reviews.push(review);
    watchers.push(
      watchDir(path.resolve(repoRoot, outDir), () => {
        if (hub.size) hub.emit({ type: "review", file: session.file });
      }),
    );
    return review;
  }

  try {
    browser = await launchReviewBrowser(profile, options.browserArgs);
    options.signal?.throwIfAborted();
    const { targetId } = await browser.cdp.send("Target.createTarget", { url });
    // The page installs its mode-switch handler before either overlay is injected.
    const feedback = await createReview("feedback", "__lcr_page_review__");
    options.signal?.throwIfAborted();
    const { sessionId } = await browser.cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    try {
      let loaded = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const { frameTree } = await browser.cdp.send(
          "Page.getFrameTree",
          {},
          sessionId,
        );
        if (frameTree.frame.url === url) {
          loaded = true;
          break;
        }
        await Bun.sleep(50);
      }
      if (!loaded) throw new Error("The playground page did not load.");
      // Use the normal persisted position so its menu and drag behavior stay real.
      await browser.cdp.send(
        "Runtime.evaluate",
        {
          expression: `sessionStorage.setItem(${JSON.stringify("lcr:launcher:" + feedback.url)}, JSON.stringify({x:innerWidth-70,y:innerHeight-62}))`,
        },
        sessionId,
      );
    } finally {
      await browser.cdp.send("Target.detachFromTarget", { sessionId });
    }
    await feedback.web.open();
    options.signal?.throwIfAborted();
    const example = await createReview("example", "__lcr_playground_example__");
    await example.web.open();
    options.signal?.throwIfAborted();
    let digest = fingerprint(
      initial.map((file) => `${file.path}:${file.hash}`).join("\n"),
    );
    let checking = false;
    let again = false;
    async function checkDiff() {
      if (!reviews.some((review) => review.hub.size)) return;
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      try {
        do {
          again = false;
          const files = await getDiff(source);
          const next = fingerprint(
            files.map((file) => `${file.path}:${file.hash}`).join("\n"),
          );
          if (next !== digest)
            for (const review of reviews) review.hub.emit({ type: "diff" });
          digest = next;
        } while (again);
      } catch (error) {
        console.error("Playground diff refresh:", error);
      } finally {
        checking = false;
      }
    }
    const relative = path
      .relative(repoRoot, path.resolve(repoRoot, directory))
      .split(path.sep)
      .join("/");
    watchers.push(
      watchTree(
        repoRoot,
        () => {
          void checkDiff();
        },
        {
          ignore: (file) =>
            isNoise(file) ||
            file === relative ||
            file.startsWith(`${relative}/`),
        },
      ),
    );
    heartbeat = setInterval(() => {
      for (const review of reviews) review.hub.ping();
    }, 25_000);
    console.log(`\nAnnotation playground: ${url}`);
    console.log(
      "Example → open a capture, popup, or drawing. Review → click a control or drag an area.",
    );
    console.log(`Feedback: ${feedback.url} → ${feedback.outDir}/`);
    console.log(`Example notes (separate): ${example.outDir}/`);
    console.log(
      "Ctrl+C stops the playground and its dedicated browser. Notes and pictures are kept.\n",
    );
    return {
      url,
      feedbackUrl: feedback.url,
      exampleUrl: example.url,
      profile,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (import.meta.main) {
  const shutdown = new AbortController();
  let playground: Awaited<ReturnType<typeof startWebPlayground>> | undefined;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      shutdown.abort();
      if (playground) void playground.close().then(() => process.exit(0));
    });
  }
  try {
    playground = await startWebPlayground({ signal: shutdown.signal });
  } catch (error) {
    if (!shutdown.signal.aborted) {
      console.error(
        `Playground: ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
    }
  }
}
