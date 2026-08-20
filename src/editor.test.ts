import { describe, expect, test } from "bun:test";
import { configuredEditorCommand, editorCommand, workingFilePath } from "./editor.ts";

describe("editorCommand", () => {
  test("uses the platform default application without a shell", () => {
    expect(editorCommand("/repo/src/a file.ts", "darwin")).toEqual(["open", "/repo/src/a file.ts"]);
    expect(editorCommand("C:\\repo\\src\\a file.ts", "win32")).toEqual([
      "explorer.exe",
      "C:\\repo\\src\\a file.ts",
    ]);
    expect(editorCommand("/repo/src/a file.ts", "linux")).toEqual(["xdg-open", "/repo/src/a file.ts"]);
  });
});

describe("configuredEditorCommand", () => {
  test("resolves one configured executable and keeps the file path as one argument", () => {
    const which = (command: string) => command === "code" ? "/usr/bin/code" : null;
    expect(configuredEditorCommand("/repo/src/a file.ts", " code ", "linux", which)).toEqual([
      "/usr/bin/code",
      "/repo/src/a file.ts",
    ]);
  });

  test("uses the system default when no editor is configured", () => {
    expect(configuredEditorCommand("/repo/src/app.ts", "", "linux")).toEqual([
      "xdg-open",
      "/repo/src/app.ts",
    ]);
  });

  test("refuses an unavailable command and never parses command arguments", () => {
    const which = () => null;
    expect(configuredEditorCommand("/repo/src/app.ts", "missing-editor", "linux", which)).toBeNull();
    expect(configuredEditorCommand("/repo/src/app.ts", "code --wait", "linux", which)).toBeNull();
  });
});

describe("workingFilePath", () => {
  test("resolves a repository-relative file", () => {
    expect(workingFilePath("/work/repo", "src/app.ts")).toBe("/work/repo/src/app.ts");
  });

  test("refuses paths outside the repository, including sibling names with the same prefix", () => {
    expect(workingFilePath("/work/repo", "../outside.ts")).toBeNull();
    expect(workingFilePath("/work/repo", "../repo-copy/outside.ts")).toBeNull();
    expect(workingFilePath("/work/repo", "/etc/passwd")).toBeNull();
  });
});
