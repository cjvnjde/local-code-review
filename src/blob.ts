import path from "node:path";
import { INDEX, WORKTREE } from "./diff.ts";
import { runGitBytes } from "./git.ts";

/**
 * The content behind a file rather than the lines of it. A text diff carries both sides in itself,
 * while a binary diff only says that the file differs. Media files are useful only when the
 * reviewer can see or hear their contents, so both sides are fetched from the repository. The diff
 * on screen says which files may be asked for, and nothing outside the run's repository is served.
 */

/** Media types browsers can render inline. Anything else stays "binary file — not shown". */
const IMAGE_TYPES = {
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
const AUDIO_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  weba: "audio/webm",
};

function fileType(file: string, types: Record<string, string>) {
  const at = file.lastIndexOf(".");
  if (at < 0) return "";
  return types[file.slice(at + 1).toLowerCase()] ?? "";
}

/** Media type of a path lcr will draw as a picture, or empty when it will not. */
export function imageType(file: string): string {
  return fileType(file, IMAGE_TYPES);
}

/** Media type of a path lcr can render inline, or empty when it cannot. */
export function mediaType(file: string): string {
  return imageType(file) || fileType(file, AUDIO_TYPES);
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
