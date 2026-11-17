import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SyntaxToken } from "../shared/syntax.ts";
import { parseSyntaxHtml } from "./syntax-html.ts";

export const MAX_SYNTAX_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * MAX_SYNTAX_BYTES;

interface TreeSitterOptions {
  enabled?: boolean;
  /** Overrides keep process tests isolated from the user's installation and configuration. */
  command?: string | null;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Optional local CLI, with bounded work and no grammar discovery in the reviewed repository. */
export function createTreeSitter(options: TreeSitterOptions = {}) {
  const command =
    options.enabled === false
      ? null
      : options.command === undefined
        ? Bun.which("tree-sitter", { cwd: tmpdir() })
        : options.command;
  const cache = new Map<string, Promise<SyntaxToken[][] | null>>();
  let ready: Promise<boolean> | undefined;
  let disabled = !command;
  // Two process slots, shared by initial diffs, expansion, and concurrent clients.
  const slots = [Promise.resolve(), Promise.resolve()];
  let slot = 0;

  async function run(args: string[], cwd: string) {
    const child = Bun.spawn([command!, ...args], {
      cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const readers = [child.stdout.getReader(), child.stderr.getReader()];
    let bytes = 0;
    const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return output + decoder.decode();
        bytes += value.byteLength;
        if (bytes > MAX_OUTPUT_BYTES)
          throw new Error("Syntax output too large");
        output += decoder.decode(value, { stream: true });
      }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      for (const reader of readers) void reader.cancel().catch(() => {});
    }, options.timeoutMs ?? 3000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        read(readers[0]!),
        read(readers[1]!),
        child.exited,
      ]);
      if (timedOut) throw new Error("Syntax highlighting timed out");
      return code === 0 ? { stdout, stderr } : null;
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await Promise.all(
        readers.map((reader) => reader.cancel().catch(() => {})),
      );
      await child.exited;
    }
  }

  async function available() {
    if (disabled) return false;
    return (ready ??= (async () => {
      let directory: string | undefined;
      try {
        directory = await mkdtemp(path.join(tmpdir(), "lcr-syntax-"));
        // CLI releases print this listing to stderr or stdout. Ignore warnings about
        // an unconfigured installation; a language entry must actually be present.
        const output = await run(["dump-languages"], directory);
        return (
          !!output && /^scope:\s*\S/m.test(output.stdout + "\n" + output.stderr)
        );
      } catch {
        disabled = true;
        return false;
      } finally {
        if (directory)
          await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    })());
  }

  async function highlight(
    file: string,
    source: string,
  ): Promise<SyntaxToken[][] | null> {
    if (
      Buffer.byteLength(source) > MAX_SYNTAX_BYTES ||
      source.includes("\0") ||
      !(await available())
    )
      return null;
    const name = path.basename(file);
    if (!name || name === "." || name === "..") return null;
    const key = createHash("sha256")
      .update(name)
      .update("\0")
      .update(source)
      .digest("hex");
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const index = slot++ % slots.length;
    const result = slots[index]!.then(async () => {
      if (disabled) return null;
      let directory: string | undefined;
      try {
        directory = await mkdtemp(path.join(tmpdir(), "lcr-syntax-"));
        // Even a reviewed file named tree-sitter.json must not become CLI configuration.
        await mkdir(path.join(directory, "source"));
        const input = path.join(directory, "source", name);
        await writeFile(input, source, { mode: 0o600 });
        // This long-standing option also works before the CLI added --layout/--style.
        const html = await run(
          ["highlight", "--html", "--css-classes", "--", input],
          directory,
        );
        return html === null ? null : parseSyntaxHtml(html.stdout, source);
      } catch {
        // A broken or hanging executable must not stall every file in a large review.
        disabled = true;
        return null;
      } finally {
        if (directory)
          await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    });
    slots[index] = result.then(() => {});
    cache.set(key, result);
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
    return result;
  }

  return { available, highlight };
}
