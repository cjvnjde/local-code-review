import { runGit } from "./git.ts";
import type { DiffFile, DiffRow, FileStatus } from "./types.ts";

interface MutableDiffFile {
  path: string;
  status: FileStatus;
  rows: DiffRow[];
  added: number;
  removed: number;
  binary?: boolean;
  body: string[];
}

export interface DiffSource {
  repoRoot: string;
  context: number;
  diffArgs: string[];
}

export function diffRangeLabel(diffArgs: string[]): string {
  return diffArgs.length === 0 ? "working tree vs HEAD (incl. untracked)" : diffArgs.join(" ");
}

export async function getDiff(source: DiffSource): Promise<DiffFile[]> {
  const defaultMode = source.diffArgs.length === 0;
  if (defaultMode) {
    await runGit(["add", "-N", "--", "."], source.repoRoot).catch(() => {});
  }
  const args = defaultMode ? ["HEAD"] : source.diffArgs;
  const raw = await runGit(
    ["diff", "--no-color", "--no-ext-diff", `-U${source.context}`, ...args],
    source.repoRoot,
  );
  return parseDiff(raw);
}

/** Wide enough that git prints one file as a single hunk, so every unchanged line comes with it. */
const FULL_CONTEXT = 1_000_000;
/** Ceiling on one expansion, so a request for a whole huge file cannot flood the page. */
const MAX_CONTEXT_ROWS = 20_000;

/**
 * Unchanged lines the diff left out between hunks, addressed by new-side line number.
 * Re-diffing the file with unlimited context answers for every revision spec the tool accepts —
 * working tree, index, or a range — without having to work out which side to read the blob from.
 */
export async function getFileContext(
  source: DiffSource,
  path: string,
  start: number,
  end: number,
): Promise<DiffRow[]> {
  if (!path || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return [];
  const last = Math.min(end, start + MAX_CONTEXT_ROWS - 1);
  const args = source.diffArgs.length === 0 ? ["HEAD"] : source.diffArgs;
  const whole = ["diff", "--no-color", "--no-ext-diff", `-U${FULL_CONTEXT}`, ...args];
  // Narrowing to one file keeps the re-diff cheap, but arguments already carrying a pathspec can
  // reject a second one, so a rejected narrow run falls back to diffing everything.
  const scoped = args.includes("--") ? [...whole, path] : [...whole, "--", path];
  const raw = await runGit(scoped, source.repoRoot).catch(() => runGit(whole, source.repoRoot));
  return contextRows(parseDiff(raw), path, start, last);
}

/** Context rows of one file inside an inclusive new-side line range. */
export function contextRows(files: DiffFile[], path: string, start: number, end: number): DiffRow[] {
  const file = files.find((entry) => entry.path === path);
  if (!file) return [];
  return file.rows.filter((row) => row.t === "ctx" && row.n != null && row.n >= start && row.n <= end);
}

/** Cheap content fingerprint. Viewed marks expire when file diff changes. */
export function fingerprint(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function parseDiff(raw: string): DiffFile[] {
  const files: MutableDiffFile[] = [];
  let file: MutableDiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = { path: "", status: "modified", rows: [], added: 0, removed: 0, body: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    file.body.push(line);

    if (line.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (line.startsWith("rename to ")) {
      file.status = "renamed";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const diffPath = line.slice(4);
      if (diffPath !== "/dev/null") file.path = diffPath.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("--- ")) {
      const diffPath = line.slice(4);
      if (!file.path && diffPath !== "/dev/null") file.path = diffPath.replace(/^a\//, "");
      continue;
    }
    if (line.startsWith("Binary files")) {
      file.binary = true;
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
        const row: DiffRow = { t: "hunk", text: line };
        if (match[3]) row.head = match[3];
        file.rows.push(row);
      }
      continue;
    }
    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      file.rows.push({ t: "add", n: newNo++, text });
      file.added++;
    } else if (marker === "-") {
      file.rows.push({ t: "del", o: oldNo++, text });
      file.removed++;
    } else if (marker === " ") {
      file.rows.push({ t: "ctx", n: newNo++, o: oldNo++, text });
    }
  }

  return files.filter((entry) => entry.path).map(({ body, ...entry }) => ({
    ...entry,
    hash: fingerprint(body.join("\n")),
  }));
}
