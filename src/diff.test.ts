import { describe, expect, test } from "bun:test";
import { contextRows, parseDiff } from "./diff.ts";

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

  test("keeps the section heading of a hunk header, so it can be rebuilt after expansion", () => {
    const files = parseDiff([
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -8,1 +8,1 @@ export function run() {",
      "-old();",
      "+next();",
      "@@ -40,1 +40,1 @@",
      " kept();",
      "",
    ].join("\n"));

    expect(files[0].rows[0]).toEqual({ t: "hunk", text: "@@ -8,1 +8,1 @@ export function run() {", head: " export function run() {" });
    expect(files[0].rows[3]).toEqual({ t: "hunk", text: "@@ -40,1 +40,1 @@" });
  });
});

describe("contextRows", () => {
  const files = parseDiff([
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,5 +1,5 @@",
    " one",
    " two",
    "-three",
    "+THREE",
    " four",
    " five",
    "diff --git a/b.ts b/b.ts",
    "--- a/b.ts",
    "+++ b/b.ts",
    "@@ -1,1 +1,1 @@",
    " only",
    "",
  ].join("\n"));

  test("returns the unchanged lines of one file inside an inclusive new-side range", () => {
    expect(contextRows(files, "a.ts", 2, 4)).toEqual([
      { t: "ctx", o: 2, n: 2, text: "two" },
      { t: "ctx", o: 4, n: 4, text: "four" },
    ]);
  });

  test("changed lines and other files never leak into the answer", () => {
    expect(contextRows(files, "a.ts", 3, 3)).toEqual([]);
    expect(contextRows(files, "b.ts", 1, 99)).toEqual([{ t: "ctx", o: 1, n: 1, text: "only" }]);
    expect(contextRows(files, "../outside.ts", 1, 99)).toEqual([]);
  });
});
