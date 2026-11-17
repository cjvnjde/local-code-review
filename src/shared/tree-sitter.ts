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

export interface TreeSitterStatus {
  enabled: boolean;
  cli: { path: string; version: string } | null;
  languages: string[];
  directory: string;
  missingTools: string[];
  error: string | null;
  installation:
    | { state: "idle" }
    | { state: "running" | "complete" | "failed"; detail: string };
}
