import { describe, expect, test } from "bun:test";
import { parseDiff } from "./diff.ts";

describe("parseDiff", () => {
  test("parses line numbers, counts, status, and fingerprint", () => {
    const files = parseDiff([
      "diff --git a/src/example.ts b/src/example.ts",
      "index 1111111..2222222 100644",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,2 +1,2 @@",
      "-const oldValue = 1;",
      "+const newValue = 2;",
      " unchanged();",
      "",
    ].join("\n"));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: "src/example.ts",
      status: "modified",
      added: 1,
      removed: 1,
      rows: [
        { t: "hunk", text: "@@ -1,2 +1,2 @@" },
        { t: "del", o: 1, text: "const oldValue = 1;" },
        { t: "add", n: 1, text: "const newValue = 2;" },
        { t: "ctx", o: 2, n: 2, text: "unchanged();" },
      ],
    });
    expect(files[0].hash).toMatch(/^[a-z0-9]+$/);
  });
});
