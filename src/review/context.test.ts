import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveAttachment } from "./attach.ts";
import {
  contextTextSlice,
  readContext,
  readContextPart,
  saveContext,
  type ContextInput,
} from "./context.ts";
import { CONTEXT_MAX_BYTES, CONTEXT_TEXT_MAX } from "../shared/context.ts";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-context-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const input: ContextInput = {
  label: "Snapshot",
  at: "2026-11-03T00:00:00Z",
  parts: [
    {
      name: "content",
      label: "Reviewer text",
      type: "text/plain",
      data: "Saved exactly once.",
    },
  ],
};

test("immutable bundles roundtrip, deduplicate concurrent publication, and survive independent reads", async () => {
  const root = await fixture();
  const refs = await Promise.all([
    saveContext(root, ".review", input),
    saveContext(root, ".review", input),
  ]);
  expect(refs[0]).toEqual(refs[1]);
  const ref = refs[0]!;
  expect(await readdir(path.join(root, ".review/context"))).toEqual([ref.id]);
  const manifest = await readContext(root, ".review", ref.id);
  expect(manifest?.parts[0]).toMatchObject({
    name: "content",
    file: "content.part",
    bytes: 19,
    status: "available",
  });
  const part = await readContextPart(
    root,
    ".review",
    `context/${ref.id}/manifest.json`,
    "content",
  );
  expect(new TextDecoder().decode(part!.bytes)).toBe("Saved exactly once.");
  const changed = await saveContext(root, ".review", {
    ...input,
    parts: [{ ...input.parts[0]!, data: "Different snapshot" }],
  });
  expect(changed.id).not.toBe(ref.id);
  expect(await readContext(root, ".review", ref.id)).toEqual(manifest);
});

test("image parts reuse stored bytes and excluded parts contain no payload", async () => {
  const root = await fixture();
  const name = await saveAttachment(
    root,
    ".review",
    new TextEncoder().encode("image"),
    "image/png",
  );
  const ref = await saveContext(root, ".review", {
    ...input,
    parts: [
      {
        name: "image",
        label: "Screenshot",
        type: "image/png",
        attachment: `images/${name}`,
      },
      {
        name: "html",
        label: "Selected HTML",
        type: "text/html",
        status: "excluded",
        detail: "Not opted in.",
      },
    ],
  });
  expect(await readdir(path.join(root, ".review/context", ref.id))).toEqual([
    "manifest.json",
  ]);
  const manifest = await readContext(root, ".review", ref.id);
  expect(manifest!.parts[0]!.attachment).toBe(`images/${name}`);
  expect(await readContextPart(root, ".review", ref.id, "html")).toBeNull();
  await writeFile(path.join(root, ".review/images", name), "other");
  expect(await readContext(root, ".review", ref.id)).toEqual(manifest);
  await expect(
    readContextPart(root, ".review", ref.id, "image"),
  ).rejects.toThrow("integrity");
});

test("manifest and part tampering fail closed, and missing resources are explicit", async () => {
  const root = await fixture();
  expect(await readContext(root, ".review", "a".repeat(64))).toBeNull();
  const ref = await saveContext(root, ".review", input);
  const directory = path.join(root, ".review/context", ref.id);
  expect(await readContextPart(root, ".review", ref.id, "absent")).toBeNull();
  await writeFile(path.join(directory, "content.part"), "tampered");
  await expect(
    readContextPart(root, ".review", ref.id, "content"),
  ).rejects.toThrow("integrity");
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  manifest.label = "changed";
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  await expect(readContext(root, ".review", ref.id)).rejects.toThrow(
    "integrity",
  );
});

test("context and attachment symlinks cannot escape the review directory", async () => {
  const root = await fixture();
  const outside = await fixture();
  await mkdir(path.join(root, ".review"));
  await symlink(outside, path.join(root, ".review/context"));
  await expect(saveContext(root, ".review", input)).rejects.toThrow("symlink");
  expect(await readdir(outside)).toEqual([]);
  await rm(path.join(root, ".review/context"));
  const ref = await saveContext(root, ".review", input);
  const file = path.join(root, ".review/context", ref.id, "content.part");
  await writeFile(path.join(outside, "secret"), "Saved exactly once.");
  await rm(file);
  await symlink(path.join(outside, "secret"), file);
  await expect(
    readContextPart(root, ".review", ref.id, "content"),
  ).rejects.toThrow("symlink");
  await symlink(outside, path.join(root, ".review/images"));
  await writeFile(path.join(outside, "image.png"), "image");
  await expect(
    saveContext(root, ".review", {
      ...input,
      parts: [
        {
          name: "image",
          label: "Image",
          type: "image/png",
          attachment: "images/image.png",
        },
      ],
    }),
  ).rejects.toThrow("symlink");
});

test("invalid names, duplicate names, traversal and oversized parts are rejected", async () => {
  const root = await fixture();
  for (const name of ["../outside", "a/b", "manifest.json", ""])
    await expect(
      saveContext(root, ".review", {
        ...input,
        parts: [{ ...input.parts[0]!, name }],
      }),
    ).rejects.toThrow();
  await expect(
    saveContext(root, ".review", {
      ...input,
      parts: [input.parts[0]!, input.parts[0]!],
    }),
  ).rejects.toThrow("duplicate");
  await expect(
    saveContext(root, ".review", {
      ...input,
      parts: [
        { ...input.parts[0]!, data: new Uint8Array(CONTEXT_MAX_BYTES + 1) },
      ],
    }),
  ).rejects.toThrow("12 MiB");
  await expect(
    readContext(root, ".review", "../manifest.json"),
  ).rejects.toThrow("ID");
});

test("text continuation preserves UTF-8 boundaries and rejects invalid ranges", () => {
  const bytes = new TextEncoder().encode("a🙂éz");
  const first = contextTextSlice(bytes, 0, 4);
  expect(first).toEqual({
    content: "a",
    offset: 0,
    nextOffset: 1,
    totalBytes: 8,
  });
  const second = contextTextSlice(bytes, first.nextOffset!, 4);
  expect(second.content).toBe("🙂");
  expect(second.nextOffset).toBe(5);
  expect(contextTextSlice(bytes, 5, 4)).toEqual({
    content: "éz",
    offset: 5,
    nextOffset: null,
    totalBytes: 8,
  });
  expect(contextTextSlice(bytes, 8).content).toBe("");
  for (const [offset, limit] of [
    [-1, 4],
    [9, 4],
    [2, 4],
    [1, 1],
    [0, 0],
    [0, CONTEXT_TEXT_MAX + 1],
  ])
    expect(() => contextTextSlice(bytes, offset, limit)).toThrow();
  expect(() => contextTextSlice(new Uint8Array([0xff]))).toThrow();
});

test("publication snapshots mutable inputs before its first asynchronous write", async () => {
  const root = await fixture();
  const bytes = new TextEncoder().encode("original");
  const source = { title: "Original title" };
  const pending = saveContext(root, ".review", {
    ...input,
    source,
    parts: [{ ...input.parts[0]!, data: bytes }],
  });
  bytes.fill(0);
  source.title = "Later title";
  const ref = await pending;
  expect((await readContext(root, ".review", ref.id))!.source!.title).toBe(
    "Original title",
  );
  const stored = await readContextPart(root, ".review", ref.id, "content");
  expect(new TextDecoder().decode(stored!.bytes)).toBe("original");
});
