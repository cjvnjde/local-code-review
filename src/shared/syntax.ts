/** Both highlighters use the existing palette; external markup never reaches React. */
export const SYNTAX_CLASSES = {
  plain: "",
  comment: "hljs-comment",
  keyword: "hljs-keyword",
  string: "hljs-string",
  number: "hljs-number",
  function: "hljs-title",
  type: "hljs-type",
  variable: "hljs-variable",
  attribute: "hljs-attr",
  regexp: "hljs-regexp",
  tag: "hljs-name",
  meta: "hljs-meta",
} as const;

export type SyntaxKind = keyof typeof SYNTAX_CLASSES;
export interface SyntaxToken {
  text: string;
  kind: SyntaxKind;
}
