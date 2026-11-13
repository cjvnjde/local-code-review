export const CONTEXT_VERSION = 1;
export const CONTEXT_MAX_BYTES = 12 * 1024 * 1024;
export const CONTEXT_TEXT_LIMIT = 16 * 1024;
export const CONTEXT_TEXT_MAX = 64 * 1024;

export interface ContextRef {
  id: string;
  label: string;
}
export interface ContextPart {
  name: string;
  label: string;
  type: string;
  status: "available" | "unavailable" | "excluded";
  bytes: number;
  sha256?: string;
  /** A basename inside the bundle, never a caller-controlled filesystem path. */
  file?: string;
  /** An existing image path relative to the review file. */
  attachment?: string;
  truncated?: boolean;
  detail?: string;
}
export interface ContextManifest {
  version: 1;
  id: string;
  label: string;
  at: string;
  source?: { url?: string; title?: string; captureAt?: string };
  parts: ContextPart[];
}
export interface ContextSettings {
  aiContext: boolean;
  contextHtml: boolean;
  contextFullPage: boolean;
}
export const DEFAULT_CONTEXT_SETTINGS: Readonly<ContextSettings> = {
  aiContext: true,
  contextHtml: true,
  contextFullPage: true,
};

export function contextId(value: unknown): string {
  if (typeof value !== "string") return "";
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  return (
    /^(?:\.\/)?context\/([a-f0-9]{64})\/manifest\.json$/.exec(value)?.[1] ?? ""
  );
}
export const contextPath = (id: string) => `context/${id}/manifest.json`;
export function contextRef(value: unknown): ContextRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value as Partial<ContextRef>;
  return typeof ref.id === "string" &&
    /^[a-f0-9]{64}$/.test(ref.id) &&
    typeof ref.label === "string" &&
    ref.label.length > 0 &&
    ref.label.length <= 200
    ? { id: ref.id, label: ref.label }
    : null;
}
export function contextLink(ref: ContextRef): string {
  const label = ref.label.replace(/[\\\[\]\r\n]/g, " ");
  return `[Additional context: ${label}](${contextPath(ref.id)})`;
}
/** References stay in prose, so original notes and every kind of reply share one format. */
export function contextIds(text: string): string[] {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /\[[^\]\n]*\]\((?:\.\/)?context\/([a-f0-9]{64})\/manifest\.json\)/g,
        ),
      ].map((match) => match[1]!),
    ),
  ];
}
export function contextIsText(type: string): boolean {
  return type.startsWith("text/") || type === "application/json";
}
