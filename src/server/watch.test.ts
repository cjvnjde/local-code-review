import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isNoise, watchDir, watchTree, type Watcher } from "./watch.ts";

// These integration tests await actual OS notifications. Real timer waits are intentional for
// debounce cancellation and retry/poll lifecycles: fake time cannot drive the native fs watcher.
const roots: string[] = [];
const watchers: Watcher[] = [];
const writers: ReturnType<typeof setInterval>[] = [];
afterEach(async () => {
  for (const writer of writers.splice(0)) clearInterval(writer);
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-watch-"));
  roots.push(root);
  return root;
}

async function writeUntil<T>(
  file: string,
  contents: string,
  signal: Promise<T>,
) {
  // Native subscriptions may miss a write made in the same tick as fs.watch construction.
  const writer = setInterval(() => writeFileSync(file, contents), 250);
  writers.push(writer);
  try {
    return await signal;
  } finally {
    clearInterval(writer);
  }
}

const nativeTreeTest = (() => {
  const root = mkdtempSync(path.join(tmpdir(), "lcr-watch-probe-"));
  try {
    const probe = watch(root, { recursive: true }, () => {});
    probe.close();
    return test;
  } catch {
    return test.skip;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})();

describe("watch noise boundaries", () => {
  test("ignores complete generated directory segments on both separator styles", () => {
    for (const name of [
      ".git",
      "node_modules",
      ".next",
      ".turbo",
      "dist",
      "build",
      "target",
      "__pycache__",
    ])
      for (const relative of [
        name,
        `${name}/entry`,
        `src/${name}/entry`,
        `src\\${name}\\entry`,
      ])
        expect(isNoise(relative)).toBe(true);
  });

  test("does not discard source files that merely contain generated-directory names", () => {
    for (const relative of [
      ".github/workflow.yml",
      "dist.ts",
      "src/building.ts",
      "node_modules_backup/index.ts",
      "my-target/file",
      "src/targeted/file",
      "distribution/file",
      "src/git.ts",
    ])
      expect(isNoise(relative)).toBe(false);
  });
});

describe("watchTree lifecycle", () => {
  nativeTreeTest(
    "recursive changes reach the callback but a custom ignored path does not",
    async () => {
      const root = await directory();
      await mkdir(path.join(root, "src"));
      const ignored = Promise.withResolvers<void>();
      const changed = Promise.withResolvers<void>();
      let calls = 0;
      const watcher = watchTree(
        root,
        () => {
          calls++;
          changed.resolve();
        },
        {
          delay: 20,
          ignore: (relative) => {
            if (relative.endsWith("ignored.txt")) {
              ignored.resolve();
              return true;
            }
            return !relative.endsWith("app.txt");
          },
        },
      );
      watchers.push(watcher);
      await writeUntil(
        path.join(root, "src", "ignored.txt"),
        "ignored",
        ignored.promise,
      );
      await delay(50);
      expect(calls).toBe(0);
      await writeUntil(
        path.join(root, "src", "app.txt"),
        "changed",
        changed.promise,
      );
      expect(calls).toBe(1);
    },
  );

  nativeTreeTest(
    "close cancels a debounce already scheduled by a native change",
    async () => {
      const root = await directory();
      const observed = Promise.withResolvers<void>();
      let calls = 0;
      const watcher = watchTree(
        root,
        () => {
          calls++;
        },
        {
          delay: 80,
          ignore: () => {
            observed.resolve();
            return false;
          },
        },
      );
      watchers.push(watcher);
      await writeUntil(path.join(root, "app.txt"), "change", observed.promise);
      watcher.close();
      watcher.close();
      await delay(120);
      expect(calls).toBe(0);
    },
  );

  test("a missing tree uses polling and close stops all future ticks", async () => {
    const root = await directory();
    const ticked = Promise.withResolvers<void>();
    let calls = 0;
    const watcher = watchTree(
      path.join(root, "not-created"),
      () => {
        if (++calls === 2) ticked.resolve();
      },
      { poll: 10 },
    );
    watchers.push(watcher);
    await ticked.promise;
    watcher.close();
    const stopped = calls;
    await delay(40);
    expect(calls).toBe(stopped);
  });
});

describe("watchDir lifecycle", () => {
  test("reports a filename and suppresses all notifications after close", async () => {
    const root = await directory();
    const changed = Promise.withResolvers<string>();
    const files: string[] = [];
    const watcher = watchDir(
      root,
      (file) => {
        files.push(file);
        changed.resolve(file);
      },
      20,
    );
    watchers.push(watcher);
    const writer = setInterval(
      () => writeFileSync(path.join(root, "review-1.md"), "first"),
      250,
    );
    writers.push(writer);
    try {
      expect(await changed.promise).toBe("review-1.md");
    } finally {
      clearInterval(writer);
    }
    watcher.close();
    const before = [...files];
    await writeFile(path.join(root, "review-2.md"), "second");
    await delay(60);
    expect(files).toEqual(before);
  });

  test("catches up with the latest review written before the output directory was watched", async () => {
    const root = await directory();
    const output = path.join(root, ".review");
    const file = path.join(output, "review.md");
    const changed = Promise.withResolvers<string>();
    watchers.push(
      watchDir(output, () => changed.resolve(readFile(file, "utf8")), 5),
    );
    // Both saves finish before the first attachment attempt; there is no later write to rescue it.
    mkdirSync(output);
    writeFileSync(file, "first answer");
    writeFileSync(file, "new answer");
    expect(await changed.promise).toBe("new answer");
  }, 5000);

  test("re-arms when the output directory disappears during a change callback", async () => {
    const root = await directory();
    const output = path.join(root, ".review");
    await mkdir(output);
    await writeFile(path.join(output, "old.md"), "old");
    const deleted = Promise.withResolvers<void>();
    const replaced = Promise.withResolvers<string>();
    let phase: "delete" | "replace" = "delete";
    watchers.push(
      watchDir(
        output,
        () => {
          if (phase === "delete") {
            // Remove synchronously inside the real change signal: watchDir checks existence
            // immediately after this callback, without relying on OS deletion-event ordering.
            rmSync(output, { recursive: true });
            phase = "replace";
            deleted.resolve();
          } else
            replaced.resolve(readFile(path.join(output, "new.md"), "utf8"));
        },
        5,
      ),
    );
    const trigger = setInterval(
      () => writeFileSync(path.join(output, "old.md"), "changed"),
      250,
    );
    writers.push(trigger);
    try {
      await deleted.promise;
    } finally {
      clearInterval(trigger);
    }
    mkdirSync(output);
    writeFileSync(path.join(output, "new.md"), "new");
    expect(await replaced.promise).toBe("new");
  }, 5000);

  test("follows existing and new review files through atomic saves", async () => {
    const root = await directory();
    const current = path.join(root, "review-1.md");
    const next = path.join(root, "review-2.md");
    const temporary = path.join(root, ".saving");
    let expected = path.basename(current);
    let changed = Promise.withResolvers<void>();
    watchers.push(
      watchDir(
        root,
        (file) => {
          if (file === expected) changed.resolve();
        },
        5,
      ),
    );
    // Establish the native subscription before testing one-shot edits.
    await writeUntil(current, "initial", changed.promise);
    for (const [file, contents] of [
      [current, "current atomic save"],
      [next, "new review atomic save"],
      [next, "later atomic save"],
    ] as const) {
      expected = path.basename(file);
      changed = Promise.withResolvers<void>();
      await writeFile(temporary, contents);
      await rename(temporary, file);
      await changed.promise;
      expect(await readFile(file, "utf8")).toBe(contents);
    }
  });

  test("closing before the directory exists also cancels the attachment retry", async () => {
    const root = await directory();
    const output = path.join(root, ".review");
    let calls = 0;
    const watcher = watchDir(
      output,
      () => {
        calls++;
      },
      5,
    );
    watchers.push(watcher);
    watcher.close();
    watcher.close();
    await mkdir(output);
    const writer = setInterval(
      () => writeFileSync(path.join(output, "review.md"), "saved"),
      30,
    );
    writers.push(writer);
    try {
      await delay(1100);
      expect(calls).toBe(0);
    } finally {
      clearInterval(writer);
    }
  }, 5000);
});
