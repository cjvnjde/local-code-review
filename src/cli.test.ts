import { describe, expect, test } from "bun:test";
import { parseArgs } from "./cli.ts";

describe("parseArgs", () => {
  test("extracts tool flags and preserves Git argument order", () => {
    expect(parseArgs(["HEAD~2", "--port", "9000", "--staged", "--context", "8", "--", "*.ts"])).toEqual({
      port: 9000,
      outDir: ".review",
      context: 8,
      diffArgs: ["HEAD~2", "--staged", "--", "*.ts"],
    });
  });
});
