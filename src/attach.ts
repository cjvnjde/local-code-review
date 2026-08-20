import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { imageType } from "./blob.ts";

/**
 * Pictures the reviewer puts into a note. Some things are quicker shown than described — this control
 * sits over that one, this render is wrong here — and a screenshot is already in the clipboard by the
 * time the thought is finished, so a note takes one the way it takes prose.
 *
 * They are kept beside the review file they belong to, in one directory under the output directory,
 * and pointed at from the note as the ordinary Markdown image `![alt](images/<name>)`. That is the
 * whole of what is written down: the link resolves against the review file the way every relative
 * link in a Markdown document does, so the agent reading the file can open the picture, and so can
 * an editor previewing it, without either being told anything about lcr.
 *
 * A name is the hash of the bytes under it. The same screenshot pasted into three notes is therefore
 * one file the three of them point at, and a name never means two different pictures — which is what
 * lets the page cache one for good rather than fetching it again on every repaint.
 */

/** Where the pictures are kept, relative to the review output directory. */
export const ATTACH_DIR = "images";

/** How a note points at one: relative to the review file it stands beside, not to the repository. */
export const attachRef = (name: string) => `${ATTACH_DIR}/${name}`;

/**
 * Refused above this, which is far above a screenshot and far below anything worth keeping in a
 * review directory. The reviewer is told the size rather than left with a note pointing at nothing.
 */
export const ATTACH_MAX_BYTES = 12 * 1024 * 1024;

/** What each type is written down as. A type with no extension here is not something lcr will keep. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/apng": "apng",
};

/**
 * The extension a media type is kept under, or empty for a type lcr does not draw. The header the
 * browser sends carries parameters, and a clipboard's `image/PNG` is the same type as any other.
 */
export function attachExtension(type: string): string {
  const bare = String(type || "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return EXTENSIONS[bare] ?? "";
}

/**
 * One name in the attachment directory and nothing else: no separator, no traversal, nothing that
 * could reach out of the directory whatever a note claims to point at. It is deliberately wider than
 * what this mints, because the agent may answer with a picture of its own — a rendering, a chart of
 * what it measured — by putting it in the same directory and writing the same link.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const dirOf = (repoRoot: string, outDir: string) => path.resolve(repoRoot, outDir, ATTACH_DIR);

/**
 * Keeps one picture and answers the name it is kept under, or empty for a type or a size that is not
 * kept. Content-addressed, so writing the same bytes again is writing the same file: a reviewer who
 * pastes one screenshot into two notes leaves one picture behind, and the second write is the first
 * one's content all over again rather than a second copy of it.
 */
export async function saveAttachment(
  repoRoot: string,
  outDir: string,
  bytes: Uint8Array,
  type: string,
): Promise<string> {
  const extension = attachExtension(type);
  if (!extension || !bytes.byteLength || bytes.byteLength > ATTACH_MAX_BYTES) return "";
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);
  const name = `${digest}.${extension}`;
  const directory = dirOf(repoRoot, outDir);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), bytes);
  return name;
}

/**
 * One picture back, for the page that has to draw the note it is in. The name is checked before it is
 * ever joined to a path, so the one directory is the whole of what a note can reach, whatever the link
 * in it says; a name nothing was kept under is an absence rather than a failure.
 */
export async function readAttachment(
  repoRoot: string,
  outDir: string,
  name: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!NAME.test(name)) return null;
  const type = imageType(name);
  if (!type) return null;
  const bytes = await readFile(path.join(dirOf(repoRoot, outDir), name)).catch(() => null);
  return bytes ? { bytes: new Uint8Array(bytes), type } : null;
}
