import { describe, expect, test } from "bun:test";
import { normalizeId, parseArgs } from "./args.ts";

describe("parseArgs", () => {
  test("extracts tool flags and preserves Git argument order", () => {
    expect(
      parseArgs([
        "HEAD~2",
        "--port",
        "9000",
        "--staged",
        "--context",
        "8",
        "--",
        "*.ts",
      ]),
    ).toEqual({
      port: 9000,
      outDir: ".review",
      context: 8,
      open: true,
      id: "",
      version: false,
      help: false,
      diffArgs: ["HEAD~2", "--staged", "--", "*.ts"],
    });
  });

  test("--no-open keeps the browser closed without reaching git diff", () => {
    const options = parseArgs(["--no-open", "HEAD~1"]);
    expect(options.open).toBe(false);
    expect(options.diffArgs).toEqual(["HEAD~1"]);
  });

  test("--web adds a live page without changing Git arguments or browser flags", () => {
    const options = parseArgs([
      "--web",
      "http://localhost:3000",
      "--id",
      "combined",
      "--no-open",
      "--context",
      "8",
      "main...HEAD",
      "--",
      "src/",
    ]);
    expect(options.web).toBe("http://localhost:3000/");
    expect(options.diffArgs).toEqual(["main...HEAD", "--", "src/"]);
    expect(options.id).toBe("combined");
    expect(options.context).toBe(8);
    expect(options.open).toBe(false);
  });

  test("--id names the review and stays out of the git arguments", () => {
    const options = parseArgs(["--id", "auth rework", "main...HEAD"]);
    expect(options.id).toBe("auth rework");
    expect(options.diffArgs).toEqual(["main...HEAD"]);
  });

  test("browser profile flags override defaults, keep Git arguments, and stop at the separator", () => {
    const defaults = { browserProfile: "project" as const };
    expect(parseArgs([], defaults).browserProfile).toBe("project");
    expect(
      parseArgs(
        [
          "--browser-profile",
          "existing",
          "--browser-data-dir",
          "profile with spaces",
          "HEAD~1",
        ],
        defaults,
      ),
    ).toMatchObject({
      browserProfile: "existing",
      browserDataDir: "profile with spaces",
      diffArgs: ["HEAD~1"],
    });
    expect(
      parseArgs(["--browser-profile", "project"], {
        browserProfile: "existing",
        browserDataDir: "/chrome",
      }),
    ).toMatchObject({ browserProfile: "project", browserDataDir: "/chrome" });
    expect(
      parseArgs(["--browser-profile", "shared", "HEAD~1"], defaults),
    ).toMatchObject({ browserProfile: "shared", diffArgs: ["HEAD~1"] });
    expect(
      parseArgs(["--browser-profile", "shared", "--browser-profile", "project"])
        .browserProfile,
    ).toBe("project");
    expect(
      parseArgs(["--", "--browser-profile", "shared"], defaults),
    ).toMatchObject({
      browserProfile: "project",
      diffArgs: ["--", "--browser-profile", "shared"],
    });
    for (const args of [
      ["--browser-profile"],
      ["--browser-profile", "personal"],
      ["--browser-profile", "--staged"],
    ])
      expect(() => parseArgs(args)).toThrow("--browser-profile requires");
    for (const args of [
      ["--browser-data-dir"],
      ["--browser-data-dir", "--staged"],
      ["--browser-data-dir", "\0"],
    ])
      expect(() => parseArgs(args)).toThrow("--browser-data-dir requires");
  });

  test("--id with nothing after it leaves the review unnamed", () => {
    expect(parseArgs(["--id"]).id).toBe("");
    expect(parseArgs(["--id", "   "]).id).toBe("");
  });

  test("help is handled locally, except after the path separator", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--help"]).diffArgs).toEqual([]);
    const paths = ["--", "--help", "--version", "--port", "--no-open"];
    expect(parseArgs(paths).diffArgs).toEqual(paths);
    expect(parseArgs(paths).help).toBe(false);
  });

  test("invalid server options fail before startup", () => {
    for (const args of [
      ["--port"],
      ["--port", "abc"],
      ["--port", "-1"],
      ["--port", "65536"],
      ["--context"],
      ["--context", "1.5"],
      ["--context", "-1"],
      ["--out"],
      ["--out", "--staged"],
    ]) {
      expect(() => parseArgs(args)).toThrow();
    }
    expect(parseArgs(["--port", "0", "--context", "0"]).port).toBe(0);
  });

  test("--version asks what build this is, and never reaches git diff", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs(["--version"]).diffArgs).toEqual([]);
    expect(parseArgs(["HEAD~1"]).version).toBe(false);
  });
});

describe("normalizeId", () => {
  test("a name is what survives the review file's own preamble line", () => {
    expect(normalizeId("  auth   rework\n")).toBe("auth rework");
    expect(normalizeId("auth`rework")).toBe("auth rework");
    expect(normalizeId("auth\trework")).toBe("auth rework");
  });
});

test("ACP configuration stays out of Git arguments", () => {
  expect(
    parseArgs(["--acp", "/tmp/agent.json", "--id", "managed", "main...HEAD"])
      .acp,
  ).toBe("/tmp/agent.json");
  expect(
    parseArgs(["--acp", "/tmp/agent.json", "main...HEAD"]).diffArgs,
  ).toEqual(["main...HEAD"]);
  expect(parseArgs(["--", "--acp"]).acp).toBeUndefined();
  expect(() => parseArgs(["--acp"])).toThrow("configuration");
});

test("no-agent selects manual operation and the last explicit agent flag wins", () => {
  expect(parseArgs(["--no-agent", "--staged"])).toMatchObject({
    noAgent: true,
    diffArgs: ["--staged"],
  });
  expect(parseArgs(["--acp", "agent.json", "--no-agent"]).acp).toBeUndefined();
  expect(parseArgs(["--acp", "agent.json", "--no-agent"]).noAgent).toBe(true);
  expect(parseArgs(["--no-agent", "--acp", "agent.json"]).acp).toBe(
    "agent.json",
  );
  expect(
    parseArgs(["--no-agent", "--acp", "agent.json"]).noAgent,
  ).toBeUndefined();
  expect(parseArgs(["--", "--no-agent"]).diffArgs).toEqual([
    "--",
    "--no-agent",
  ]);
});

describe("startup defaults", () => {
  const defaults = {
    port: 8123,
    outDir: ".feedback",
    context: 12,
    open: false,
    id: " default` review\n",
    web: "http://localhost:3000/",
    acp: "/user/config/lcr/agents/default.json",
    diffArgs: ["origin/main", "--", "src/"],
  };

  test("bare startup uses all configured CLI defaults", () => {
    expect(parseArgs([], defaults)).toEqual({
      ...defaults,
      id: "default review",
      help: false,
      version: false,
    });
    expect(parseArgs([], defaults).diffArgs).not.toBe(defaults.diffArgs);
  });

  test("explicit options override each default independently", () => {
    expect(
      parseArgs(
        [
          "--port",
          "0",
          "--out",
          ".custom",
          "--context",
          "0",
          "--open",
          "--id",
          "",
          "--web",
          "http://127.0.0.1:4000",
          "--acp",
          "override.json",
        ],
        defaults,
      ),
    ).toEqual({
      port: 0,
      outDir: ".custom",
      context: 0,
      open: true,
      id: "",
      web: "http://127.0.0.1:4000/",
      acp: "override.json",
      diffArgs: defaults.diffArgs,
      help: false,
      version: false,
    });
    expect(parseArgs(["--no-agent", "--no-web"], defaults)).toMatchObject({
      noAgent: true,
      diffArgs: defaults.diffArgs,
    });
    expect(parseArgs(["--no-agent", "--no-web"], defaults).acp).toBeUndefined();
    expect(parseArgs(["--no-agent", "--no-web"], defaults).web).toBeUndefined();
    expect(parseArgs(["--no-open"], { open: true }).open).toBe(false);
  });

  test("explicit Git arguments replace rather than append configured diffArgs", () => {
    for (const args of [
      ["HEAD~2"],
      ["--staged"],
      ["--", "other.ts"],
      ["--"],
      ["--not-an-lcr-option"],
    ]) {
      expect(parseArgs(args, defaults).diffArgs).toEqual(args);
    }
    expect(parseArgs(["--port", "9000"], defaults).diffArgs).toEqual(
      defaults.diffArgs,
    );
  });

  test("--worktree discards configured diffArgs, not explicitly supplied Git arguments", () => {
    expect(parseArgs(["--worktree"], defaults).diffArgs).toEqual([]);
    expect(parseArgs(["--worktree", "--no-open"], defaults).diffArgs).toEqual(
      [],
    );
    expect(parseArgs(["--worktree", "HEAD~1"], defaults).diffArgs).toEqual([
      "HEAD~1",
    ]);
    expect(parseArgs(["HEAD~1", "--worktree"], defaults).diffArgs).toEqual([
      "HEAD~1",
    ]);
    expect(parseArgs(["--", "--worktree"], defaults).diffArgs).toEqual([
      "--",
      "--worktree",
    ]);
  });

  test("browser and agent flags keep last-flag-wins precedence over defaults", () => {
    expect(
      parseArgs(["--no-web", "--web", "http://localhost:5000"], defaults).web,
    ).toBe("http://localhost:5000/");
    expect(
      parseArgs(["--web", "http://localhost:5000", "--no-web"], defaults).web,
    ).toBeUndefined();
    expect(parseArgs(["--open", "--no-open"], defaults).open).toBe(false);
    expect(parseArgs(["--no-open", "--open"], defaults).open).toBe(true);
    expect(
      parseArgs(["--acp", "agent.json", "--no-agent"], defaults).acp,
    ).toBeUndefined();
    expect(parseArgs(["--no-agent", "--acp", "agent.json"], defaults).acp).toBe(
      "agent.json",
    );
    expect(parseArgs(["--", "--no-web"], defaults).web).toBe(defaults.web);
    expect(parseArgs([], { acp: null }).acp).toBeUndefined();
  });
});

describe("CLI validation and separator boundaries", () => {
  test("only the final repeated numeric option is validated and used", () => {
    expect(
      parseArgs([
        "--port",
        "-1",
        "--port",
        "65535",
        "--context",
        "-2",
        "--context",
        "0",
      ]),
    ).toMatchObject({ port: 65535, context: 0, diffArgs: [] });
    expect(() => parseArgs(["--port", "65535", "--port", "Infinity"])).toThrow(
      "--port",
    );
    for (const value of ["NaN", "Infinity", "-Infinity", "2.5"])
      expect(() => parseArgs(["--context", value])).toThrow("--context");
  });

  test("help and version bypass startup-only validation without changing literal Git paths", () => {
    for (const local of ["--help", "-h", "--version", "-v"]) {
      const options = parseArgs([
        "--port",
        "invalid",
        "--context",
        "-1",
        "--out",
        "",
        local,
        "--",
        "--acp",
      ]);
      expect(options.help || options.version).toBe(true);
      expect(options.diffArgs).toEqual(["--", "--acp"]);
    }
  });

  test("rejects a missing or option-looking ACP path instead of treating it as Git input", () => {
    for (const value of ["", " ", "--staged", "-profile.json"])
      expect(() => parseArgs(["--acp", value])).toThrow("configuration");
    expect(parseArgs(["--acp", "  profile with spaces.json  "]).acp).toBe(
      "profile with spaces.json",
    );
  });

  test("CLI live-page selection rejects nonlocal, credentialed and missing URLs", () => {
    for (const value of [
      "https://example.com",
      "file:///tmp/page.html",
      "http://user:password@localhost:3000",
      "",
    ])
      expect(() => parseArgs(["--web", value])).toThrow();
    expect(() => parseArgs(["--web"])).toThrow();
    expect(parseArgs(["--", "--web", "https://example.com"]).diffArgs).toEqual([
      "--",
      "--web",
      "https://example.com",
    ]);
  });
});
