import { afterEach, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createTreeSitterSetup,
  type TreeSitterSetup,
} from "./tree-sitter-setup.ts";
import { createTreeSitter } from "./tree-sitter.ts";
import type { ParserReviewFile } from "../shared/tree-sitter.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(files: ParserReviewFile[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-parser-setup-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const config = path.join(root, "config", "tree-sitter", "config.json");
  const log = path.join(root, "calls.jsonl");
  const env = {
    ...process.env,
    PATH: bin,
    XDG_CONFIG_HOME: path.join(root, "config"),
    APPDATA: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    TEST_ROOT: root,
  };
  await mkdir(bin);
  const script = path.join(root, "tool.ts");
  await writeFile(
    script,
    `
    import { appendFile, mkdir, readFile } from "node:fs/promises";
    import path from "node:path";
    const [tool, ...args] = process.argv.slice(2);
    const root = process.env.TEST_ROOT;
    const config = path.join(root, "config/tree-sitter/config.json");
    await appendFile(path.join(root, "calls.jsonl"), JSON.stringify({ tool, args, cwd: process.cwd() }) + "\\n");
    if (tool === "git") {
      await Bun.sleep(30);
      if (await Bun.file(path.join(root, "fail")).exists()) {
        console.error("Download unavailable"); process.exit(1);
      }
      await mkdir(args.at(-1), { recursive: true });
      await Bun.write(path.join(args.at(-1), "tree-sitter.json"), "{}");
      if (await Bun.file(config).exists()) {
        const current = await Bun.file(config).json();
        current.concurrentEdit = "kept";
        await Bun.write(config, JSON.stringify(current));
      }
    } else if (tool === "bun") {
      await Bun.write(path.join(process.cwd(), "node_modules/tree-sitter-javascript/queries/highlights.scm"), "query");
    } else if (args[0] === "--version") {
      console.log("tree-sitter 0.27.2");
    } else if (args[0] === "dump-languages") {
      const current = await Bun.file(config).json().catch(() => ({}));
      for (const scope of current.testScopes ?? []) console.error("scope: " + scope);
      const catalog = {
        javascript: ["source.js"], typescript: ["source.ts", "source.tsx"],
        yaml: ["source.yaml"], html: ["source.html"], css: ["source.css"],
        json: ["source.json"], bash: ["source.bash"], python: ["source.python"],
        go: ["source.go"], rust: ["source.rust"],
      };
      for (const directory of current["parser-directories"] ?? []) {
        for (const [parser, scopes] of Object.entries(catalog)) {
          if (await Bun.file(path.join(directory, "tree-sitter-" + parser, "tree-sitter.json")).exists())
            for (const scope of scopes) console.error("scope: " + scope);
        }
      }
    } else if (args[0] === "init-config") {
      await Bun.write(config, JSON.stringify({ theme: { keyword: 99 }, "parser-directories": [] }));
    } else if (args[0] === "highlight") {
      const source = await Bun.file(args.at(-1)).text();
      if (await Bun.file(path.join(root, "bad-query")).exists()) {
        console.error("Invalid query"); process.exit(1);
      }
      console.log('<pre><code><span class="keyword">' + Bun.escapeHTML(source) + '</span></code></pre>');
    }
  `,
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const name of ["tree-sitter", "git", "bun", "cc"]) {
    const file = path.join(bin, name);
    await writeFile(
      file,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} ${name} "$@"\n`,
    );
    await chmod(file, 0o755);
  }
  const backend = createTreeSitter({ env });
  let refreshed = 0;
  const options = {
    env,
    getFiles: async () => files,
    onRefresh: () => {
      backend.reset();
      refreshed++;
    },
  };
  const setup = createTreeSitterSetup(options);
  const calls = async (): Promise<
    { tool: string; args: string[]; cwd: string }[]
  > =>
    (await Bun.file(log).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return {
    files,
    root,
    config,
    env,
    bin,
    backend,
    setup,
    options,
    calls,
    refreshed: () => refreshed,
  };
}

async function finish(setup: TreeSitterSetup) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = await setup.status();
    if (status.installation.state !== "running") return status;
    await Bun.sleep(20);
  }
  throw new Error("Installation did not finish");
}

test("detects the CLI independently of grammars and the disabled preference without writes", async () => {
  const f = await fixture();
  const status = await f.setup.status();
  expect(status.cli?.version).toBe("tree-sitter 0.27.2");
  expect(status.languages).toEqual([]);
  expect(status.missingTools).toEqual([]);
  expect(await Bun.file(f.config).exists()).toBe(false);
  expect((await f.calls()).every((call) => call.tool === "tree-sitter")).toBe(
    true,
  );
  const disabled = createTreeSitterSetup({ ...f.options, enabled: false });
  expect((await disabled.status()).enabled).toBe(false);
  expect((await disabled.status()).cli).not.toBeNull();
  await rm(path.join(f.bin, "tree-sitter"));
  expect((await f.setup.refresh()).cli).toBeNull();
  f.setup.startInstall();
  expect((await finish(f.setup)).installation).toMatchObject({
    state: "failed",
    detail: expect.stringContaining("tree-sitter"),
  });
  expect(await Bun.file(f.config).exists()).toBe(false);
});

test("detects changing review types without downloads and installs only missing parser packages", async () => {
  const f = await fixture([{ path: "app.ts" }, { path: "config.yml" }]);
  await Bun.write(f.config, JSON.stringify({ testScopes: ["source.ts"] }));
  expect(
    (await f.setup.status()).review.languages.map(({ label, configured }) => [
      label,
      configured,
    ]),
  ).toEqual([
    ["TypeScript", true],
    ["YAML", false],
  ]);
  f.files.push({ path: "view.tsx" }, { path: "archive.html", binary: true });
  expect(
    (await f.setup.status()).review.languages.map(({ label }) => label),
  ).toEqual(["TypeScript", "TSX", "YAML"]);
  expect((await f.calls()).some((call) => call.tool === "git")).toBe(false);
  f.setup.startInstall("detected");
  const status = await finish(f.setup);
  expect(status.installation).toMatchObject({
    state: "complete",
    detail: "Parsers for this review are ready.",
  });
  expect(status.review.languages.every((language) => language.configured)).toBe(
    true,
  );
  const clones = (await f.calls()).filter((call) => call.tool === "git");
  expect(clones.map((call) => call.args.at(-2))).toEqual([
    "https://github.com/tree-sitter/tree-sitter-typescript.git",
    "https://github.com/tree-sitter-grammars/tree-sitter-yaml.git",
  ]);
  expect(
    (await f.calls()).filter((call) => call.args.includes("--scope")),
  ).toHaveLength(3);
  f.setup.startInstall("detected");
  expect((await finish(f.setup)).installation).toMatchObject({
    detail: "No missing parsers for this review.",
  });
  expect((await f.calls()).filter((call) => call.tool === "git")).toHaveLength(
    2,
  );
}, 15_000);

test("a detected YAML-only review can install without Bun and ignores files removed before the click", async () => {
  const f = await fixture([{ path: "config.yaml" }, { path: "source.ts" }]);
  await rm(path.join(f.bin, "bun"));
  expect((await f.setup.status()).review.missingTools).toEqual(["bun"]);
  f.files.pop();
  expect((await f.setup.status()).review.missingTools).toEqual([]);
  f.setup.startInstall("detected");
  expect((await finish(f.setup)).installation.state).toBe("complete");
  expect(
    (await f.calls())
      .filter((call) => call.tool === "git")
      .map((call) => call.args.at(-2)),
  ).toEqual(["https://github.com/tree-sitter-grammars/tree-sitter-yaml.git"]);
  expect((await f.calls()).some((call) => call.tool === "bun")).toBe(false);
});

test("an empty or unsupported review does not download or create configuration", async () => {
  const f = await fixture([
    { path: "README.md" },
    { path: "image.ts", binary: true },
  ]);
  f.setup.startInstall("detected");
  expect((await finish(f.setup)).installation).toMatchObject({
    state: "complete",
    detail: "No missing parsers for this review.",
  });
  expect(await Bun.file(f.config).exists()).toBe(false);
  expect((await f.calls()).some((call) => call.tool === "git")).toBe(false);
});

test("installs once, preserves concurrent config edits, checks queries, and resets fallback in the same server", async () => {
  const f = await fixture();
  await Bun.write(
    f.config,
    JSON.stringify({
      "parser-directories": ["/existing/grammars"],
      theme: { keyword: 42 },
    }),
  );
  expect(await f.backend.available()).toBe(false);
  f.setup.startInstall();
  f.setup.startInstall();
  const status = await finish(f.setup);
  expect(status.installation).toMatchObject({ state: "complete" });
  expect(status.languages).toContain("source.ts");
  expect(f.refreshed()).toBe(1);
  expect(
    await f.backend.highlight("example.ts", "const count: number = 1;\n"),
  ).not.toBeNull();
  expect(await Bun.file(f.config).json()).toEqual({
    "parser-directories": ["/existing/grammars", status.directory],
    theme: { keyword: 42 },
    concurrentEdit: "kept",
  });
  const calls = await f.calls();
  expect(calls.filter((call) => call.tool === "git")).toHaveLength(10);
  expect(calls.find((call) => call.tool === "bun")?.args).toContain(
    "--ignore-scripts",
  );
  expect(calls.filter((call) => call.args.includes("--scope"))).toHaveLength(
    11,
  );
  expect(calls.every((call) => call.cwd !== process.cwd())).toBe(true);
  expect(
    (await readdir(status.directory)).filter((name) =>
      name.startsWith(".install"),
    ),
  ).toEqual([]);
  f.setup.startInstall();
  expect((await finish(f.setup)).installation.state).toBe("complete");
  expect((await f.calls()).filter((call) => call.tool === "git")).toHaveLength(
    10,
  );
  expect((await Bun.file(f.config).json())["parser-directories"]).toEqual([
    "/existing/grammars",
    status.directory,
  ]);
}, 15_000);

test("reports download and query failures, cleans partial clones, and can retry", async () => {
  const f = await fixture();
  await Bun.write(path.join(f.root, "fail"), "");
  f.setup.startInstall();
  const failed = await finish(f.setup);
  expect(failed.installation).toMatchObject({
    state: "failed",
    detail: expect.stringContaining("Download unavailable"),
  });
  expect(await readdir(failed.directory)).toEqual([]);
  expect(await Bun.file(f.config).exists()).toBe(false);
  await rm(path.join(f.root, "fail"));
  await Bun.write(path.join(f.root, "bad-query"), "");
  f.setup.startInstall();
  expect((await finish(f.setup)).installation).toMatchObject({
    state: "failed",
    detail: expect.stringContaining("Invalid query"),
  });
  await rm(path.join(f.root, "bad-query"));
  f.setup.startInstall();
  expect((await finish(f.setup)).installation.state).toBe("complete");
}, 15_000);

test("refuses to overwrite malformed config before downloads", async () => {
  const f = await fixture();
  for (const source of ["{broken", '{"parser-directories":"wrong"}']) {
    await Bun.write(f.config, source);
    f.setup.startInstall();
    expect((await finish(f.setup)).installation).toMatchObject({
      state: "failed",
      detail: expect.stringContaining("Existing settings were not replaced"),
    });
    expect(await Bun.file(f.config).text()).toBe(source);
  }
  expect((await f.calls()).some((call) => call.tool === "git")).toBe(false);
});

test("coordinates concurrent lcr servers with a directory lock", async () => {
  const f = await fixture();
  const other = createTreeSitterSetup(f.options);
  f.setup.startInstall();
  other.startInstall();
  const results = await Promise.all([finish(f.setup), finish(other)]);
  expect(results.map((result) => result.installation.state).sort()).toEqual([
    "complete",
    "failed",
  ]);
  expect(
    results.find((result) => result.installation.state === "failed")
      ?.installation,
  ).toMatchObject({ detail: expect.stringContaining("Another lcr server") });
  expect((await f.calls()).filter((call) => call.tool === "git")).toHaveLength(
    10,
  );
}, 15_000);
