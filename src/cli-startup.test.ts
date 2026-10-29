import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.ts";

const entry = fileURLToPath(new URL("./index.ts", import.meta.url));

async function cli(cwd: string, args: string[]) {
  const child = Bun.spawn([process.execPath, entry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { stdout, stderr, code };
  } finally {
    clearTimeout(timeout);
  }
}

test("help and version exit successfully outside a repository", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "lcr-cli-"));
  try {
    for (const flag of ["--help", "-h"]) {
      const result = await cli(cwd, [flag]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: lcr");
      expect(result.stdout).not.toContain("http://localhost:");
      expect(result.stderr).toBe("");
    }
    const version = await cli(cwd, ["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(VERSION);
    expect(version.stderr).toBe("");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("invalid options and revisions exit before starting a server or writing excludes", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "lcr-cli-"));
  try {
    const git = Bun.spawn(["git", "init", "--quiet", cwd]);
    expect(await git.exited).toBe(0);
    const exclude = path.join(cwd, ".git/info/exclude");
    const before = await readFile(exclude, "utf8");
    for (const args of [["--not-an-lcr-option"], ["no-such-revision"], ["--port", "oops"]]) {
      const result = await cli(cwd, [...args, "--no-open", "--out", ".feedback"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toStartWith("lcr: ");
      expect(result.stderr).toContain("lcr --help");
      expect(result.stderr).not.toMatch(/\n\s+at /);
      expect(await readFile(exclude, "utf8")).toBe(before);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
