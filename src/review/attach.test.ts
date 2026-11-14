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
import { afterEach, describe, expect, test } from "bun:test";
import {
  ATTACH_DIR,
  ATTACH_MAX_BYTES,
  attachExtension,
  attachRef,
  readAttachment,
  saveAttachment,
} from "./attach.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const roots: string[] = [];
const dir = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-attach-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const kept = (root: string) =>
  readdir(path.join(root, ".review", ATTACH_DIR)).catch(() => []);

describe("attachExtension", () => {
  test("names what a type is kept as, through the parameters a browser sends", () => {
    expect(attachExtension("image/png")).toBe("png");
    expect(attachExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(attachExtension("IMAGE/PNG")).toBe("png");
    expect(attachExtension("image/svg+xml")).toBe("svg");
  });

  test("leaves non-image types to the generic attachment path", () => {
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
    const name = await saveAttachment(
      root,
      ".review",
      bytes("a screenshot"),
      "image/png",
    );
    expect(name).toMatch(/^[0-9a-f]{16}\.png$/);

    const found = await readAttachment(root, ".review", name);
    expect(found?.type).toBe("image/png");
    expect(new TextDecoder().decode(found!.bytes)).toBe("a screenshot");
  });

  test("the same picture twice is one file, so a screenshot in two notes is kept once", async () => {
    const root = await dir();
    const first = await saveAttachment(
      root,
      ".review",
      bytes("same"),
      "image/png",
    );
    const second = await saveAttachment(
      root,
      ".review",
      bytes("same"),
      "image/png",
    );
    expect(second).toBe(first);
    expect(await kept(root)).toEqual([first]);
  });

  test("immutable image names reject different existing bytes without overwriting", async () => {
    const root = await dir();
    const image = bytes("original");
    const name = await saveAttachment(root, ".review", image, "image/png");
    await writeFile(path.join(root, ".review/images", name), "tampered");
    await expect(
      saveAttachment(root, ".review", image, "image/png"),
    ).rejects.toThrow("immutable");
    expect(
      await readFile(path.join(root, ".review/images", name), "utf8"),
    ).toBe("tampered");
    expect(await kept(root)).toEqual([name]);
  });

  test("image writes reject directory and destination symlinks", async () => {
    const root = await dir();
    const outside = await dir();
    await mkdir(path.join(root, ".review"));
    await symlink(outside, path.join(root, ".review/images"));
    await expect(
      saveAttachment(root, ".review", bytes("image"), "image/png"),
    ).rejects.toThrow("symlink");
    expect(await readdir(outside)).toEqual([]);
    await rm(path.join(root, ".review/images"));
    await mkdir(path.join(root, ".review/images"));
    const image = bytes("image");
    const digest = new Bun.CryptoHasher("sha256")
      .update(image)
      .digest("hex")
      .slice(0, 16);
    await writeFile(path.join(outside, "target.png"), "untouched");
    await symlink(
      path.join(outside, "target.png"),
      path.join(root, ".review/images", `${digest}.png`),
    );
    await expect(
      saveAttachment(root, ".review", image, "image/png"),
    ).rejects.toThrow();
    expect(await readFile(path.join(outside, "target.png"), "utf8")).toBe(
      "untouched",
    );
  });

  test("the same bytes under another type are another picture", async () => {
    const root = await dir();
    const png = await saveAttachment(
      root,
      ".review",
      bytes("same"),
      "image/png",
    );
    const webp = await saveAttachment(
      root,
      ".review",
      bytes("same"),
      "image/webp",
    );
    expect(webp).not.toBe(png);
    expect((await kept(root)).sort()).toEqual([png, webp].sort());
  });

  test("nothing is kept above the attachment size limit", async () => {
    const root = await dir();
    expect(
      await saveAttachment(
        root,
        ".review",
        new Uint8Array(ATTACH_MAX_BYTES + 1),
        "image/png",
      ),
    ).toBe("");
    expect(await kept(root)).toEqual([]);
  });

  test("keeps the bytes exactly, because a picture is not text", async () => {
    const root = await dir();
    const raw = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe,
    ]);
    const name = await saveAttachment(root, ".review", raw, "image/png");
    const written = await readFile(
      path.join(root, ".review", ATTACH_DIR, name),
    );
    expect(new Uint8Array(written)).toEqual(raw);
    expect((await readAttachment(root, ".review", name))!.bytes).toEqual(raw);
  });
});

describe("readAttachment", () => {
  test("agent pictures resolve beside the review or in assets, including custom output directories", async () => {
    const root = await dir();
    await mkdir(path.join(root, "custom", "assets"), { recursive: true });
    const name = "review-2026-10-29T12-26-26-package-not-ready.png";
    await writeFile(path.join(root, "custom", name), "sibling picture");
    await writeFile(
      path.join(root, "custom", "assets", "missing-spec-secret.png"),
      "asset picture",
    );
    expect(
      new TextDecoder().decode(
        (await readAttachment(root, "custom", "./" + name))!.bytes,
      ),
    ).toBe("sibling picture");
    expect(
      new TextDecoder().decode(
        (await readAttachment(
          root,
          "custom",
          "assets/missing-spec-secret.png",
        ))!.bytes,
      ),
    ).toBe("asset picture");
    expect(await readAttachment(root, "custom", "./../secret.png")).toBeNull();
    expect(
      await readAttachment(root, "custom", "assets/../secret.png"),
    ).toBeNull();
    expect(await readAttachment(root, "custom", "./review.md")).toBeNull();
  });

  test("an image symlink cannot expose a file outside the review directory", async () => {
    const root = await dir();
    await mkdir(path.join(root, ".review", "assets"), { recursive: true });
    await writeFile(path.join(root, "private.png"), "private");
    await symlink(
      path.join(root, "private.png"),
      path.join(root, ".review", "assets", "escape.png"),
    );
    expect(
      await readAttachment(root, ".review", "assets/escape.png"),
    ).toBeNull();
  });
  test("a name nothing was kept under is an absence rather than a failure", async () => {
    const root = await dir();
    expect(await readAttachment(root, ".review", "nothing.png")).toBeNull();
  });

  test("nothing outside the attachment directory is reachable, however the name is written", async () => {
    const root = await dir();
    await saveAttachment(root, ".review", bytes("kept"), "image/png");
    await writeFile(path.join(root, "secret.png"), "not the review's", "utf8");
    expect(await readAttachment(root, ".review", "../secret.png")).toBeNull();
    expect(
      await readAttachment(root, ".review", "../../secret.png"),
    ).toBeNull();
    expect(await readAttachment(root, ".review", "/etc/hosts")).toBeNull();
    expect(await readAttachment(root, ".review", "..")).toBeNull();
    expect(await readAttachment(root, ".review", "")).toBeNull();
  });

  test("only a picture is served, so the review file itself is not asked for through this", async () => {
    const root = await dir();
    await saveAttachment(root, ".review", bytes("kept"), "image/png");
    await writeFile(
      path.join(root, ".review", ATTACH_DIR, "notes.md"),
      "# not a picture",
      "utf8",
    );
    expect(await readAttachment(root, ".review", "notes.md")).toBeNull();
  });

  test("a picture the agent put there itself is read like any other", async () => {
    const root = await dir();
    await saveAttachment(root, ".review", bytes("mine"), "image/png");
    await writeFile(
      path.join(root, ".review", ATTACH_DIR, "after-fix.png"),
      "the agent's own",
      "utf8",
    );
    const found = await readAttachment(root, ".review", "after-fix.png");
    expect(new TextDecoder().decode(found!.bytes)).toBe("the agent's own");
  });
});

describe("attachment boundary cases", () => {
  test("the exact upload limit is accepted and a rejected upload leaves existing bytes alone", async () => {
    const root = await dir();
    const raw = new Uint8Array(ATTACH_MAX_BYTES).fill(0xa5);
    const name = await saveAttachment(
      root,
      ".review",
      raw,
      " image/PNG ; charset=binary",
    );
    expect(name).toMatch(/^[0-9a-f]{16}\.png$/);
    expect((await readAttachment(root, ".review", name))!.bytes).toEqual(raw);
    expect(
      await saveAttachment(
        root,
        ".review",
        new Uint8Array(ATTACH_MAX_BYTES + 1),
        "image/png",
      ),
    ).toBe("");
    expect(await kept(root)).toEqual([name]);
    expect((await readAttachment(root, ".review", name))!.bytes).toEqual(raw);
  });

  test("saving a subarray hashes and stores only its selected bytes", async () => {
    const root = await dir();
    const backing = bytes("private-prefix|picture|private-suffix");
    const selected = backing.subarray(15, 22);
    const name = await saveAttachment(root, ".review", selected, "image/png");
    expect(
      await saveAttachment(root, ".review", bytes("picture"), "image/png"),
    ).toBe(name);
    expect((await readAttachment(root, ".review", name))!.bytes).toEqual(
      bytes("picture"),
    );
  });

  test("explicit attachment locations do not fall back to a same-named image elsewhere", async () => {
    const root = await dir();
    await mkdir(path.join(root, ".review", "images"), { recursive: true });
    await mkdir(path.join(root, ".review", "assets"), { recursive: true });
    await writeFile(
      path.join(root, ".review", "images", "same.png"),
      "uploaded",
    );
    await writeFile(path.join(root, ".review", "assets", "same.png"), "asset");
    await writeFile(path.join(root, ".review", "same.png"), "sibling");
    for (const [name, expected] of [
      ["same.png", "uploaded"],
      ["images/same.png", "uploaded"],
      ["assets/same.png", "asset"],
      ["./same.png", "sibling"],
    ]) {
      expect(
        new TextDecoder().decode(
          (await readAttachment(root, ".review", name!))!.bytes,
        ),
      ).toBe(expected);
    }
    await writeFile(
      path.join(root, ".review", "images", "only.png"),
      "only uploaded",
    );
    expect(await readAttachment(root, ".review", "assets/only.png")).toBeNull();
    expect(await readAttachment(root, ".review", "./only.png")).toBeNull();
  });

  test("a directory symlink to a sibling with a matching path prefix cannot escape containment", async () => {
    const root = await dir();
    await mkdir(path.join(root, ".review"));
    await mkdir(path.join(root, ".review-private"));
    await writeFile(
      path.join(root, ".review-private", "secret.png"),
      "outside",
    );
    await symlink(
      path.join(root, ".review-private"),
      path.join(root, ".review", "images"),
    );
    expect(await readAttachment(root, ".review", "secret.png")).toBeNull();
    expect(
      await readAttachment(root, ".review", "images/secret.png"),
    ).toBeNull();
  });

  test("symlinks that stay inside the output directory remain readable, including a symlinked output root", async () => {
    const root = await dir();
    await mkdir(path.join(root, "actual", "assets"), { recursive: true });
    await mkdir(path.join(root, "actual", "images"));
    await writeFile(path.join(root, "actual", "assets", "real.png"), "inside");
    await symlink(
      "../assets/real.png",
      path.join(root, "actual", "images", "alias.png"),
    );
    await symlink(path.join(root, "actual"), path.join(root, "linked"));
    const found = await readAttachment(
      root,
      path.join(root, "linked"),
      "alias.png",
    );
    expect(found!.type).toBe("image/png");
    expect(found!.bytes).toEqual(bytes("inside"));
  });

  test("broken links, directories and encoded separators are absences rather than readable files", async () => {
    const root = await dir();
    await mkdir(path.join(root, ".review", "images", "folder.png"), {
      recursive: true,
    });
    await symlink(
      "missing.png",
      path.join(root, ".review", "images", "broken.png"),
    );
    for (const name of [
      "folder.png",
      "broken.png",
      "images%2fsecret.png",
      "%2e%2e%2fsecret.png",
      "images\\secret.png",
      "assets//secret.png",
      "images/./secret.png",
      "images/secret.png\0",
    ])
      expect(await readAttachment(root, ".review", name)).toBeNull();
  });
});

test.each([
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/apng", "apng"],
])(
  "uploaded %s images retain their media identity when read back",
  async (type, extension) => {
    const root = await dir();
    const payload = bytes("agent-provided binary image");
    const name = await saveAttachment(root, ".review", payload, type);
    expect(name.endsWith(`.${extension}`)).toBe(true);
    expect(await readAttachment(root, ".review", name)).toEqual({
      bytes: payload,
      type,
    });
  },
);

test("a realistically sized screenshot is accepted independently of the exported upload-budget value", async () => {
  const root = await dir();
  const payload = new Uint8Array(64 * 1024).fill(0x89);
  const name = await saveAttachment(root, ".review", payload, "image/png");
  expect((await readAttachment(root, ".review", name))!.bytes).toEqual(payload);
});

test("invalid attachment paths cannot alias an existing valid image by discarding a prefix or suffix", async () => {
  const root = await dir();
  await mkdir(path.join(root, ".review", "images"), { recursive: true });
  await writeFile(
    path.join(root, ".review", "images", "secret.png"),
    "must not leak",
  );
  expect((await readAttachment(root, ".review", "secret.png"))!.bytes).toEqual(
    bytes("must not leak"),
  );
  for (const name of [
    "../secret.png",
    "/secret.png",
    "untrusted/secret.png",
    "secret.png/child",
    "secret.png?download",
    "secret.png#fragment",
    " secret.png",
  ])
    expect(await readAttachment(root, ".review", name)).toBeNull();
});

test.each([
  "",
  "application/octet-stream",
  "application/x-unrecognized",
  "text/plain",
  "application/pdf",
])(
  "arbitrary %s attachments retain exact binary bytes and a safe portable filename",
  async (type) => {
    const root = await dir();
    const raw = new Uint8Array([0, 255, 254, 128, 13, 10, 0, 42]);
    const name = await saveAttachment(
      root,
      ".review",
      raw,
      type,
      "../../report with spaces.bin",
    );
    expect(name).toMatch(/^[a-f0-9]{16}-report_with_spaces\.bin$/);
    expect(
      new Uint8Array(
        await readFile(path.join(root, ".review", attachRef(name))),
      ),
    ).toEqual(raw);
    expect(await readAttachment(root, ".review", attachRef(name))).toEqual({
      bytes: raw,
      type: "application/octet-stream",
    });
    expect((await readAttachment(root, ".review", name))!.bytes).toEqual(raw);
    expect(
      await saveAttachment(
        root,
        ".review",
        raw,
        type,
        "../../report with spaces.bin",
      ),
    ).toBe(name);
    expect(await kept(root)).toEqual([name]);
  },
);

test("empty files and path-like or very long names remain bounded attachments", async () => {
  const root = await dir();
  for (const filename of [
    "",
    "../..",
    "C:\\private\\file.dat",
    "x".repeat(1000),
  ]) {
    const name = await saveAttachment(
      root,
      ".review",
      new Uint8Array(),
      "",
      filename,
    );
    expect(name.length).toBeLessThanOrEqual(137);
    expect(name).toMatch(/^[a-f0-9]{16}-[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(
      (await readAttachment(root, ".review", attachRef(name)))!.bytes,
    ).toEqual(new Uint8Array());
  }
});

test("generic attachment reads and writes cannot follow escaping symlinks", async () => {
  const root = await dir();
  const outside = await dir();
  const raw = bytes("original binary");
  const name = await saveAttachment(root, ".review", raw, "", "data.bin");
  await rm(path.join(root, ".review", attachRef(name)));
  await writeFile(path.join(outside, "secret"), "private");
  await symlink(
    path.join(outside, "secret"),
    path.join(root, ".review", attachRef(name)),
  );
  expect(await readAttachment(root, ".review", attachRef(name))).toBeNull();
  await expect(
    saveAttachment(root, ".review", raw, "", "data.bin"),
  ).rejects.toThrow();
  expect(await readFile(path.join(outside, "secret"), "utf8")).toBe("private");
  for (const ref of [
    "../secret",
    "images/../../secret",
    "./review.md",
    "images%2fdata.bin",
  ])
    expect(await readAttachment(root, ".review", ref)).toBeNull();
});
