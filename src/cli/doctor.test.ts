import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ACP_DIAGNOSTIC_BYTES, AcpClient } from "../agent/acp.ts";
import { runDoctorCli } from "./doctor.ts";

const roots: string[] = [];
const originalConfigHome = process.env.XDG_CONFIG_HOME;
afterEach(() => {
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(mode = "") {
  const root = mkdtempSync(path.join(tmpdir(), "lcr-doctor-"));
  roots.push(root);
  const profile = path.join(root, "profile.json");
  const config = {
    name: "Doctor fixture",
    command: process.execPath,
    args: [path.join(import.meta.dir, "../agent/fixtures/acp-doctor.ts")],
    env: { LCR_DOCTOR_FIXTURE: root, LCR_DOCTOR_MODE: mode },
  };
  writeFileSync(profile, JSON.stringify(config));
  process.env.XDG_CONFIG_HOME = root;
  return { root, profile, config };
}
function expectClosed(root: string) {
  const pid = Number(readFileSync(path.join(root, "pid"), "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
  expect(readFileSync(path.join(root, "methods"), "utf8")).toBe("initialize\n");
}

test("doctor uses user-configured ACP and never creates a session or sends a task", async () => {
  const f = fixture();
  mkdirSync(path.join(f.root, "lcr"));
  writeFileSync(
    path.join(f.root, "lcr/config.json"),
    JSON.stringify({ acp: "../profile.json" }),
  );
  const output = await runDoctorCli([]);
  expect(output).toContain("stable ACP v1");
  expect(output).toContain("Session restoration: supported");
  expect(output).toContain("Image prompts: supported");
  expect(output).not.toContain("PRIVATE_");
  expectClosed(f.root);
});

test("doctor works outside Git with an explicit override of malformed user settings", async () => {
  const f = fixture();
  mkdirSync(path.join(f.root, "lcr"));
  writeFileSync(path.join(f.root, "lcr/config.json"), "{broken");
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { runDoctorCli } from ${JSON.stringify(path.join(import.meta.dir, "doctor.ts"))}; console.log(await runDoctorCli(["--acp", "profile.json"]));`,
    ],
    {
      cwd: f.root,
      env: { ...process.env, XDG_CONFIG_HOME: f.root },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(errors).toBe("");
  expect(output).toContain("ACP doctor: ready");
  expectClosed(f.root);
});

test("missing executable is distinguished from failed ACP initialization", async () => {
  const f = fixture();
  writeFileSync(
    f.profile,
    JSON.stringify({
      ...f.config,
      command: path.join(f.root, "missing-agent"),
    }),
  );
  await expect(runDoctorCli(["--acp", f.profile])).rejects.toThrow(
    "ACP executable missing",
  );
  const broken = fixture("init-error");
  let message = "";
  try {
    await runDoctorCli(["--acp", broken.profile]);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain("initialization failed");
  expect(message).toContain("External authentication required");
  expect(message).not.toContain("PRIVATE_");
  expectClosed(broken.root);
});

test("diagnostics explicitly exposes only a bounded stderr tail with a privacy warning", async () => {
  const f = fixture();
  const output = await runDoctorCli(["--acp", f.profile, "--diagnostics"]);
  expect(output).toContain("Privacy warning:");
  expect(output).toContain("PRIVATE_TAIL");
  expect(output).not.toContain("PRIVATE_PREFIX");
  expect(output).not.toContain("\u001b");
  expect(output.length).toBeLessThan(ACP_DIAGNOSTIC_BYTES + 1500);
  expectClosed(f.root);
  const broken = fixture("init-error");
  await expect(
    runDoctorCli(["--acp", broken.profile, "--diagnostics"]),
  ).rejects.toThrow("PRIVATE_TAIL");
  expectClosed(broken.root);
});

test("normal ACP clients retain no stderr even after initialization and shutdown", async () => {
  const f = fixture();
  const client = new AcpClient(f.config, f.root, {
    update() {},
    permission() {},
    lost() {},
  });
  try {
    await client.start();
    expect(client.diagnostics).toBe("");
  } finally {
    await client.close();
  }
  expect(client.diagnostics).toBe("");
});

test("doctor validates standalone flags and reports an unconfigured agent", async () => {
  fixture();
  expect(await runDoctorCli(["--help"])).toContain("Works outside Git");
  await expect(runDoctorCli([])).rejects.toThrow("No ACP agent is configured");
  await expect(runDoctorCli(["--acp"])).rejects.toThrow(
    "requires a profile path",
  );
  await expect(runDoctorCli(["--unknown"])).rejects.toThrow(
    "Unknown doctor option",
  );
});
