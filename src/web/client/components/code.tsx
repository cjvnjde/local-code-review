import { Fragment, memo, type ReactNode } from "react";
import hljs from "highlight.js/lib/common";
import { parseDocument } from "htmlparser2";
import { SYNTAX_CLASSES, type SyntaxToken } from "../../../shared/syntax.ts";
import { findColors, type ColorLiteral } from "./color-literals.ts";

const aliases: Record<string, string> = {
  tsx: "typescript",
  jsx: "javascript",
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  md: "markdown",
  sh: "bash",
  yml: "yaml",
  py: "python",
  rs: "rust",
  rb: "ruby",
};
export function languageFor(file: string) {
  const extension = file.split(".").pop()?.toLowerCase() || "";
  const language = aliases[extension] || extension;
  return hljs.getLanguage(language) ? language : "plaintext";
}
export function highlighted(code: string, language: string) {
  // highlight.js escapes source text before emitting its own token spans.
  return hljs.highlight(code, {
    language: hljs.getLanguage(language) ? language : "plaintext",
    ignoreIllegals: true,
  }).value;
}

function swatchRenderer(colors: ColorLiteral[]) {
  // Match against the source line, so a literal can span multiple syntax tokens.
  let offset = 0;
  let next = 0;
  return (value: string): ReactNode => {
    const start = offset;
    offset += value.length;
    if (!colors[next] || colors[next].from >= offset) return value;
    const parts: ReactNode[] = [];
    let from = 0;
    while (colors[next] && colors[next].from < offset) {
      const color = colors[next++]!;
      const index = color.from - start;
      parts.push(
        value.slice(from, index),
        <span
          key={color.from}
          aria-hidden="true"
          className="pointer-events-none mr-1 inline-block size-[0.85em] rounded-[2px] border border-current/25 align-[-0.1em] select-none"
          style={{ backgroundColor: color.css }}
        />,
      );
      from = index;
    }
    parts.push(value.slice(from));
    return parts;
  };
}

function renderHighlightedSwatches(
  html: string,
  renderText: (value: string) => ReactNode,
) {
  const tree = parseDocument(html);
  function renderHighlight(
    node: (typeof tree.children)[number],
    index: number,
  ): ReactNode {
    if (node.type === "text")
      return <Fragment key={index}>{renderText(node.data)}</Fragment>;
    if (node.type === "tag")
      return (
        <span key={index} className={node.attribs.class}>
          {node.children.map(renderHighlight)}
        </span>
      );
    return null;
  }
  return tree.children.map(renderHighlight);
}

export const Code = memo(function Code({
  value,
  language = "plaintext",
  className,
  tokens,
  previewHexColors = false,
}: {
  value: string;
  language?: string;
  className?: string;
  tokens?: SyntaxToken[];
  previewHexColors?: boolean;
}) {
  const colors =
    previewHexColors && value.includes("#")
      ? findColors(value).filter((color) => color.value.startsWith("#"))
      : [];
  const renderText = colors.length ? swatchRenderer(colors) : undefined;
  if (tokens)
    return (
      <code className={className}>
        {tokens.map((token, index) =>
          token.kind === "plain" ? (
            renderText ? (
              <Fragment key={index}>{renderText(token.text)}</Fragment>
            ) : (
              token.text
            )
          ) : (
            <span key={index} className={SYNTAX_CLASSES[token.kind]}>
              {renderText ? renderText(token.text) : token.text}
            </span>
          ),
        )}
      </code>
    );
  const html = highlighted(value, language);
  return renderText ? (
    <code className={className}>
      {renderHighlightedSwatches(html, renderText)}
    </code>
  ) : (
    <code className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
});
