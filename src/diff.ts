import { runGit } from "./git.ts";
import type { DiffFile, DiffRow, FileStatus } from "./types.ts";

interface MutableDiffFile {
  path: string;
  from?: string;
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

/**
 * Commit the diff is measured against, as a short hash. It is what tells two conversations on the
 * same range apart: `main..HEAD` before and after the branch was merged and restarted is the same
 * string over different work, and the base is what moved. Symmetric ranges take the merge base —
 * the agent committing onto the branch must not read as new work — and everything is best effort:
 * a base git cannot resolve is recorded as nothing, which matches any.
 */
export async function diffBase(source: DiffSource): Promise<string> {
  const revs = source.diffArgs.slice(0, whereDashDash(source.diffArgs)).filter((arg) => !arg.startsWith("-"));
  const short = (rev: string) => runGit(["rev-parse", "--short=12", `${rev || "HEAD"}^{commit}`], source.repoRoot);
  try {
    const symmetric = revs.find((arg) => arg.includes("..."));
    if (symmetric) {
      const [a, b] = symmetric.split("...", 2) as [string, string];
      const merged = (await runGit(["merge-base", a || "HEAD", b || "HEAD"], source.repoRoot)).trim();
      return (await short(merged)).trim();
    }
    const range = revs.find((arg) => arg.includes(".."));
    if (range) return (await short(range.split("..", 2)[0] as string)).trim();
    return (await short(revs[0] ?? "HEAD")).trim();
  } catch {
    return "";
  }
}

const whereDashDash = (args: string[]) => {
  const at = args.indexOf("--");
  return at < 0 ? args.length : at;
};

/** The new side is the working tree as it stands, which is no revision at all. */
export const WORKTREE = "";
/** The new side is what has been staged: `git show :<path>` reads a blob out of the index. */
export const INDEX = ":";

/** Where each side of the diff is read from, for the content git prints no lines of. */
export interface DiffSides {
  old: string;
  new: string;
}

/**
 * The two revisions the diff is between. A text diff never needs them — git has already printed both
 * sides into it — but a binary one says only that the file differs, so an image can only be shown by
 * going back for the blobs, and that means picking a side after all.
 *
 * The reading matches git's own: a symmetric range takes the merge base, an ordinary range takes its
 * ends, and anything left over is the working tree, or the index when the diff is `--cached`. A bare
 * argument is a revision or a pathspec and only git can say which, so one that is not a commit is
 * left out — a run narrowed to a directory reads its sides exactly as an unnarrowed one does.
 */
export async function diffSides(source: DiffSource): Promise<DiffSides> {
  const args = source.diffArgs.slice(0, whereDashDash(source.diffArgs));
  const revs = args.filter((arg) => !arg.startsWith("-"));
  const staged = args.some((arg) => arg === "--cached" || arg === "--staged");
  const symmetric = revs.find((arg) => arg.includes("..."));
  if (symmetric) {
    const [a, b] = symmetric.split("...", 2) as [string, string];
    const merged = await runGit(["merge-base", a || "HEAD", b || "HEAD"], source.repoRoot)
      .then((text) => text.trim())
      .catch(() => "");
    return { old: merged || a || "HEAD", new: b || "HEAD" };
  }
  const range = revs.find((arg) => arg.includes(".."));
  if (range) {
    const [a, b] = range.split("..", 2) as [string, string];
    return { old: a || "HEAD", new: b || "HEAD" };
  }
  const named: string[] = [];
  for (const rev of revs) if (await isCommit(source.repoRoot, rev)) named.push(rev);
  if (named.length >= 2) return { old: named[0] as string, new: named[1] as string };
  return { old: named[0] ?? "HEAD", new: staged ? INDEX : WORKTREE };
}

/** Whether git reads an argument as a commit; a pathspec answers no, and so does anything unresolvable. */
async function isCommit(repoRoot: string, rev: string): Promise<boolean> {
  if (!rev) return false;
  return await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], repoRoot)
    .then((text) => !!text.trim())
    .catch(() => false);
}

export async function getDiff(source: DiffSource): Promise<DiffFile[]> {
  const defaultMode = source.diffArgs.length === 0;
  if (defaultMode) {
    await runGit(["add", "-N", "--", "."], source.repoRoot).catch(() => {});
  }
  const args = defaultMode ? ["HEAD"] : source.diffArgs;
  const raw = await runGit(
    [...DIFF_ARGS, `-U${source.context}`, ...args],
    source.repoRoot,
  );
  return parseDiff(raw);
}

/**
 * Pinned diff shape, whatever the user's git config says: `a/`/`b/` prefixes the parser strips, and
 * unquoted UTF-8 paths so a non-ASCII file name comes through as itself rather than octal escapes.
 */
const DIFF_ARGS = [
  "-c", "core.quotepath=false",
  "diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/",
];

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
  const whole = [...DIFF_ARGS, `-U${FULL_CONTEXT}`, ...args];
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

/** A `---`/`+++` path: the quoting undone, the disambiguating tab a spaced name carries dropped. */
function headerPath(text: string): string {
  return unquotePath(text.endsWith("\t") ? text.slice(0, -1) : text);
}

/** Undoes git's C-style path quoting, kept for names holding quotes, backslashes, or control bytes. */
function unquotePath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const inner = text.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i] as string;
    if (char !== "\\" || i + 1 >= inner.length) {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const next = inner[++i] as string;
    if (next >= "0" && next <= "7") {
      let octal = next;
      while (octal.length < 3 && (inner[i + 1] as string) >= "0" && (inner[i + 1] as string) <= "7") {
        octal += inner[++i];
      }
      bytes.push(parseInt(octal, 8));
      continue;
    }
    const known: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };
    bytes.push(...encoder.encode(known[next] ?? next));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Path off the `diff --git a/<path> b/<path>` line, for the diff forms that carry no `---`/`+++`
 * lines to read it from: binary changes, pure renames, and mode-only changes. Space makes the two
 * halves ambiguous, so the equal split is trusted first and rename lines correct the rest.
 */
function pathFromGitLine(line: string): string {
  const rest = line.slice("diff --git ".length);
  const quoted = /^"a\/(.*)" "b\/(.*)"$/.exec(rest);
  if (quoted && quoted[1] === quoted[2]) return unquotePath(`"${quoted[2]}"`);
  const plain = /^a\/(.*) b\/(.*)$/.exec(rest);
  if (plain && plain[1] === plain[2]) return plain[2] as string;
  const at = rest.lastIndexOf(" b/");
  return at >= 0 ? unquotePath(rest.slice(at + 3)) : "";
}

export function parseDiff(raw: string): DiffFile[] {
  const files: MutableDiffFile[] = [];
  let file: MutableDiffFile | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = { path: pathFromGitLine(line), status: "modified", rows: [], added: 0, removed: 0, body: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    file.body.push(line);

    // Header lines only come before the first hunk; inside one, `+++ x` is an added `++ x` line.
    if (!inHunk) {
      if (line.startsWith("new file mode")) {
        file.status = "added";
        continue;
      }
      if (line.startsWith("deleted file mode")) {
        file.status = "deleted";
        continue;
      }
      if (line.startsWith("rename from ")) {
        file.from = headerPath(line.slice("rename from ".length));
        continue;
      }
      if (line.startsWith("rename to ")) {
        file.status = "renamed";
        file.path = headerPath(line.slice("rename to ".length));
        continue;
      }
      if (line.startsWith("+++ ")) {
        const diffPath = headerPath(line.slice(4));
        if (diffPath !== "/dev/null") file.path = diffPath.replace(/^b\//, "");
        continue;
      }
      if (line.startsWith("--- ")) {
        const diffPath = headerPath(line.slice(4));
        if (!file.path && diffPath !== "/dev/null") file.path = diffPath.replace(/^a\//, "");
        continue;
      }
      if (line.startsWith("Binary files")) {
        file.binary = true;
        continue;
      }
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
        inHunk = true;
        const row: DiffRow = { t: "hunk", text: line };
        if (match[3]) row.head = match[3];
        file.rows.push(row);
      }
      continue;
    }
    if (line.startsWith("\\")) continue;
    if (!inHunk) continue;

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
