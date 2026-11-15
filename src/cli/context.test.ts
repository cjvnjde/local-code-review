import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runContextCli } from "./context.ts";
import { saveContext } from "../review/context.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-context-cli-"));
  roots.push(root);
  await writeFile(path.join(root, "review.md"), "# Review\n");
  const ref = await saveContext(root, ".", {
    label: "Offline evidence",
    parts: [
      { name: "text", label: "Text", type: "text/plain", data: "a🙂z" },
      {
        name: "file",
        label: "File",
        type: "application/octet-stream",
        data: new Uint8Array([1, 2, 3]),
      },
      { name: "html", label: "HTML", type: "text/html", status: "excluded" },
    ],
  });
  return { root, ref, review: path.join(root, "review.md") };
}

test("inspect and paginated reads scope to an explicit review, and binary reads return paths", async () => {
  const { root, ref, review } = await fixture();
  expect(
    JSON.parse(await runContextCli(["inspect", ref.id, "--review", review])).id,
  ).toBe(ref.id);
  const text = JSON.parse(
    await runContextCli([
      "read",
      `context/${ref.id}/manifest.json`,
      "--review",
      review,
      "--part",
      "text",
      "--offset",
      "1",
      "--limit",
      "4",
    ]),
  );
  expect(text.content).toBe("🙂");
  expect(text.nextOffset).toBe(5);
  const binary = JSON.parse(
    await runContextCli(["read", ref.id, "--review", review, "--part", "file"]),
  );
  expect(new Uint8Array(await readFile(binary.path))).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(binary.type).toBe("application/octet-stream");
  expect(binary.content).toBeUndefined();
  await mkdir(path.join(root, "other"));
  await writeFile(path.join(root, "other/review.md"), "# Other");
  await expect(
    runContextCli([
      "inspect",
      ref.id,
      "--review",
      path.join(root, "other/review.md"),
    ]),
  ).rejects.toThrow("missing");
});

test("CLI errors reject ambiguous options and unavailable resources", async () => {
  const { ref, review } = await fixture();
  const cases = [
    ["inspect", ref.id],
    ["read", ref.id, "--review", review],
    ["inspect", ref.id, "--review", review, "--part", "text"],
    ["inspect", ref.id, "--review", review, "--unknown", "x"],
    ["inspect", ref.id, "--review", review, "--review", review],
    ["read", ref.id, "--review", review, "--part", "html"],
    ["read", ref.id, "--review", review, "--part", "text", "--offset", "-1"],
    ["read", ref.id, "--review", review, "--part", "text", "--limit", "65537"],
    ["read", ref.id, "--review", review, "--part", "file", "--offset", "0"],
    ["inspect", ref.id, "--review", review + "-missing"],
  ];
  for (const args of cases) await expect(runContextCli(args)).rejects.toThrow();
});

test("entry dispatch works offline outside Git and ignores even malformed startup settings", async () => {
  const { root, ref, review } = await fixture();
  const config = path.join(root, "config");
  await mkdir(path.join(config, "lcr"), { recursive: true });
  await writeFile(
    path.join(config, "lcr/config.json"),
    "malformed startup settings",
  );
  const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
  for (const args of [
    ["inspect", ref.id, "--review", review],
    ["read", ref.id, "--review", review, "--part", "text", "--limit", "5"],
    ["read", ref.id, "--review", review],
  ]) {
    const child = Bun.spawn([process.execPath, entry, "context", ...args], {
      cwd: root,
      env: { ...process.env, XDG_CONFIG_HOME: config },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 5000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (args.length === 4 && args[0] === "read") {
        expect(code).toBe(1);
        expect(stderr).toContain("--part");
      } else {
        expect(code).toBe(0);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toBeTruthy();
      }
      expect(stdout).not.toContain("http://localhost:");
      expect(stderr).not.toContain("git");
      expect(stderr).not.toContain("startup settings");
    } finally {
      clearTimeout(timeout);
    }
  }
});

test("offline JSON projections retain ancestors, select after filtering, and page the selected view", async () => {
  const { root, review } = await fixture();
  const ref = await saveContext(root, ".", {
    label: "Layout",
    parts: [
      {
        name: "layout",
        label: "Layout",
        type: "application/json",
        data: JSON.stringify({
          nodes: [
            {
              selector: "#card",
              targets: ["#card"],
              styles: { gap: "8px", "--space": "🙂", display: "flex" },
            },
            { selector: "main", targets: ["#card"], styles: { gap: "16px" } },
            { selector: "#other", targets: ["#other"], styles: { gap: "0px" } },
          ],
        }),
      },
    ],
  });
  const args = ["read", ref.id, "--review", review, "--part", "layout"];
  const selected = JSON.parse(
    await runContextCli([
      ...args,
      "--selector",
      "#card",
      "--property",
      "gap",
      "--select",
      "/nodes",
    ]),
  );
  expect(JSON.parse(selected.content)).toEqual([
    { selector: "#card", targets: ["#card"], styles: { gap: "8px" } },
    { selector: "main", targets: ["#card"], styles: { gap: "16px" } },
  ]);
  expect(selected.projection).toMatchObject({
    selector: "#card",
    property: "gap",
    select: "/nodes",
  });
  const unicode = [
    ...args,
    "--property",
    "--space",
    "--select",
    "/nodes/0/styles/--space",
  ];
  const page = JSON.parse(
    await runContextCli([...unicode, "--offset", "1", "--limit", "4"]),
  );
  expect(page.content).toBe("🙂");
  expect(page.totalBytes).toBe(6);
  expect(page.nextOffset).toBe(5);
  await expect(runContextCli([...unicode, "--offset", "2"])).rejects.toThrow(
    "UTF-8",
  );
  await expect(runContextCli([...unicode, "--offset", "7"])).rejects.toThrow(
    "within",
  );
  const full = JSON.parse(await runContextCli(args));
  expect(full.projection).toBeUndefined();
  const rootView = JSON.parse(await runContextCli([...args, "--select", ""]));
  expect(JSON.parse(rootView.content)).toEqual(JSON.parse(full.content));
  await expect(
    runContextCli([...args, "--select", "/constructor"]),
  ).rejects.toThrow("does not exist");
  await expect(
    runContextCli([...args, "--since", "2026-11-15T00:00:00Z"]),
  ).rejects.toThrow("events array");
  await expect(
    runContextCli(["inspect", ref.id, "--review", review, "--select", ""]),
  ).rejects.toThrow("only to context read");
});

test("CLI filters cannot bypass part types or saved-byte integrity", async () => {
  const { root, ref, review } = await fixture();
  for (const part of ["text", "file"]) {
    await expect(
      runContextCli([
        "read",
        ref.id,
        "--review",
        review,
        "--part",
        part,
        "--select",
        "",
      ]),
    ).rejects.toThrow("application/json part");
  }
  const json = await saveContext(root, ".", {
    label: "Integrity",
    parts: [
      {
        name: "json",
        label: "JSON",
        type: "application/json",
        data: '{"public":"safe","private":"excluded"}',
      },
    ],
  });
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "context", json.id, "manifest.json"),
      "utf8",
    ),
  );
  await writeFile(
    path.join(root, "context", json.id, manifest.parts[0].file),
    '{"public":"evil","private":"excluded"}',
  );
  await expect(
    runContextCli([
      "read",
      json.id,
      "--review",
      review,
      "--part",
      "json",
      "--select",
      "/public",
    ]),
  ).rejects.toThrow();
});

test("projection cannot follow a saved-part symlink outside the review", async () => {
  const { root, review } = await fixture();
  const data = '{"public":"safe"}';
  const ref = await saveContext(root, ".", {
    label: "Contained",
    parts: [{ name: "json", label: "JSON", type: "application/json", data }],
  });
  const manifest = JSON.parse(
    await readFile(path.join(root, "context", ref.id, "manifest.json"), "utf8"),
  );
  const part = path.join(root, "context", ref.id, manifest.parts[0].file);
  const outside = await mkdtemp(path.join(tmpdir(), "lcr-context-outside-"));
  roots.push(outside);
  await writeFile(path.join(outside, "evidence.json"), data);
  await rm(part);
  await symlink(path.join(outside, "evidence.json"), part);
  await expect(
    runContextCli([
      "read",
      ref.id,
      "--review",
      review,
      "--part",
      "json",
      "--select",
      "/public",
    ]),
  ).rejects.toThrow();
});
