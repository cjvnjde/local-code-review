import { afterEach, describe, expect, test } from "bun:test";
import { watch } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  configuredEditorCommand,
  editorCommand,
  openInEditor,
  workingFilePath,
} from "./editor.ts";

describe("editorCommand", () => {
  test("uses the platform default application without a shell", () => {
    expect(editorCommand("/repo/src/a file.ts", "darwin")).toEqual([
      "open",
      "/repo/src/a file.ts",
    ]);
    expect(editorCommand("C:\\repo\\src\\a file.ts", "win32")).toEqual([
      "explorer.exe",
      "C:\\repo\\src\\a file.ts",
    ]);
    expect(editorCommand("/repo/src/a file.ts", "linux")).toEqual([
      "xdg-open",
      "/repo/src/a file.ts",
    ]);
  });
});

describe("configuredEditorCommand", () => {
  test("resolves one configured executable and keeps the file path as one argument", () => {
    const which = (command: string) =>
      command === "code" ? "/usr/bin/code" : null;
    expect(
      configuredEditorCommand("/repo/src/a file.ts", " code ", "linux", which),
    ).toEqual(["/usr/bin/code", "/repo/src/a file.ts"]);
  });

  test("uses the system default when no editor is configured", () => {
    expect(configuredEditorCommand("/repo/src/app.ts", "", "linux")).toEqual([
      "xdg-open",
      "/repo/src/app.ts",
    ]);
  });

  test("refuses an unavailable command and never parses command arguments", () => {
    const which = () => null;
    expect(
      configuredEditorCommand(
        "/repo/src/app.ts",
        "missing-editor",
        "linux",
        which,
      ),
    ).toBeNull();
    expect(
      configuredEditorCommand(
        "/repo/src/app.ts",
        "code --wait",
        "linux",
        which,
      ),
    ).toBeNull();
  });
});

describe("workingFilePath", () => {
  test("resolves a repository-relative file", () => {
    expect(workingFilePath("/work/repo", "src/app.ts")).toBe(
      "/work/repo/src/app.ts",
    );
  });

  test("refuses paths outside the repository, including sibling names with the same prefix", () => {
    expect(workingFilePath("/work/repo", "../outside.ts")).toBeNull();
    expect(workingFilePath("/work/repo", "../repo-copy/outside.ts")).toBeNull();
    expect(workingFilePath("/work/repo", "/etc/passwd")).toBeNull();
  });
});

const editorRoots: string[] = [];
afterEach(async () => {
  for (const root of editorRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function editorFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-editor-"));
  editorRoots.push(root);
  const log = path.join(root, "arguments.json");
  const executable = path.join(root, "configured editor");
  const script = path.join(root, "record-arguments.ts");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(
    script,
    `import { rename } from "node:fs/promises";\nawait Bun.write(${JSON.stringify(log + ".tmp")}, JSON.stringify(process.argv.slice(2)));\nawait rename(${JSON.stringify(log + ".tmp")}, ${JSON.stringify(log)});\n`,
  );
  await writeFile(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
  );
  await chmod(executable, 0o755);
  return { root, log, executable };
}

describe("editor launch boundaries", () => {
  test.skipIf(process.platform === "win32")(
    "passes metacharacters and spaces as one literal file argument to a real executable",
    async () => {
      const { root, log, executable } = await editorFixture();
      const file = "a file; $(touch owned).ts";
      await writeFile(path.join(root, file), "review me");
      const recorded = Promise.withResolvers<void>();
      const watcher = watch(root, (_event, name) => {
        if (name === path.basename(log)) recorded.resolve();
      });
      try {
        expect(await openInEditor(root, file, executable)).toBe(true);
        await recorded.promise;
        expect(JSON.parse(await readFile(log, "utf8"))).toEqual([
          path.join(root, file),
        ]);
        expect(await Bun.file(path.join(root, "owned")).exists()).toBe(false);
      } finally {
        watcher.close();
      }
    },
  );

  test("missing files and paths escaping the working tree never start an editor", async () => {
    const { root, log, executable } = await editorFixture();
    for (const file of ["missing.ts", "..", "../outside.ts", root, ""])
      expect(await openInEditor(root, file, executable)).toBe(false);
    expect(await Bun.file(log).exists()).toBe(false);
  });

  test("an existing file still reports failure when the executable cannot be spawned", async () => {
    const { root } = await editorFixture();
    await writeFile(path.join(root, "app.ts"), "contents");
    expect(
      await openInEditor(root, "app.ts", path.join(root, "missing-editor")),
    ).toBe(false);
  });

  test("rejects embedded executable control characters before command lookup", () => {
    const lookedUp: string[] = [];
    for (const editor of ["co\0de", "co\nde", "co\tde", "co\rde", "co\x1fde"])
      expect(
        configuredEditorCommand("/repo/app.ts", editor, "linux", (command) => {
          lookedUp.push(command);
          return "/bin/editor";
        }),
      ).toBeNull();
    expect(lookedUp).toEqual([]);
  });

  test("absolute executable paths bypass lookup and retain spaces without shell splitting", () => {
    expect(
      configuredEditorCommand(
        "/repo/a file.ts",
        " /Applications/My Editor/bin/editor ",
        "darwin",
        () => {
          throw new Error("absolute executables must not use PATH");
        },
      ),
    ).toEqual(["/Applications/My Editor/bin/editor", "/repo/a file.ts"]);
  });

  test("normalizes internal dot segments without mistaking a prefix-like filename for escape", () => {
    expect(workingFilePath("/work/repo", "src/../..hidden.ts")).toBe(
      "/work/repo/..hidden.ts",
    );
    expect(workingFilePath("/work/repo", "./src/../")).toBeNull();
    expect(workingFilePath("/work/repo", "/work/repo/app.ts")).toBe(
      "/work/repo/app.ts",
    );
  });
});
