import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { ATTACH_DIR, ATTACH_MAX_BYTES, attachExtension, attachRef, readAttachment, saveAttachment } from "./attach.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const dir = () => mkdtemp(path.join(tmpdir(), "lcr-attach-"));
const kept = (root: string) => readdir(path.join(root, ".review", ATTACH_DIR)).catch(() => []);

describe("attachExtension", () => {
  test("names what a type is kept as, through the parameters a browser sends", () => {
    expect(attachExtension("image/png")).toBe("png");
    expect(attachExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(attachExtension("IMAGE/PNG")).toBe("png");
    expect(attachExtension("image/svg+xml")).toBe("svg");
  });

  test("answers nothing for what lcr does not keep", () => {
    expect(attachExtension("application/pdf")).toBe("");
    expect(attachExtension("text/plain")).toBe("");
    expect(attachExtension("")).toBe("");
  });
});

describe("attachRef", () => {
  test("points at the picture from the review file beside it, not from the repository", () => {
    expect(attachRef("a1b2.png")).toBe("images/a1b2.png");
  });
});

describe("saveAttachment", () => {
  test("keeps the picture under the hash of what is in it, and reads it back", async () => {
    const root = await dir();
    const name = await saveAttachment(root, ".review", bytes("a screenshot"), "image/png");
    expect(name).toMatch(/^[0-9a-f]{16}\.png$/);

    const found = await readAttachment(root, ".review", name);
    expect(found?.type).toBe("image/png");
    expect(new TextDecoder().decode(found!.bytes)).toBe("a screenshot");
  });

  test("the same picture twice is one file, so a screenshot in two notes is kept once", async () => {
    const root = await dir();
    const first = await saveAttachment(root, ".review", bytes("same"), "image/png");
    const second = await saveAttachment(root, ".review", bytes("same"), "image/png");
    expect(second).toBe(first);
    expect(await kept(root)).toEqual([first]);
  });

  test("the same bytes under another type are another picture", async () => {
    const root = await dir();
    const png = await saveAttachment(root, ".review", bytes("same"), "image/png");
    const webp = await saveAttachment(root, ".review", bytes("same"), "image/webp");
    expect(webp).not.toBe(png);
    expect((await kept(root)).sort()).toEqual([png, webp].sort());
  });

  test("nothing is kept for a type lcr cannot draw, an empty body, or one over the limit", async () => {
    const root = await dir();
    expect(await saveAttachment(root, ".review", bytes("x"), "application/pdf")).toBe("");
    expect(await saveAttachment(root, ".review", new Uint8Array(0), "image/png")).toBe("");
    expect(await saveAttachment(root, ".review", new Uint8Array(ATTACH_MAX_BYTES + 1), "image/png")).toBe("");
    expect(await kept(root)).toEqual([]);
  });

  test("keeps the bytes exactly, because a picture is not text", async () => {
    const root = await dir();
    const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);
    const name = await saveAttachment(root, ".review", raw, "image/png");
    const written = await readFile(path.join(root, ".review", ATTACH_DIR, name));
    expect(new Uint8Array(written)).toEqual(raw);
    expect((await readAttachment(root, ".review", name))!.bytes).toEqual(raw);
  });
});

describe("readAttachment", () => {
  test("a name nothing was kept under is an absence rather than a failure", async () => {
    const root = await dir();
    expect(await readAttachment(root, ".review", "nothing.png")).toBeNull();
  });

  test("nothing outside the attachment directory is reachable, however the name is written", async () => {
    const root = await dir();
    await saveAttachment(root, ".review", bytes("kept"), "image/png");
    await writeFile(path.join(root, "secret.png"), "not the review's", "utf8");
    expect(await readAttachment(root, ".review", "../secret.png")).toBeNull();
    expect(await readAttachment(root, ".review", "../../secret.png")).toBeNull();
    expect(await readAttachment(root, ".review", "/etc/hosts")).toBeNull();
    expect(await readAttachment(root, ".review", "..")).toBeNull();
    expect(await readAttachment(root, ".review", "")).toBeNull();
  });

  test("only a picture is served, so the review file itself is not asked for through this", async () => {
    const root = await dir();
    await saveAttachment(root, ".review", bytes("kept"), "image/png");
    await writeFile(path.join(root, ".review", ATTACH_DIR, "notes.md"), "# not a picture", "utf8");
    expect(await readAttachment(root, ".review", "notes.md")).toBeNull();
  });

  test("a picture the agent put there itself is read like any other", async () => {
    const root = await dir();
    await saveAttachment(root, ".review", bytes("mine"), "image/png");
    await writeFile(path.join(root, ".review", ATTACH_DIR, "after-fix.png"), "the agent's own", "utf8");
    const found = await readAttachment(root, ".review", "after-fix.png");
    expect(new TextDecoder().decode(found!.bytes)).toBe("the agent's own");
  });
});
