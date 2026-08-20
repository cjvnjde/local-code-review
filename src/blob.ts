import path from "node:path";
import { INDEX, WORKTREE } from "./diff.ts";
import { runGitBytes } from "./git.ts";

/**
 * The content behind a file rather than the lines of it. A text diff carries both sides in itself,
 * so nothing here is needed to read one; an image is the case where git prints that the file differs
 * and stops, and the only way to show the reviewer what changed is to fetch the two blobs and put
 * them side by side. Everything is read out of the repository the run is already in: no path outside
 * it is served, and the diff on screen is what says which files may be asked for at all.
 */

/** Image types the page can draw, by extension. Anything else stays "binary file — not shown". */
const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  apng: "image/apng",
};

/** The media type of a path lcr will draw as a picture, or empty when it will not. */
export function imageType(file: string): string {
  const at = file.lastIndexOf(".");
  if (at < 0) return "";
  return TYPES[file.slice(at + 1).toLowerCase()] ?? "";
}

/**
 * One side of one file, as bytes. `side` is a revision, or the sentinels `diffSides` answers with:
 * the working tree is read off disk, and the index through `git show :<path>`. A blob that is not
 * there — the side that added the file, a working copy since deleted — is not an error, it is the
 * absence the page draws as "no image on this side".
 */
export async function readBlob(repoRoot: string, side: string, file: string): Promise<Uint8Array | null> {
  if (!file) return null;
  try {
    if (side === WORKTREE) {
      const full = path.resolve(repoRoot, file);
      // The caller only ever passes a path out of the diff, and this keeps it that way.
      if (full !== repoRoot && !full.startsWith(repoRoot + path.sep)) return null;
      const handle = Bun.file(full);
      return (await handle.exists()) ? new Uint8Array(await handle.arrayBuffer()) : null;
    }
    return await runGitBytes(["show", `${side === INDEX ? "" : side}:${file}`], repoRoot);
  } catch {
    return null;
  }
}
