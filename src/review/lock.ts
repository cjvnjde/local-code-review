import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { lock } from "proper-lockfile";

/**
 * One lock for the entire output directory: minting names and deleting older reviews must share
 * the same boundary as every read-modify-write. Canonical paths also coordinate symlink aliases.
 * External writers must use this protocol too; a lock cannot protect against an unaware editor.
 */
export async function withReviewLock<T>(
  directory: string,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const canonical = await realpath(directory);
  const release = await lock(canonical, {
    lockfilePath: path.join(canonical, ".lcr.lock"),
    stale: 10_000,
    update: 5_000,
    retries: { retries: 200, factor: 1.2, minTimeout: 10, maxTimeout: 100 },
  });
  try {
    return await work();
  } finally {
    await release();
  }
}

/** Publish complete Markdown even to readers that do not participate in our lock protocol. */
export async function writeReviewFile(
  file: string,
  text: string,
): Promise<void> {
  const temporary = path.join(path.dirname(file), `.lcr-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
