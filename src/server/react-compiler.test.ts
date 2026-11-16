import { expect, test } from "bun:test";
import path from "node:path";
import { compileReact } from "../../scripts/react-compiler.ts";

test("the workspace and file navigation actually receive React Compiler memoization", async () => {
  for (const [file, expected] of [
    ["app/app.tsx", ["App", "Workspace"]],
    ["navigation/file-tree.tsx", ["FileTree"]],
    ["notes/references.tsx", ["ReviewReferences"]],
  ] as const) {
    const compiled: string[] = [];
    const failures: string[] = [];
    const filename = path.resolve(import.meta.dir, "../web/client", file);
    const output = await compileReact(
      await Bun.file(filename).text(),
      filename,
      {
        logEvent(_filename, event) {
          if (
            event.kind === "CompileSuccess" &&
            event.fnName &&
            event.memoSlots > 0
          )
            compiled.push(event.fnName);
          if (event.kind === "CompileError") failures.push(event.detail.reason);
        },
      },
    );
    expect(failures).toEqual([]);
    expect(compiled).toEqual(expect.arrayContaining([...expected]));
    expect(output).toContain('from "react/compiler-runtime"');
  }
});

test("the compiler parses plain TypeScript generics and leaves the mutable virtualizer uncached", async () => {
  const generic = await compileReact(
    "export const identity = <T>(value: T): T => value;",
    "example.ts",
  );
  expect(generic).toContain("identity");
  const filename = path.resolve(
    import.meta.dir,
    "../web/client/diff/diff-view.tsx",
  );
  const compiled: string[] = [];
  const output = await compileReact(await Bun.file(filename).text(), filename, {
    logEvent(_filename, event) {
      if (event.kind === "CompileSuccess" && event.fnName)
        compiled.push(event.fnName);
    },
  });
  expect(output).toContain('"use no memo"');
  expect(compiled).not.toContain("DiffView");
});
