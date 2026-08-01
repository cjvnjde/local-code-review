import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git.ts";
import { renderMarkdown } from "./review.ts";
import type { ReviewSubmission } from "./types.ts";

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

export async function saveReview(
  repoRoot: string,
  outDir: string,
  range: string,
  submission: ReviewSubmission,
): Promise<string> {
  const markdown = renderMarkdown(submission, range);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = path.resolve(repoRoot, outDir);
  await mkdir(outputDir, { recursive: true });
  const absoluteFile = path.join(outputDir, `review-${stamp}.md`);
  await writeFile(absoluteFile, markdown, "utf8");
  return path.isAbsolute(outDir) ? absoluteFile : path.relative(repoRoot, absoluteFile);
}
