import { Parser } from "htmlparser2";
import type { SyntaxKind, SyntaxToken } from "../shared/syntax.ts";

const captures: Record<string, SyntaxKind> = {
  attribute: "attribute",
  boolean: "keyword",
  comment: "comment",
  constant: "number",
  constructor: "type",
  embedded: "plain",
  escape: "regexp",
  function: "function",
  keyword: "keyword",
  label: "attribute",
  module: "type",
  namespace: "type",
  number: "number",
  operator: "keyword",
  property: "attribute",
  punctuation: "plain",
  string: "string",
  tag: "tag",
  type: "type",
  variable: "variable",
} as const;

function captureKind(classes = ""): SyntaxKind | undefined {
  const [name, modifier] = classes.split(/[.\s]+/);
  if (name === "string" && ["regexp", "regex", "escape"].includes(modifier!))
    return "regexp";
  return name && Object.hasOwn(captures, name) ? captures[name] : undefined;
}

/** Accept CLI code blocks (including older line tables), discard all HTML and attributes. */
export function parseSyntaxHtml(
  html: string,
  source: string,
): SyntaxToken[][] | null {
  const lines: SyntaxToken[][] = [[]];
  const kinds: SyntaxKind[] = [];
  let container = "";
  let blockStart = 0;
  let found = false;
  let invalid = false;
  let text = "";
  let count = 0;
  const append = (value: string) => {
    text += value;
    const parts = value.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i) lines.push([]);
      const part = parts[i]!;
      if (!part) continue;
      const line = lines.at(-1)!;
      const kind = kinds.at(-1) ?? "plain";
      const previous = line.at(-1);
      if (previous?.kind === kind) previous.text += part;
      else {
        if (++count > 100_000) throw new Error("Too many syntax tokens");
        line.push({ text: part, kind });
      }
    }
  };
  try {
    new Parser({
      onopentag(name, attributes) {
        if (!container) {
          if (
            name === "code" ||
            (name === "td" && attributes.class === "line")
          ) {
            container = name;
            blockStart = text.length;
            found = true;
            kinds.push("plain");
          }
        } else if (name === "span") {
          kinds.push(captureKind(attributes.class) ?? kinds.at(-1)!);
        } else invalid = true;
      },
      ontext(value) {
        if (container) append(value);
      },
      onclosetag(name) {
        if (!container) return;
        if (name === "span") kinds.pop();
        else if (name === container) {
          if (
            name === "td" &&
            (text.length === blockStart || !text.endsWith("\n"))
          )
            append("\n");
          container = "";
          kinds.length = 0;
        }
      },
    }).end(html);
  } catch {
    return null;
  }
  // CLI versions differ in whether their wrapper retains the final newline.
  // Any other text change, decoding error, or unexpected markup means fallback.
  if (!found || invalid || container) return null;
  const matches = (source: string) =>
    text === source || text === source + "\n" || text + "\n" === source;
  if (matches(source)) return lines;
  // HtmlRenderer drops CR in CRLF. Restore it from the original source so Git
  // rows, copied text, and character anchors keep their exact contents.
  if (source.includes("\r\n") && matches(source.replaceAll("\r\n", "\n"))) {
    const original = source.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (original[index]?.endsWith("\r")) {
        const line = lines[index]!;
        const last = line.at(-1);
        if (last) last.text += "\r";
        else line.push({ text: "\r", kind: "plain" });
      }
    }
    return lines;
  }
  return null;
}
