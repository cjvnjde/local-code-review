import type { Element, Text } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { DiffFile, DiffRow } from "../../../shared/review-types.ts";

export const canPreviewMarkdown = (file: DiffFile) =>
  !file.binary &&
  file.rows.length > 0 &&
  /\.(?:md|markdown|mdown|mkdn?|mkdown)$/i.test(file.path);

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, {
    // Display repository HTML literally, including HTML inside a paragraph.
    handlers: {
      html: (_, node) => ({
        type: "text",
        value: node.value,
        position: node.position,
      }),
    },
  });

export interface MarkdownBlock {
  node: Element | Text;
  change: "ctx" | "del" | "add";
  row: number;
  from: number;
  to: number;
}

/** Parse the visible hunk on each Git side so edits inside tables, fences and lists retain their structure. */
export function markdownBlocks(rows: DiffRow[], visible: number[]) {
  const blocks: MarkdownBlock[] = [];
  const hasAdditions = visible.some((row) => rows[row]!.t === "add");
  const hasDeletions = visible.some((row) => rows[row]!.t === "del");
  for (const side of ["del", "add"] as const) {
    if (side === "del" ? !hasDeletions : hasDeletions && !hasAdditions)
      continue;
    const indices = visible.filter(
      (row) => rows[row]!.t === "ctx" || rows[row]!.t === side,
    );
    const document = parser.parse(
      indices.map((row) => rows[row]!.text).join("\n"),
    );
    const tree = parser.runSync(document);
    let formattedChange = false;
    for (const node of tree.children) {
      if (node.type !== "element" && node.type !== "text") continue;
      let position = node.position;
      if (node.type === "element" && node.properties.dataFootnotes) {
        const definitions = document.children.filter(
          (child) => child.type === "footnoteDefinition",
        );
        const first = definitions[0]?.position,
          last = definitions.at(-1)?.position;
        if (first && last) position = { start: first.start, end: last.end };
      }
      if (!position) continue;
      const start = position.start.line - 1;
      const end = Math.min(position.end.line, indices.length) - 1;
      const first = indices[start]!,
        last = indices[end]!;
      let changeRow: number | undefined;
      for (let line = start; line <= end; line++) {
        const row = indices[line]!;
        if (rows[row]!.t === side) {
          changeRow = row;
          break;
        }
      }
      if (side === "del" && hasAdditions && changeRow === undefined) continue;
      if (changeRow !== undefined) formattedChange = true;
      blocks.push({
        node,
        change: changeRow === undefined ? "ctx" : side,
        row: changeRow ?? first,
        from: first,
        to: last,
      });
    }
    // Whitespace-only edits and standalone link definitions can have no rendered content.
    if (!formattedChange) {
      for (const row of indices) {
        if (rows[row]!.t !== side) continue;
        blocks.push({
          row,
          from: row,
          to: row,
          change: side,
          node: {
            type: "element",
            tagName: "code",
            properties: {},
            children: [{ type: "text", value: rows[row]!.text }],
          },
        });
      }
    }
  }
  return blocks.sort((a, b) => a.row - b.row);
}
