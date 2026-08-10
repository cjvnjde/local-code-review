import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git.ts";

/** The one definition of what lcr generated: nothing else in the output directory is ours to touch. */
const REVIEW_FILE = /^review-.*\.md$/;

export async function excludeRelativeOutput(repoRoot: string, outDir: string): Promise<void> {
  if (path.isAbsolute(outDir)) return;

  try {
    const gitDir = (await runGit(["rev-parse", "--git-dir"], repoRoot)).trim();
    const excludeFile = path.resolve(repoRoot, gitDir, "info", "exclude");
    const current = await readFile(excludeFile, "utf8").catch(() => "");
    const entry = `/${outDir.replace(/^\.\//, "").replace(/\/$/, "")}/`;
    if (current.split("\n").includes(entry)) return;

    await mkdir(path.dirname(excludeFile), { recursive: true });
    const separator = current.endsWith("\n") || !current ? "" : "\n";
    await writeFile(excludeFile, `${current}${separator}${entry}\n`, "utf8");
  } catch {
    // Exclusion is best effort. Review output must still be writable.
  }
}

/** Names of the generated review files in the output directory, oldest name first. */
export async function listReviews(repoRoot: string, outDir: string): Promise<string[]> {
  try {
    const names = await readdir(path.resolve(repoRoot, outDir));
    return names.filter((name) => REVIEW_FILE.test(name)).sort();
  } catch {
    return [];
  }
}

/**
 * Deletes generated review files and answers the names that went. `keep` survives, so a fresh save
 * can prune what came before it. Only names lcr writes itself are ever removed.
 */
export async function deleteReviews(repoRoot: string, outDir: string, keep = ""): Promise<string[]> {
  const directory = path.resolve(repoRoot, outDir);
  const removed: string[] = [];
  for (const name of await listReviews(repoRoot, outDir)) {
    if (name === keep) continue;
    try {
      await rm(path.join(directory, name));
      removed.push(name);
    } catch {
      // A file that cannot be removed is reported as still there rather than failing the save.
    }
  }
  return removed;
}
