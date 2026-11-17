import { afterEach, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTreeSitter, MAX_SYNTAX_BYTES } from "./tree-sitter.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(mode = "ok", timeoutMs = 3000) {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-syntax-test-"));
  roots.push(root);
  const script = path.join(root, "cli.ts");
  const executable = path.join(root, "tree-sitter");
  const log = path.join(root, "calls.jsonl");
  await writeFile(
    script,
    `
    import { appendFile } from "node:fs/promises";
    const args = process.argv.slice(2);
    const mode = process.env.TEST_SYNTAX_MODE;
    await appendFile(process.env.TEST_SYNTAX_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
    if (args[0] === "dump-languages") {
      if (mode !== "unconfigured") console.error('scope: source.js');
      else console.error('Warning: You have not configured any parser directories!');
    } else if (mode === "hang") {
      setInterval(() => {}, 1000); await new Promise(() => {});
    } else if (mode === "overflow") {
      console.log('x'.repeat(9 * 1024 * 1024));
    } else if (mode === "failure" || args.at(-1).endsWith('.unknown')) {
      process.exit(1);
    } else {
      const text = await Bun.file(args.at(-1)).text();
      console.log('<pre><code><span class="comment">' + Bun.escapeHTML(text) + '</span></code></pre>');
    }
  `,
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
  );
  await chmod(executable, 0o755);
  const backend = createTreeSitter({
    command: executable,
    timeoutMs,
    env: { ...process.env, TEST_SYNTAX_LOG: log, TEST_SYNTAX_MODE: mode },
  });
  const calls = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[]; cwd: string });
  return { backend, calls, root };
}

test("disabled or missing executables leave highlighting optional", async () => {
  for (const options of [
    { enabled: false },
    { command: null },
    { command: "/missing/tree-sitter" },
  ]) {
    const backend = createTreeSitter(options);
    expect(await backend.available()).toBe(false);
    expect(await backend.highlight("a.js", "const a = 1")).toBeNull();
  }
});

test.skipIf(process.platform === "win32")(
  "caches complete sources, deduplicates concurrent requests, and keeps filenames literal",
  async () => {
    const { backend, calls } = await fixture();
    const file = "nested/--$(touch owned) 'a file.js";
    const source = "/* first\n<script>🚀 & */\n";
    const results = await Promise.all([
      backend.highlight(file, source),
      backend.highlight(file, source),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.[1]).toEqual([
      { text: "<script>🚀 & */", kind: "comment" },
    ]);
    expect(
      (await calls()).filter((call) => call.args[0] === "highlight"),
    ).toHaveLength(1);
    await backend.highlight(file, source + "changed");
    await backend.highlight("tree-sitter.json", "{}");
    const recorded = await calls();
    expect(
      recorded.filter((call) => call.args[0] === "dump-languages"),
    ).toHaveLength(1);
    expect(
      recorded.filter((call) => call.args[0] === "highlight"),
    ).toHaveLength(3);
    for (const call of recorded) {
      if (call.args[0] === "highlight") {
        expect(path.basename(path.dirname(call.args.at(-1)!))).toBe("source");
        expect(
          path.basename(path.dirname(path.dirname(call.args.at(-1)!))),
        ).toBe(path.basename(call.cwd));
        expect(call.args.at(-2)).toBe("--");
      }
      expect(await stat(call.cwd).catch(() => null)).toBeNull();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "unconfigured, unsupported, failed, and oversized sources fall back",
  async () => {
    const unconfigured = await fixture("unconfigured");
    expect(await unconfigured.backend.highlight("a.js", "code")).toBeNull();
    expect(await unconfigured.backend.highlight("b.js", "code")).toBeNull();
    expect(await unconfigured.calls()).toHaveLength(1);
    const { backend, calls } = await fixture();
    expect(await backend.highlight("a.unknown", "code")).toBeNull();
    expect(await backend.highlight("a.js", "\0")).toBeNull();
    expect(
      await backend.highlight("a.js", "x".repeat(MAX_SYNTAX_BYTES + 1)),
    ).toBeNull();
    expect(await backend.highlight("b.js", "works")).not.toBeNull();
    expect(await calls()).toHaveLength(3);
    expect(
      await (await fixture("failure")).backend.highlight("a.js", "code"),
    ).toBeNull();
  },
);

test.skipIf(process.platform === "win32")(
  "kills hung or flooding processes and disables further attempts",
  async () => {
    for (const mode of ["hang", "overflow"]) {
      const { backend, calls } = await fixture(mode, 1000);
      expect(await backend.available()).toBe(true);
      expect(await backend.highlight("a.js", "code")).toBeNull();
      expect(await backend.highlight("b.js", "other")).toBeNull();
      expect(await calls()).toHaveLength(2);
      expect(await backend.available()).toBe(false);
    }
  },
);
