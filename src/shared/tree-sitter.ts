export const RECOMMENDED_PARSER_LABELS = [
  "JavaScript / JSX",
  "TypeScript / TSX",
  "YAML",
  "HTML",
  "CSS",
  "JSON",
  "Bash",
  "Python",
  "Go",
  "Rust",
] as const;

// File types declared by the recommended upstream grammars. This catalog only
// recommends installs; Tree-sitter still selects the actual highlighting grammar.
const PARSER_LANGUAGES = [
  {
    scope: "source.js",
    label: "JavaScript / JSX",
    parser: "javascript",
    fileTypes: ["js", "jsx", "mjs", "cjs"],
  },
  {
    scope: "source.ts",
    label: "TypeScript",
    parser: "typescript",
    fileTypes: ["ts"],
  },
  {
    scope: "source.tsx",
    label: "TSX",
    parser: "typescript",
    fileTypes: ["tsx"],
  },
  {
    scope: "source.yaml",
    label: "YAML",
    parser: "yaml",
    fileTypes: ["yaml", "yml"],
  },
  { scope: "source.html", label: "HTML", parser: "html", fileTypes: ["html"] },
  { scope: "source.css", label: "CSS", parser: "css", fileTypes: ["css"] },
  { scope: "source.json", label: "JSON", parser: "json", fileTypes: ["json"] },
  {
    scope: "source.bash",
    label: "Bash",
    parser: "bash",
    fileTypes: ["sh", "bash", ".bashrc", ".bash_profile", "ebuild", "eclass"],
  },
  {
    scope: "source.python",
    label: "Python",
    parser: "python",
    fileTypes: ["py"],
  },
  { scope: "source.go", label: "Go", parser: "go", fileTypes: ["go"] },
  { scope: "source.rust", label: "Rust", parser: "rust", fileTypes: ["rs"] },
] as const;

export interface ParserReviewFile {
  path: string;
  from?: string;
  binary?: boolean;
}

export interface ReviewParser {
  scope: string;
  label: string;
  parser: (typeof PARSER_LANGUAGES)[number]["parser"];
  files: number;
  configured: boolean;
}

export interface ReviewParserStatus {
  languages: ReviewParser[];
  missingTools: string[];
}

/** Count each diff file once per language, including the old side of renames. */
export function reviewParserStatus(
  files: readonly ParserReviewFile[],
  scopes: readonly string[],
  missingTools: readonly string[],
): ReviewParserStatus {
  const languages: ReviewParser[] = [];
  for (const language of PARSER_LANGUAGES) {
    const count = files.filter(
      (file) =>
        !file.binary &&
        [file.path, file.from].some((filePath) => {
          if (!filePath) return false;
          const name = filePath.split("/").at(-1)!;
          const dot = name.lastIndexOf(".");
          const extension = dot >= 0 ? name.slice(dot + 1) : "";
          return language.fileTypes.some(
            (type) => type === name || type === extension,
          );
        }),
    ).length;
    if (count)
      languages.push({
        scope: language.scope,
        label: language.label,
        parser: language.parser,
        files: count,
        configured: scopes.includes(language.scope),
      });
  }
  const missing = languages.filter((language) => !language.configured);
  return {
    languages,
    missingTools: missing.length
      ? missingTools.filter(
          (tool) =>
            tool !== "bun" ||
            missing.some((language) => language.parser === "typescript"),
        )
      : [],
  };
}

export interface TreeSitterStatus {
  enabled: boolean;
  cli: { path: string; version: string } | null;
  languages: string[];
  review: ReviewParserStatus;
  directory: string;
  missingTools: string[];
  error: string | null;
  installation:
    | { state: "idle" }
    | { state: "running" | "complete" | "failed"; detail: string };
}
