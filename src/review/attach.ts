import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { imageType } from "../git/blob.ts";

/**
 * Attachments live beside the review file and use ordinary relative Markdown links. Images retain
 * their existing hash names; other files include a bounded, filesystem-safe original filename.
 * Neither file contents nor filenames are interpreted as context or executable browser content.
 */
/** Where attachments are kept, relative to the review output directory. */
export const ATTACH_DIR = "images";

/** How a note points at one: relative to the review file it stands beside, not to the repository. */
export const attachRef = (name: string) => `${ATTACH_DIR}/${name}`;

/**
 * Refused above this, which is far above a screenshot and far below anything worth keeping in a
 * review directory. The reviewer is told the size rather than left with a note pointing at nothing.
 */
export const ATTACH_MAX_BYTES = 12 * 1024 * 1024;

/** Image media types that can be previewed; all other types are kept as downloadable files. */
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
  const bare =
    String(type || "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  return EXTENSIONS[bare] ?? "";
}

/**
 * One name in the attachment directory and nothing else: no separator, no traversal, nothing that
 * could reach out of the directory whatever a note claims to point at. It is deliberately wider than
 * what this mints, because the agent may answer with a picture of its own — a rendering, a chart of
 * what it measured — by putting it in the same directory and writing the same link.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Keeps exact bytes under an immutable name, returning empty only when the size limit is exceeded. */
export async function saveAttachment(
  repoRoot: string,
  outDir: string,
  bytes: Uint8Array,
  type: string,
  filename = "attachment",
): Promise<string> {
  const extension = attachExtension(type);
  if (bytes.byteLength > ATTACH_MAX_BYTES) return "";
  bytes = new Uint8Array(bytes);
  const digest = new Bun.CryptoHasher("sha256")
    .update(bytes)
    .digest("hex")
    .slice(0, 16);
  const label =
    filename
      .split(/[\\/]/)
      .pop()!
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/^[._-]+/, "")
      .slice(0, 120) || "attachment";
  const name = extension ? `${digest}.${extension}` : `${digest}-${label}`;
  const output = path.resolve(repoRoot, outDir);
  const created = await mkdir(output, { recursive: true });
  if (created && process.platform !== "win32") {
    const stop = path.dirname(path.resolve(created));
    for (let parent = path.dirname(output); ; parent = path.dirname(parent)) {
      const handle = await open(parent, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (parent === stop) break;
    }
  }
  const root = await realpath(output);
  const directory = path.join(root, ATTACH_DIR);
  await mkdir(directory, { recursive: true });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error("Attachment directory must not cross symlinks.");
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.pending-${crypto.randomUUID()}`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (
      (await lstat(directory)).isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw new Error("Attachment directory must not cross symlinks.");
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await existing.stat();
        if (!info.isFile() || info.size !== bytes.byteLength)
          throw new Error(
            "Existing attachment content does not match its immutable name.",
          );
        const saved = await existing.readFile();
        if (
          !saved.equals(
            Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          )
        )
          throw new Error(
            "Existing attachment content does not match its immutable name.",
          );
      } finally {
        await existing.close();
      }
    }
    if (process.platform !== "win32") {
      const dir = await open(directory, constants.O_RDONLY);
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      const rootDir = await open(root, constants.O_RDONLY);
      try {
        await rootDir.sync();
      } finally {
        await rootDir.close();
      }
    }
  } finally {
    await unlink(temporary);
  }
  return name;
}

/** Reads only bounded attachment files, never arbitrary siblings of the review or symlink escapes. */
export async function readAttachment(
  repoRoot: string,
  outDir: string,
  name: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  // Bare names are the original images/ API. Explicit paths are relative to the review file.
  const match = /^(images\/|assets\/|\.\/)?([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(
    name,
  );
  if (!match || !NAME.test(match[2]!)) return null;
  const image = imageType(match[2]!);
  if (
    !image &&
    !["images/", "assets/"].includes(match[1] ?? "") &&
    !/^[a-f0-9]{16}-[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)
  )
    return null;
  const type = image || "application/octet-stream";
  const root = await realpath(path.resolve(repoRoot, outDir)).catch(() => "");
  if (!root) return null;
  const directory = match[1] === "./" ? "" : (match[1] ?? `${ATTACH_DIR}/`);
  const target = await realpath(path.join(root, directory, match[2]!)).catch(
    () => "",
  );
  const relative = target ? path.relative(root, target) : "..";
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null;
  const file = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!file) return null;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > ATTACH_MAX_BYTES) return null;
    return { bytes: new Uint8Array(await file.readFile()), type };
  } catch {
    return null;
  } finally {
    await file.close();
  }
}
