import { memo } from "react";
import hljs from "highlight.js/lib/common";
import { SYNTAX_CLASSES, type SyntaxToken } from "../../../shared/syntax.ts";

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
export const Code = memo(function Code({
  value,
  language = "plaintext",
  className,
  tokens,
}: {
  value: string;
  language?: string;
  className?: string;
  tokens?: SyntaxToken[];
}) {
  if (tokens)
    return (
      <code className={className}>
        {tokens.map((token, index) =>
          token.kind === "plain" ? (
            token.text
          ) : (
            <span key={index} className={SYNTAX_CLASSES[token.kind]}>
              {token.text}
            </span>
          ),
        )}
      </code>
    );
  return (
    <code
      className={className}
      dangerouslySetInnerHTML={{ __html: highlighted(value, language) }}
    />
  );
});
