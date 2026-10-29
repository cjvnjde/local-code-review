import { describe, expect, test } from "bun:test";
import { normalizeId, parseArgs } from "./cli.ts";

describe("parseArgs", () => {
  test("extracts tool flags and preserves Git argument order", () => {
    expect(parseArgs(["HEAD~2", "--port", "9000", "--staged", "--context", "8", "--", "*.ts"])).toEqual({
      port: 9000,
      outDir: ".review",
      context: 8,
      open: true,
      id: "",
      version: false,
      help: false,
      claudeChannel: false,
      codexThread: "",
      diffArgs: ["HEAD~2", "--staged", "--", "*.ts"],
    });
  });

  test("--no-open keeps the browser closed without reaching git diff", () => {
    const options = parseArgs(["--no-open", "HEAD~1"]);
    expect(options.open).toBe(false);
    expect(options.diffArgs).toEqual(["HEAD~1"]);
  });

  test("channel mode is opt-in and preserves the diff arguments", () => {
    const options = parseArgs(["--claude-channel", "--id", "chat", "main...HEAD"]);
    expect(options.claudeChannel).toBe(true);
    expect(options.id).toBe("chat");
    expect(options.diffArgs).toEqual(["main...HEAD"]);
    expect(parseArgs([]).claudeChannel).toBe(false);
  });

  test("--id names the review and stays out of the git arguments", () => {
    const options = parseArgs(["--id", "auth rework", "main...HEAD"]);
    expect(options.id).toBe("auth rework");
    expect(options.diffArgs).toEqual(["main...HEAD"]);
  });

  test("--codex-thread targets an existing session without changing the Git range", () => {
    const options = parseArgs(["--codex-thread", "session-123", "--id", "chat", "main...HEAD"]);
    expect(options.codexThread).toBe("session-123");
    expect(options.diffArgs).toEqual(["main...HEAD"]);
    expect(parseArgs([]).codexThread).toBe("");
    expect(() => parseArgs(["--codex-thread"])).toThrow("requires a Codex session");
    expect(() => parseArgs(["--codex-thread", "--staged"])).toThrow("requires a Codex session");
    expect(() => parseArgs(["--codex-thread", "x", "--claude-channel"])).toThrow("Choose either");
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
    for (const args of [["--port"], ["--port", "abc"], ["--port", "-1"], ["--port", "65536"],
      ["--context"], ["--context", "1.5"], ["--context", "-1"], ["--out"], ["--out", "--staged"]]) {
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
