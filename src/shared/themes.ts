export const THEME_COLORS = [
  {
    key: "background",
    label: "Page background",
    group: "Surfaces",
    description: "Main review canvas and input backgrounds.",
  },
  {
    key: "foreground",
    label: "Main text",
    group: "Surfaces",
    description: "Body text, code punctuation, headings, and default icons.",
  },
  {
    key: "card",
    label: "Panels and cards",
    group: "Surfaces",
    description: "Header, sidebars, note cards, dialogs, and file headers.",
  },
  {
    key: "popover",
    label: "Floating surfaces",
    group: "Surfaces",
    description: "Dropdown menus, tooltips, and notifications.",
  },
  {
    key: "muted",
    label: "Muted surface",
    group: "Surfaces",
    description: "Code blocks, inline code, and subdued control backgrounds.",
  },
  {
    key: "muted-foreground",
    label: "Secondary text",
    group: "Surfaces",
    description: "Line numbers, metadata, hints, and inactive icons.",
  },
  {
    key: "accent",
    label: "Hover and selection",
    group: "Controls",
    description: "Hovered controls and selected navigation items.",
  },
  {
    key: "accent-foreground",
    label: "Hover text",
    group: "Controls",
    description: "Text on accent-filled controls.",
  },
  {
    key: "primary",
    label: "Primary accent",
    group: "Controls",
    description:
      "Primary buttons, links, active controls, and text-selection highlights.",
  },
  {
    key: "primary-foreground",
    label: "Primary button text",
    group: "Controls",
    description: "Text and icons on primary-filled buttons.",
  },
  {
    key: "border",
    label: "Borders",
    group: "Controls",
    description:
      "Panel dividers, card outlines, input borders, and scrollbars.",
  },
  {
    key: "ring",
    label: "Focus ring",
    group: "Controls",
    description:
      "Keyboard-focus outlines and drawing-editor selection controls.",
  },
  {
    key: "overlay",
    label: "Modal backdrop",
    group: "Controls",
    description:
      "The dimmed background behind dialogs, shown at partial opacity.",
  },
  {
    key: "destructive",
    label: "Errors and destructive actions",
    group: "Status and diffs",
    description: "Errors, failed saves, and delete controls.",
  },
  {
    key: "success",
    label: "Success",
    group: "Status and diffs",
    description: "Viewed files, resolved notes, and successful agent activity.",
  },
  {
    key: "warning",
    label: "Warning",
    group: "Status and diffs",
    description:
      "Pending notes, modified files, permission warnings, and annotated-text highlights.",
  },
  {
    key: "diff-add",
    label: "Added-line background",
    group: "Status and diffs",
    description: "Background of added lines in diffs and suggested changes.",
  },
  {
    key: "diff-del",
    label: "Removed-line background",
    group: "Status and diffs",
    description: "Background of removed lines in diffs and suggested changes.",
  },
  {
    key: "diff-add-foreground",
    label: "Additions",
    group: "Status and diffs",
    description:
      "Added-file markers, addition counts, and changed-word highlights.",
  },
  {
    key: "diff-del-foreground",
    label: "Deletions",
    group: "Status and diffs",
    description:
      "Deleted-file markers, deletion counts, and removed-word highlights.",
  },
  {
    key: "syntax-comment",
    label: "Comments",
    group: "Syntax",
    description: "Code comments, documentation comments, and quotations.",
  },
  {
    key: "syntax-keyword",
    label: "Keywords",
    group: "Syntax",
    description: "Language keywords, operators, and boolean/null literals.",
  },
  {
    key: "syntax-string",
    label: "Strings",
    group: "Syntax",
    description: "String literals, code links, and embedded string text.",
  },
  {
    key: "syntax-number",
    label: "Numbers",
    group: "Syntax",
    description: "Numeric literals, constants, and symbols.",
  },
  {
    key: "syntax-function",
    label: "Functions",
    group: "Syntax",
    description: "Function names, code section titles, and selectors.",
  },
  {
    key: "syntax-type",
    label: "Types",
    group: "Syntax",
    description: "Class names, built-in types, and built-in functions.",
  },
  {
    key: "syntax-variable",
    label: "Variables",
    group: "Syntax",
    description: "Variables, parameters, and template substitutions.",
  },
  {
    key: "syntax-attribute",
    label: "Attributes",
    group: "Syntax",
    description: "Object properties, HTML attributes, and CSS properties.",
  },
  {
    key: "syntax-regexp",
    label: "Regular expressions",
    group: "Syntax",
    description: "Regular expressions and escaped characters.",
  },
  {
    key: "syntax-tag",
    label: "Tags",
    group: "Syntax",
    description: "HTML/XML tag names and CSS tags.",
  },
  {
    key: "syntax-meta",
    label: "Metadata",
    group: "Syntax",
    description:
      "Preprocessor directives, annotations, and other language metadata.",
  },
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number]["key"];
export type ThemeColors = Record<ThemeColor, string>;
export type ThemeMode = "light" | "dark";
export interface ThemeDraft {
  name: string;
  mode: ThemeMode;
  /** Provenance only: every saved copy contains a complete, independent palette. */
  extends?: string;
  colors: ThemeColors;
}
export interface Theme extends ThemeDraft {
  id: string;
}
export interface ThemeCatalog {
  themes: Theme[];
  directory: string;
  errors: string[];
}

const light: ThemeColors = {
  background: "#fafafa",
  foreground: "#18181b",
  card: "#ffffff",
  popover: "#ffffff",
  muted: "#f0f0f3",
  "muted-foreground": "#60606b",
  accent: "#ededf2",
  "accent-foreground": "#18181b",
  primary: "#6d5bd0",
  "primary-foreground": "#ffffff",
  border: "#e4e4e7",
  ring: "#9482ef",
  overlay: "#000000",
  destructive: "#dc2626",
  success: "#16824a",
  warning: "#a16207",
  "diff-add": "#e7f5ec",
  "diff-del": "#fbe9ed",
  "diff-add-foreground": "#16824a",
  "diff-del-foreground": "#be123c",
  "syntax-comment": "#757580",
  "syntax-keyword": "#a626a4",
  "syntax-string": "#16824a",
  "syntax-number": "#285cb4",
  "syntax-function": "#285cb4",
  "syntax-type": "#7c3a9e",
  "syntax-variable": "#953800",
  "syntax-attribute": "#0550ae",
  "syntax-regexp": "#0a3069",
  "syntax-tag": "#116329",
  "syntax-meta": "#6e7781",
};
const dark: ThemeColors = {
  background: "#111114",
  foreground: "#e8e8ed",
  card: "#18181c",
  popover: "#222228",
  muted: "#242429",
  "muted-foreground": "#a2a2b0",
  accent: "#2a2a32",
  "accent-foreground": "#fafafa",
  primary: "#b0a0ff",
  "primary-foreground": "#19142e",
  border: "#2b2b33",
  ring: "#b0a0ff",
  overlay: "#000000",
  destructive: "#fb7185",
  success: "#3fb950",
  warning: "#e3b341",
  "diff-add": "#13211b",
  "diff-del": "#25151b",
  "diff-add-foreground": "#3fb950",
  "diff-del-foreground": "#f47067",
  "syntax-comment": "#768390",
  "syntax-keyword": "#f47067",
  "syntax-string": "#96d0ff",
  "syntax-number": "#6cb6ff",
  "syntax-function": "#dcbdfb",
  "syntax-type": "#f69d50",
  "syntax-variable": "#f69d50",
  "syntax-attribute": "#6cb6ff",
  "syntax-regexp": "#96d0ff",
  "syntax-tag": "#8ddb8c",
  "syntax-meta": "#768390",
};
const latte: ThemeColors = {
  background: "#eff1f5",
  foreground: "#4c4f69",
  card: "#e6e9ef",
  popover: "#eff1f5",
  muted: "#ccd0da",
  "muted-foreground": "#6c6f85",
  accent: "#ccd0da",
  "accent-foreground": "#4c4f69",
  primary: "#8839ef",
  "primary-foreground": "#eff1f5",
  border: "#bcc0cc",
  ring: "#7287fd",
  overlay: "#4c4f69",
  destructive: "#d20f39",
  success: "#40a02b",
  warning: "#df8e1d",
  "diff-add": "#dce8dd",
  "diff-del": "#ecd6df",
  "diff-add-foreground": "#40a02b",
  "diff-del-foreground": "#d20f39",
  "syntax-comment": "#7c7f93",
  "syntax-keyword": "#8839ef",
  "syntax-string": "#40a02b",
  "syntax-number": "#fe640b",
  "syntax-function": "#1e66f5",
  "syntax-type": "#df8e1d",
  "syntax-variable": "#4c4f69",
  "syntax-attribute": "#1e66f5",
  "syntax-regexp": "#d20f39",
  "syntax-tag": "#179299",
  "syntax-meta": "#dd7878",
};
const mocha: ThemeColors = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  card: "#181825",
  popover: "#313244",
  muted: "#313244",
  "muted-foreground": "#a6adc8",
  accent: "#45475a",
  "accent-foreground": "#cdd6f4",
  primary: "#cba6f7",
  "primary-foreground": "#1e1e2e",
  border: "#45475a",
  ring: "#b4befe",
  overlay: "#11111b",
  destructive: "#f38ba8",
  success: "#a6e3a1",
  warning: "#f9e2af",
  "diff-add": "#313e3d",
  "diff-del": "#3e2e40",
  "diff-add-foreground": "#a6e3a1",
  "diff-del-foreground": "#f38ba8",
  "syntax-comment": "#7f849c",
  "syntax-keyword": "#cba6f7",
  "syntax-string": "#a6e3a1",
  "syntax-number": "#fab387",
  "syntax-function": "#89b4fa",
  "syntax-type": "#f9e2af",
  "syntax-variable": "#cdd6f4",
  "syntax-attribute": "#89b4fa",
  "syntax-regexp": "#f5c2e7",
  "syntax-tag": "#94e2d5",
  "syntax-meta": "#f2cdcd",
};

export const BUILTIN_THEMES: Theme[] = [
  { id: "light", name: "Light", mode: "light", colors: light },
  { id: "dark", name: "Dark", mode: "dark", colors: dark },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    mode: "light",
    colors: latte,
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    mode: "dark",
    colors: mocha,
  },
];
export const DEFAULT_THEME = BUILTIN_THEMES[1]!;
export const isThemeId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
export const isThemeColor = (value: string) => /^#[\da-f]{6}$/i.test(value);

function object(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

/** Accept color literals only, never CSS expressions, URLs, or arbitrary properties. */
export function parseThemeDraft(value: unknown): ThemeDraft {
  const draft = object(value, "Theme");
  for (const key of Object.keys(draft))
    if (!["name", "mode", "extends", "colors"].includes(key))
      throw new Error(`Unknown theme field: ${key}`);
  if (
    typeof draft.name !== "string" ||
    !draft.name.trim() ||
    draft.name.trim().length > 80 ||
    /[\x00-\x1f\x7f]/.test(draft.name)
  )
    throw new Error("Theme name must contain 1–80 printable characters.");
  if (draft.mode !== "light" && draft.mode !== "dark")
    throw new Error("Theme mode must be light or dark.");
  if (draft.extends !== undefined && !isThemeId(draft.extends))
    throw new Error("Invalid base theme ID.");
  const input = object(draft.colors, "Theme colors");
  const colors = {} as ThemeColors;
  for (const key of Object.keys(input))
    if (!THEME_COLORS.some((color) => color.key === key))
      throw new Error(`Unknown theme color: ${key}`);
  for (const { key } of THEME_COLORS) {
    const color = input[key];
    if (typeof color !== "string" || !isThemeColor(color))
      throw new Error(`${key} must be a six-digit hex color, such as #8839ef.`);
    colors[key] = color.toLowerCase();
  }
  return {
    name: draft.name.trim(),
    mode: draft.mode,
    ...(draft.extends === undefined
      ? {}
      : { extends: draft.extends as string }),
    colors,
  };
}

export function parseTheme(value: unknown): Theme {
  const { id, ...draft } = object(value, "Theme");
  if (!isThemeId(id)) throw new Error("Invalid theme ID.");
  return { id, ...parseThemeDraft(draft) };
}
