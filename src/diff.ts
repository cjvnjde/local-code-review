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
        file.rows.push({ t: "hunk", text: line });
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
