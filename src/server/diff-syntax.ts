import type { DiffFile, DiffRow } from "../shared/review-types.ts";
import type { SyntaxToken } from "../shared/syntax.ts";
import { createTreeSitter, MAX_SYNTAX_BYTES } from "./tree-sitter.ts";

export function createDiffSyntax(
  read: (side: "old" | "new", file: string) => Promise<Uint8Array | null>,
  backend = createTreeSitter(),
) {
  async function tokens(side: "old" | "new", file: string) {
    try {
      const bytes = await read(side, file);
      if (!bytes || bytes.byteLength > MAX_SYNTAX_BYTES) return null;
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return await backend.highlight(file, source);
    } catch {
      return null;
    }
  }

  function apply(
    rows: DiffRow[],
    old: SyntaxToken[][] | null,
    next: SyntaxToken[][] | null,
  ) {
    // Readbacks can race an edit or differ from Git's displayed text (e.g. textconv).
    // Only attach a side's tokens when every visible row on that side still matches.
    const matches = (side: "old" | "new", lines: SyntaxToken[][] | null) =>
      lines &&
      rows.every((row) => {
        if (
          row.t === "hunk" ||
          (side === "old" ? row.t !== "del" : row.t === "del")
        )
          return true;
        const number = side === "old" ? row.o : row.n;
        return (
          number != null &&
          lines[number - 1]?.map((token) => token.text).join("") === row.text
        );
      });
    const before = matches("old", old) ? old : null;
    const after = matches("new", next) ? next : null;
    return rows.map((row) => {
      if (row.t === "hunk") return row;
      const number = row.t === "del" ? row.o : row.n;
      const syntax =
        number == null
          ? undefined
          : (row.t === "del" ? before : after)?.[number - 1];
      return syntax ? { ...row, syntax } : row;
    });
  }

  return {
    async files(files: DiffFile[]): Promise<DiffFile[]> {
      if (!(await backend.available())) return files;
      const result = [...files];
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, files.length) }, async () => {
          while (index < files.length) {
            const at = index++;
            const file = files[at]!;
            if (file.binary || !file.rows.some((row) => row.t !== "hunk"))
              continue;
            const [old, next] = await Promise.all([
              file.rows.some((row) => row.t === "del")
                ? tokens("old", file.from ?? file.path)
                : null,
              file.rows.some((row) => row.t === "ctx" || row.t === "add")
                ? tokens("new", file.path)
                : null,
            ]);
            result[at] = { ...file, rows: apply(file.rows, old, next) };
          }
        }),
      );
      return result;
    },
    async context(file: string, rows: DiffRow[]): Promise<DiffRow[]> {
      if (!rows.length || !(await backend.available())) return rows;
      return apply(rows, null, await tokens("new", file));
    },
  };
}
