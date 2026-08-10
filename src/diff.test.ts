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

  test("body lines starting +++/--- are content, not file headers", () => {
    const files = parseDiff([
      "diff --git a/notes.sql b/notes.sql",
      "--- a/notes.sql",
      "+++ b/notes.sql",
      "@@ -1,3 +1,3 @@",
      " select 1;",
      "--- old comment",
      "+++ new content",
      " select 2;",
      "",
    ].join("\n"));

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("notes.sql");
    expect(files[0].rows).toEqual([
      { t: "hunk", text: "@@ -1,3 +1,3 @@" },
      { t: "ctx", o: 1, n: 1, text: "select 1;" },
      { t: "del", o: 2, text: "-- old comment" },
      { t: "add", n: 2, text: "++ new content" },
      { t: "ctx", o: 3, n: 3, text: "select 2;" },
    ]);
  });

  test("binary changes, pure renames, and mode-only changes keep their file entry", () => {
    const files = parseDiff([
      "diff --git a/bin.dat b/bin.dat",
      "index 1111111..2222222 100644",
      "Binary files a/bin.dat and b/bin.dat differ",
      "diff --git a/old name.txt b/new name.txt",
      "similarity index 100%",
      "rename from old name.txt",
      "rename to new name.txt",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n"));

    expect(files.map((file) => file.path)).toEqual(["bin.dat", "new name.txt", "run.sh"]);
    expect(files[0].binary).toBe(true);
    expect(files[1].status).toBe("renamed");
  });

  test("undoes the tab and quoting git puts around unusual paths", () => {
    const files = parseDiff([
      "diff --git a/spaced name.txt b/spaced name.txt",
      "--- a/spaced name.txt\t",
      "+++ b/spaced name.txt\t",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      'diff --git "a/na\\303\\257ve.txt" "b/na\\303\\257ve.txt"',
      '--- "a/na\\303\\257ve.txt"',
      '+++ "b/na\\303\\257ve.txt"',
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "",
    ].join("\n"));

    expect(files.map((file) => file.path)).toEqual(["spaced name.txt", "naïve.txt"]);
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
