import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { imageType } from "../git/blob.ts";
import {
  CONTEXT_MAX_BYTES,
  CONTEXT_TEXT_LIMIT,
  CONTEXT_TEXT_MAX,
  contextId,
  type ContextManifest,
  type ContextPart,
  type ContextRef,
} from "../shared/context.ts";

export interface ContextPartInput {
  name: string;
  label: string;
  type: string;
  data?: string | Uint8Array;
  attachment?: string;
  status?: "available" | "unavailable" | "excluded";
  truncated?: boolean;
  detail?: string;
}
export interface ContextInput {
  label: string;
  at?: string;
  source?: ContextManifest["source"];
  parts: ContextPartInput[];
}
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const MANIFEST_MAX = 256 * 1024;
const digest = (bytes: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function label(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error("Context labels must contain 1–200 printable characters.");
}
async function rootOf(repoRoot: string, outDir: string, create = false) {
  const root = path.resolve(repoRoot, outDir);
  if (create) {
    const created = await mkdir(root, { recursive: true });
    if (created) {
      const stop = path.dirname(path.resolve(created));
      for (let parent = path.dirname(root); ; parent = path.dirname(parent)) {
        await syncDirectory(parent);
        if (parent === stop) break;
      }
    }
  }
  return realpath(root);
}
/** Every component beneath the review directory must be real, not a symlink. */
async function contained(root: string, relative: string, directory = false) {
  const pieces = relative.split("/");
  if (
    !pieces.length ||
    pieces.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        part.includes("\0"),
    )
  )
    throw new Error("Invalid context path.");
  let target = root;
  for (let i = 0; i < pieces.length; i++) {
    target = path.join(target, pieces[i]!);
    const info = await lstat(target);
    if (
      info.isSymbolicLink() ||
      ((i < pieces.length - 1 || directory) && !info.isDirectory())
    )
      throw new Error("Context paths must not cross symlinks.");
  }
  const resolved = await realpath(target);
  if (!resolved.startsWith(root + path.sep))
    throw new Error("Context path escapes review directory.");
  return resolved;
}
async function boundedFile(root: string, relative: string, max: number) {
  const target = await contained(root, relative);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > max)
      throw new Error(
        "Context file exceeds its size limit or is not a regular file.",
      );
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead)
        throw new Error("Context file changed while reading.");
      offset += result.bytesRead;
    }
    if ((await file.stat()).size !== info.size)
      throw new Error("Context file changed while reading.");
    return bytes;
  } finally {
    await file.close();
  }
}
async function durableFile(file: string, bytes: string | Uint8Array) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function attachmentPath(value: string) {
  if (
    !/^(?:images|assets)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    !/^\.\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
    throw new Error("Invalid context image attachment path.");
  if (!imageType(value))
    throw new Error("Context attachments must reference existing images.");
  return value.startsWith("./") ? value.slice(2) : value;
}
function validateManifest(value: unknown, id: string): ContextManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid context manifest.");
  const manifest = value as ContextManifest;
  const { id: storedId, ...body } = manifest;
  if (
    storedId !== id ||
    manifest.version !== 1 ||
    digest(canonical(body)) !== id
  )
    throw new Error("Context manifest integrity check failed.");
  label(manifest.label);
  if (
    typeof manifest.at !== "string" ||
    !Number.isFinite(Date.parse(manifest.at)) ||
    !Array.isArray(manifest.parts) ||
    !manifest.parts.length ||
    manifest.parts.length > 128
  )
    throw new Error("Invalid context manifest metadata.");
  if (manifest.source !== undefined) {
    if (
      !manifest.source ||
      typeof manifest.source !== "object" ||
      Array.isArray(manifest.source) ||
      Object.entries(manifest.source).some(
        ([key, value]) =>
          !["url", "title", "captureAt"].includes(key) ||
          typeof value !== "string" ||
          value.length > 16384,
      )
    )
      throw new Error("Invalid context source metadata.");
  }
  const names = new Set<string>();
  for (const part of manifest.parts) {
    if (
      !part ||
      typeof part !== "object" ||
      typeof part.name !== "string" ||
      !NAME.test(part.name) ||
      names.has(part.name)
    )
      throw new Error("Invalid or duplicate context part name.");
    names.add(part.name);
    label(part.label);
    if (
      typeof part.type !== "string" ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(part.type) ||
      !["available", "unavailable", "excluded"].includes(part.status) ||
      !Number.isSafeInteger(part.bytes) ||
      part.bytes < 0 ||
      part.bytes > CONTEXT_MAX_BYTES
    )
      throw new Error("Invalid context part metadata.");
    if (part.status === "available") {
      if (
        !part.sha256 ||
        !HASH.test(part.sha256) ||
        Boolean(part.file) === Boolean(part.attachment)
      )
        throw new Error("Invalid context part content reference.");
      if (part.file && part.file !== `${part.name}.part`)
        throw new Error("Invalid context part filename.");
      if (part.attachment) attachmentPath(part.attachment);
    } else if (part.file || part.attachment || part.sha256 || part.bytes !== 0)
      throw new Error("Unavailable context parts cannot reference content.");
    if (part.truncated !== undefined && typeof part.truncated !== "boolean")
      throw new Error("Invalid context truncation marker.");
    if (
      part.detail !== undefined &&
      (typeof part.detail !== "string" || part.detail.length > 2000)
    )
      throw new Error("Invalid context part detail.");
  }
  return manifest;
}
async function partBytes(root: string, id: string, part: ContextPart) {
  const bytes = await boundedFile(
    root,
    part.attachment
      ? attachmentPath(part.attachment)
      : `context/${id}/${part.file}`,
    CONTEXT_MAX_BYTES,
  );
  if (bytes.byteLength !== part.bytes || digest(bytes) !== part.sha256)
    throw new Error(`Context part integrity check failed: ${part.name}.`);
  return bytes;
}
async function manifestAt(root: string, id: string) {
  const bytes = await boundedFile(
    root,
    `context/${id}/manifest.json`,
    MANIFEST_MAX,
  );
  return validateManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    id,
  );
}
export async function saveContext(
  repoRoot: string,
  outDir: string,
  input: ContextInput,
): Promise<ContextRef> {
  label(input.label);
  if (
    !Array.isArray(input.parts) ||
    !input.parts.length ||
    input.parts.length > 128
  )
    throw new Error("Context requires 1–128 parts.");
  // Detach caller-owned values before the first asynchronous filesystem operation.
  input = {
    ...input,
    ...(input.source ? { source: { ...input.source } } : {}),
    parts: input.parts.map((part) => ({
      ...part,
      ...(part.data instanceof Uint8Array
        ? { data: new Uint8Array(part.data) }
        : {}),
    })),
  };
  const root = await rootOf(repoRoot, outDir, true);
  const directory = path.join(root, "context");
  await mkdir(directory, { recursive: true });
  await contained(root, "context", true);
  const parts: ContextPart[] = [];
  const payloads = new Map<string, Uint8Array>();
  for (const inputPart of input.parts) {
    const status = inputPart.status ?? "available";
    const part: ContextPart = {
      name: inputPart.name,
      label: inputPart.label,
      type: inputPart.type,
      status,
      bytes: 0,
      ...(inputPart.truncated !== undefined
        ? { truncated: inputPart.truncated }
        : {}),
      ...(inputPart.detail !== undefined ? { detail: inputPart.detail } : {}),
    };
    if (typeof part.name !== "string" || !NAME.test(part.name))
      throw new Error("Invalid context part name.");
    if (status === "available") {
      if (
        (inputPart.data !== undefined) ===
        (inputPart.attachment !== undefined)
      )
        throw new Error(
          "Available context parts require either data or an existing attachment.",
        );
      const bytes =
        inputPart.attachment !== undefined
          ? await boundedFile(
              root,
              attachmentPath(inputPart.attachment),
              CONTEXT_MAX_BYTES,
            )
          : typeof inputPart.data === "string"
            ? new TextEncoder().encode(inputPart.data)
            : inputPart.data!;
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength > CONTEXT_MAX_BYTES
      )
        throw new Error("Context part exceeds 12 MiB.");
      part.bytes = bytes.byteLength;
      part.sha256 = digest(bytes);
      if (inputPart.attachment !== undefined)
        part.attachment = inputPart.attachment;
      else {
        part.file = `${part.name}.part`;
        payloads.set(part.file, bytes);
      }
    } else if (
      inputPart.data !== undefined ||
      inputPart.attachment !== undefined
    )
      throw new Error(
        "Excluded or unavailable parts must not include content.",
      );
    parts.push(part);
  }
  const body = {
    version: 1 as const,
    label: input.label,
    at: input.at ?? new Date().toISOString(),
    ...(input.source ? { source: input.source } : {}),
    parts,
  };
  const id = digest(canonical(body));
  const manifest = validateManifest({ ...body, id }, id);
  const encoded = canonical(manifest);
  if (Buffer.byteLength(encoded) > MANIFEST_MAX)
    throw new Error("Context manifest is too large.");
  const temporary = path.join(directory, `.pending-${crypto.randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const [file, bytes] of payloads)
      await durableFile(path.join(temporary, file), bytes);
    await durableFile(path.join(temporary, "manifest.json"), encoded);
    await syncDirectory(temporary);
    await contained(root, "context", true);
    try {
      await rename(temporary, path.join(directory, id));
    } catch (error) {
      if (
        !["EEXIST", "ENOTEMPTY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      const existing = await readContext(repoRoot, outDir, id);
      if (!existing) throw new Error("Existing context bundle is incomplete.");
      for (const part of existing.parts)
        if (part.status === "available") await partBytes(root, id, part);
    }
    await syncDirectory(directory);
    await syncDirectory(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { id, label: input.label };
}
export async function readContext(
  repoRoot: string,
  outDir: string,
  rawId: string,
): Promise<ContextManifest | null> {
  const id = contextId(rawId);
  if (!id) throw new Error("Invalid context ID.");
  try {
    const root = await rootOf(repoRoot, outDir);
    return await manifestAt(root, id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function readContextPart(
  repoRoot: string,
  outDir: string,
  rawId: string,
  name: string,
): Promise<{
  manifest: ContextManifest;
  part: ContextPart;
  bytes: Uint8Array;
} | null> {
  const id = contextId(rawId);
  if (!id || !NAME.test(name))
    throw new Error("Invalid context ID or part name.");
  try {
    const root = await rootOf(repoRoot, outDir);
    const manifest = await manifestAt(root, id);
    const part = manifest.parts.find((part) => part.name === name);
    if (!part || part.status !== "available") return null;
    return { manifest, part, bytes: await partBytes(root, id, part) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export function contextTextSlice(
  bytes: Uint8Array,
  offset = 0,
  limit = CONTEXT_TEXT_LIMIT,
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length)
    throw new Error("offset must be a byte position within the part.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CONTEXT_TEXT_MAX)
    throw new Error(`limit must be an integer from 1 to ${CONTEXT_TEXT_MAX}.`);
  const continuation = (index: number) =>
    index < bytes.length && (bytes[index]! & 0xc0) === 0x80;
  if (continuation(offset))
    throw new Error("offset must be on a UTF-8 character boundary.");
  let end = Math.min(bytes.length, offset + limit);
  while (end > offset && continuation(end)) end--;
  if (end === offset && offset < bytes.length)
    throw new Error("limit is too small for the next UTF-8 character.");
  const content = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(offset, end),
  );
  return {
    content,
    offset,
    nextOffset: end < bytes.length ? end : null,
    totalBytes: bytes.length,
  };
}
