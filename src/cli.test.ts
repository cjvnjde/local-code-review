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
      diffArgs: ["HEAD~2", "--staged", "--", "*.ts"],
    });
  });

  test("--no-open keeps the browser closed without reaching git diff", () => {
    const options = parseArgs(["--no-open", "HEAD~1"]);
    expect(options.open).toBe(false);
    expect(options.diffArgs).toEqual(["HEAD~1"]);
  });

  test("--id names the review and stays out of the git arguments", () => {
    const options = parseArgs(["--id", "auth rework", "main...HEAD"]);
    expect(options.id).toBe("auth rework");
    expect(options.diffArgs).toEqual(["main...HEAD"]);
  });

  test("--id with nothing after it leaves the review unnamed", () => {
    expect(parseArgs(["--id"]).id).toBe("");
    expect(parseArgs(["--id", "   "]).id).toBe("");
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
