import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../version.ts";

const entry = fileURLToPath(new URL("../index.ts", import.meta.url));

async function cli(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined> = {},
) {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(cwd, "config"), ...env },
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
      expect(result.stdout).toContain("--acp");
      expect(result.stdout).not.toContain("--claude-channel");
      expect(result.stdout).not.toContain("--codex-thread");
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
    for (const args of [
      ["--claude-channel"],
      ["--codex-thread", "old-session"],
      ["--not-an-lcr-option"],
      ["no-such-revision"],
      ["--port", "oops"],
    ]) {
      const result = await cli(cwd, [
        ...args,
        "--no-open",
        "--out",
        ".feedback",
      ]);
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

test("help and version bypass malformed user settings, while normal startup reports them before writes", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "lcr-default-errors-"));
  try {
    const settings = path.join(cwd, "config/lcr/config.json");
    await mkdir(path.dirname(settings), { recursive: true });
    await writeFile(settings, "{broken");
    for (const flag of ["--help", "--version"])
      expect((await cli(cwd, [flag])).code).toBe(0);
    const git = Bun.spawn(["git", "init", "--quiet", cwd]);
    expect(await git.exited).toBe(0);
    const exclude = path.join(cwd, ".git/info/exclude");
    const before = await readFile(exclude, "utf8");
    const result = await cli(cwd, ["--no-open"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid JSON");
    expect(await readFile(exclude, "utf8")).toBe(before);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("startup selects the user default, permits an explicit override and keeps no-agent manual", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-default-startup-"));
  const cwd = path.join(root, "repo");
  await mkdir(cwd);
  const configHome = path.join(root, "config");
  const settings = path.join(configHome, "lcr/config.json");
  await mkdir(path.join(configHome, "lcr/agents"), { recursive: true });
  await writeFile(settings, JSON.stringify({ acp: "agents/default.json" }));
  const makeProfile = async (file: string, name: string) => {
    const state = path.join(root, name);
    await mkdir(state);
    await writeFile(
      file,
      JSON.stringify({
        name,
        command: process.execPath,
        args: [path.join(import.meta.dir, "../agent/fixtures/acp-agent.ts")],
        env: { LCR_ACP_FIXTURE: state },
      }),
    );
    return state;
  };
  const defaultState = await makeProfile(
    path.join(configHome, "lcr/agents/default.json"),
    "Default",
  );
  await makeProfile(path.join(root, "override.json"), "Override");
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
  };
  await git(["init", "--quiet"]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "baseline",
  ]);
  await writeFile(path.join(cwd, "test.ts"), "export const value = 1;\n");
  async function run(args: string[], expected: string | null) {
    const child = Bun.spawn(
      [process.execPath, entry, "--no-open", "--port", "0", ...args],
      {
        cwd,
        env: { ...process.env, XDG_CONFIG_HOME: configHome },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    let output = "";
    const errors = new Response(child.stderr).text();
    const outputDone = (async () => {
      for await (const chunk of child.stdout)
        output += new TextDecoder().decode(chunk);
    })();
    try {
      let url = "";
      for (let attempt = 0; attempt < 120; attempt++) {
        url = output.match(/http:\/\/localhost:\d+/)?.[0] ?? "";
        if (url) break;
        if (child.exitCode !== null) throw new Error(await errors);
        await Bun.sleep(25);
      }
      expect(url).not.toBe("");
      let status: any;
      for (let attempt = 0; attempt < 100; attempt++) {
        status = await (await fetch(url + "/api/agent")).json();
        if (!expected || status.connection?.state === "ready") break;
        await Bun.sleep(25);
      }
      if (expected) {
        expect(status.connection).toMatchObject({
          agent: expected,
          state: "ready",
        });
        expect(status.queue.tasks).toEqual([]);
      } else {
        expect(status).toEqual({});
        expect((await fetch(url + "/api/agent/queue")).status).toBe(404);
      }
    } finally {
      child.kill("SIGTERM");
      await child.exited;
      await outputDone;
      expect(await errors).toBe("");
    }
  }
  try {
    await run([], "Default");
    expect(
      await readFile(path.join(defaultState, "rpc.jsonl"), "utf8"),
    ).not.toContain("session/prompt");
    await writeFile(settings, "{broken");
    await run(["--no-agent"], null);
    await run(["--acp", path.join(root, "override.json")], "Override");
    await rm(settings);
    await run([], null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

test("a server bind failure releases the managed owner lock so startup can be retried", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-startup-lock-"));
  const cwd = path.join(root, "repo");
  await mkdir(cwd);
  const profile = path.join(root, "agent.json");
  await writeFile(
    profile,
    JSON.stringify({
      name: "Startup test",
      command: process.execPath,
      args: [path.join(import.meta.dir, "../agent/fixtures/acp-agent.ts")],
      env: { LCR_ACP_FIXTURE: root },
    }),
  );
  for (const args of [
    ["init", "--quiet"],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "baseline",
    ],
  ]) {
    const git = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await git.exited).toBe(0);
  }
  let blocker: ReturnType<typeof Bun.serve> | undefined;
  let retry: ReturnType<typeof Bun.spawn> | undefined;
  try {
    try {
      blocker = Bun.serve({
        hostname: "127.0.0.1",
        port: 65535,
        fetch: () => new Response("occupied"),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
    const failed = await cli(cwd, [
      "--acp",
      profile,
      "--port",
      "65535",
      "--no-open",
    ]);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("ports 65535-65535 are all in use");
    const lockExists = () =>
      Bun.file(path.join(cwd, ".git/lcr-managed/owner.lock")).exists();
    expect(await lockExists()).toBe(false);
    expect(await Bun.file(path.join(root, "rpc.jsonl")).exists()).toBe(false);
    blocker?.stop(true);
    blocker = undefined;
    retry = Bun.spawn(
      [process.execPath, entry, "--acp", profile, "--port", "0", "--no-open"],
      {
        cwd,
        env: { ...process.env, XDG_CONFIG_HOME: path.join(root, "config") },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const errors = new Response(retry.stderr).text();
    let output = "";
    const outputDone = (async () => {
      for await (const chunk of retry!.stdout as ReadableStream<Uint8Array>)
        output += new TextDecoder().decode(chunk);
    })();
    try {
      for (
        let attempt = 0;
        attempt < 100 && !output.includes("http://localhost:");
        attempt++
      ) {
        if (retry.exitCode !== null) throw new Error(await errors);
        await Bun.sleep(25);
      }
      expect(output).toContain("http://localhost:");
      const url = output.match(/http:\/\/localhost:\d+/)![0];
      expect((await fetch(url + "/api/agent")).status).toBe(200);
      expect(await lockExists()).toBe(true);
    } finally {
      retry.kill("SIGTERM");
      await retry.exited;
      await outputDone;
    }
    expect(await errors).toBe("");
    expect(await lockExists()).toBe(false);
  } finally {
    blocker?.stop(true);
    retry?.kill();
    await retry?.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
