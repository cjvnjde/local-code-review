import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { lock } from "proper-lockfile";
import { withReviewLock, writeReviewFile } from "./lock.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const workspace = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-review-lock-"));
  roots.push(dir);
  return dir;
};

test("a transaction holds the documented lock and releases it after failure", async () => {
  const dir = await workspace();
  const failure = new Error("Mutation failed.");
  await expect(
    withReviewLock(dir, async () => {
      await expect(
        lock(dir, { lockfilePath: path.join(dir, ".lcr.lock") }),
      ).rejects.toMatchObject({ code: "ELOCKED" });
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await readdir(dir)).toEqual([]);
  expect(await withReviewLock(dir, async () => "next transaction")).toBe(
    "next transaction",
  );
});

test("publication replaces the file atomically instead of exposing a truncated inode", async () => {
  const dir = await workspace(),
    file = path.join(dir, "review.md");
  await writeFile(file, "Original complete document.");
  const reader = await open(file, "r");
  try {
    await withReviewLock(dir, () =>
      writeReviewFile(file, "Replacement complete document."),
    );
    expect(await reader.readFile("utf8")).toBe("Original complete document.");
    expect(await readFile(file, "utf8")).toBe("Replacement complete document.");
    expect(await readdir(dir)).toEqual(["review.md"]);
  } finally {
    await reader.close();
  }
});

test("a failed publication removes its temporary file and releases the lock", async () => {
  const dir = await workspace(),
    destination = path.join(dir, "review.md");
  await mkdir(destination);
  await expect(
    withReviewLock(dir, () =>
      writeReviewFile(destination, "Cannot replace a directory."),
    ),
  ).rejects.toThrow();
  expect(await readdir(dir)).toEqual(["review.md"]);
  await withReviewLock(dir, () =>
    writeReviewFile(path.join(dir, "other.md"), "Still writable."),
  );
  expect(await readFile(path.join(dir, "other.md"), "utf8")).toBe(
    "Still writable.",
  );
});

test("a process killed while holding the lock can be recovered once its heartbeat is stale", async () => {
  const dir = await workspace();
  const acquired = Promise.withResolvers<void>();
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { withReviewLock } from ${JSON.stringify(import.meta.resolve("./lock.ts"))};
    await withReviewLock(${JSON.stringify(dir)}, async () => {
      process.send({ type: "locked" });
      await Bun.stdin.text();
    });
  `,
    ],
    {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
      ipc(message) {
        if (message?.type === "locked") acquired.resolve();
      },
    },
  );
  const errors = new Response(child.stderr).text();
  void child.exited.then(async (code) => {
    acquired.reject(
      new Error(
        `Child exited (${code}) before acquiring its lock: ${await errors}`,
      ),
    );
  });
  try {
    await acquired.promise;
    child.kill("SIGKILL");
    await child.exited;
    // Age the persisted heartbeat, not a sleep or a mocked clock: the next process sees stale state.
    await utimes(path.join(dir, ".lcr.lock"), new Date(0), new Date(0));
    await withReviewLock(dir, () =>
      writeReviewFile(path.join(dir, "review.md"), "Recovered."),
    );
    expect(await readFile(path.join(dir, "review.md"), "utf8")).toBe(
      "Recovered.",
    );
    expect(await readdir(dir)).toEqual(["review.md"]);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
});
