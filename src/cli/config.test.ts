import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "./args.ts";
import { loadUserSettings, resolveAcpPath, userConfigFile } from "./config.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-config-"));
  roots.push(root);
  const settings = path.join(root, "lcr", "config.json");
  await mkdir(path.dirname(settings));
  return {
    root,
    settings,
    write: (value: unknown) => writeFile(settings, JSON.stringify(value)),
  };
}

test("user settings follow absolute XDG configuration roots with the home fallback", () => {
  expect(userConfigFile({}, "/user")).toBe("/user/.config/lcr/config.json");
  expect(userConfigFile({ XDG_CONFIG_HOME: "/configuration" }, "/user")).toBe(
    "/configuration/lcr/config.json",
  );
  expect(userConfigFile({ XDG_CONFIG_HOME: "relative" }, "/user")).toBe(
    "/user/.config/lcr/config.json",
  );
  expect(userConfigFile({ XDG_CONFIG_HOME: "" }, "/user")).toBe(
    "/user/.config/lcr/config.json",
  );
});

test("missing settings, a missing default, and explicit null keep manual operation", async () => {
  const f = await fixture();
  for (const value of [undefined, {}, { acp: null }]) {
    if (value !== undefined) await f.write(value);
    const settings = await loadUserSettings({}, f.settings);
    expect(resolveAcpPath(parseArgs([], settings), "/repo")).toBeNull();
  }
});

test("default ACP paths resolve beside user settings, while explicit paths resolve in the repo", async () => {
  const f = await fixture();
  await f.write({ acp: "agents/omp.json" });
  const settings = await loadUserSettings({}, f.settings);
  const expected = path.join(f.root, "lcr/agents/omp.json");
  expect(resolveAcpPath(parseArgs([], settings), "/first/repo")).toBe(expected);
  expect(resolveAcpPath(parseArgs([], settings), "/another/repo")).toBe(
    expected,
  );
  expect(
    resolveAcpPath(parseArgs(["--acp", "agent.json"], settings), "/repo"),
  ).toBe("/repo/agent.json");
  for (const [input, output] of [
    ["/agents/custom.json", "/agents/custom.json"],
    ["~/agents/custom.json", path.join(homedir(), "agents/custom.json")],
  ]) {
    await f.write({ acp: input });
    expect((await loadUserSettings({}, f.settings)).acp).toBe(output);
    expect(resolveAcpPath(parseArgs(["--acp", input]), "/repo")).toBe(output);
  }
});

test("explicit agent selection bypasses unreadable, malformed and non-object legacy defaults", async () => {
  const f = await fixture();
  for (const source of ["invalid JSON", "null", "[]", "false"]) {
    await writeFile(f.settings, source);
    for (const argv of [
      ["--no-agent"],
      ["--acp", "agent.json"],
      ["--acp", "other.json", "--no-agent"],
      ["--no-agent", "--acp", "agent.json"],
    ]) {
      const explicit = parseArgs(argv);
      const settings = await loadUserSettings(explicit, f.settings);
      expect(settings).toEqual({});
      expect(resolveAcpPath(parseArgs(argv, settings), "/repo")).toBe(
        explicit.noAgent ? null : "/repo/agent.json",
      );
    }
  }
  await rm(f.settings);
  await mkdir(f.settings);
  expect(await loadUserSettings({ noAgent: true }, f.settings)).toEqual({});
  await expect(loadUserSettings({}, f.settings)).rejects.toThrow(
    "Could not read lcr settings",
  );
});

test("explicit agent flags bypass only the ACP field of otherwise valid settings", async () => {
  const f = await fixture();
  await f.write({ acp: 123, port: 8123, diffArgs: ["origin/main"] });
  for (const explicit of [{ noAgent: true }, { acp: "agent.json" }]) {
    expect(await loadUserSettings(explicit, f.settings)).toEqual({
      port: 8123,
      diffArgs: ["origin/main"],
    });
    await f.write({ acp: 123, port: "8123" });
    await expect(loadUserSettings(explicit, f.settings)).rejects.toThrow(
      "The port setting",
    );
    await f.write({ acp: 123, port: 8123, diffArgs: ["origin/main"] });
  }
});

test("startup settings load typed defaults without evaluating strings or writing the config", async () => {
  const f = await fixture();
  const value = {
    acp: null,
    port: 0,
    outDir: "custom output",
    context: 0,
    open: false,
    id: " auth`  review\n",
    web: "http://localhost:3000",
    diffArgs: ["origin/main", "--", "$(touch owned)", "*.ts"],
    ui: { auto: false, expand: 50, editor: "code" },
  };
  await f.write(value);
  const source = await readFile(f.settings, "utf8");
  const settings = await loadUserSettings({}, f.settings);
  expect(settings).toEqual({ ...value, web: "http://localhost:3000/" });
  expect(parseArgs([], settings)).toMatchObject({
    port: 0,
    outDir: "custom output",
    context: 0,
    open: false,
    id: "auth review",
    web: "http://localhost:3000/",
    diffArgs: value.diffArgs,
  });
  expect(await readFile(f.settings, "utf8")).toBe(source);
  expect(await Bun.file(path.join(f.root, "owned")).exists()).toBe(false);
});

test("invalid JSON and top-level values report the user settings path", async () => {
  const f = await fixture();
  await writeFile(f.settings, "{");
  await expect(loadUserSettings({}, f.settings)).rejects.toThrow(
    "Invalid JSON",
  );
  for (const invalid of [[], null, false, 5, "settings"]) {
    await f.write(invalid);
    await expect(loadUserSettings({}, f.settings)).rejects.toThrow(
      `Expected a settings object in ${f.settings}`,
    );
  }
});

test("every settings field rejects invalid types and boundaries with actionable errors", async () => {
  const f = await fixture();
  const cases: [string, unknown[]][] = [
    ["acp", ["", " ", false, {}, "a\0b"]],
    ["port", [-1, 65536, 1.5, "7777", null, false]],
    ["context", [-1, 1.5, "5", null, false]],
    ["outDir", ["", "--staged", "a\0b", 1, null]],
    ["open", ["false", 0, null]],
    ["id", [0, null, false]],
    ["web", ["", "https://example.com", "http://u:p@localhost", null, 3]],
    ["diffArgs", ["main", [1], [null], ["a\0b"], null]],
    ["ui", [null, [], { unknown: true }, { auto: "false" }]],
  ];
  for (const [key, values] of cases) {
    for (const value of values) {
      await f.write({ [key]: value });
      await expect(loadUserSettings({}, f.settings)).rejects.toThrow(
        f.settings,
      );
      await expect(loadUserSettings({}, f.settings)).rejects.toThrow(key);
    }
  }
  await f.write({ command: "not a shell command" });
  await expect(loadUserSettings({}, f.settings)).rejects.toThrow(
    `Unknown lcr setting "command" in ${f.settings}`,
  );
});

test("zero and upper port boundaries, empty lists and optional blank ids remain valid", async () => {
  const f = await fixture();
  for (const port of [0, 65535]) {
    const value = {
      port,
      context: 0,
      open: true,
      id: "",
      diffArgs: [],
      ui: {},
    };
    await f.write(value);
    expect(await loadUserSettings({}, f.settings)).toEqual(value);
  }
});
