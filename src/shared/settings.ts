import { z } from "zod";
import { DEFAULT_CONTEXT_SETTINGS } from "./context.ts";
import { DEFAULT_THEME, isThemeId } from "./themes.ts";

const LIMIT_CHOICES = [0, 500, 900, 1800];
const EXPAND_CHOICES = [10, 20, 50, 100];

export const uiSettingsSchema = z.strictObject({
  aiContext: z.boolean(),
  contextHtml: z.boolean(),
  contextFullPage: z.boolean(),
  contextDiagnostics: z.boolean(),
  theme: z.string().max(80).refine(isThemeId, "Must be a valid theme ID."),
  aiAnswers: z.boolean(),
  auto: z.boolean(),
  back: z.boolean(),
  limit: z
    .number()
    .refine(
      (value) => LIMIT_CHOICES.includes(value),
      "Must be one of 0, 500, 900, 1800.",
    ),
  toast: z.boolean(),
  hide: z.string().max(16384),
  hideEnabled: z.boolean(),
  disabledHide: z
    .custom<unknown[]>(
      (value) => Array.isArray(value) && value.length <= 1000,
      "Must be an array of at most 1000 strings.",
    )
    .pipe(z.array(z.string().max(16384))),
  hideDeleted: z.boolean(),
  foldDel: z.boolean(),
  reviewMode: z.boolean(),
  enterSaves: z.boolean(),
  capturedCodeOpen: z.boolean(),
  noteWidth: z.enum(["compact", "full"]),
  lineNumbers: z.boolean(),
  wrapLines: z.boolean(),
  expand: z
    .number()
    .refine(
      (value) => EXPAND_CHOICES.includes(value),
      "Must be one of 10, 20, 50, 100.",
    ),
  navHidden: z.boolean(),
  navWidth: z.number().int().nonnegative(),
  ntFold: z.boolean(),
  bmFold: z.boolean(),
  single: z.boolean(),
  ghosts: z.boolean(),
  editor: z.string().max(16384),
});
export const uiSettingsPatchSchema = uiSettingsSchema.partial();
export type UiSettings = z.infer<typeof uiSettingsSchema>;

export const DEFAULT_UI_SETTINGS: Readonly<UiSettings> = {
  ...DEFAULT_CONTEXT_SETTINGS,
  theme: DEFAULT_THEME.id,
  aiAnswers: true,
  auto: true,
  back: true,
  limit: 900,
  toast: true,
  hide: "",
  hideEnabled: true,
  disabledHide: [],
  hideDeleted: false,
  foldDel: false,
  reviewMode: false,
  enterSaves: true,
  capturedCodeOpen: false,
  noteWidth: "compact",
  lineNumbers: true,
  wrapLines: true,
  expand: 20,
  navHidden: false,
  navWidth: 0,
  ntFold: false,
  bmFold: false,
  single: false,
  ghosts: true,
  editor: "",
};

/** Validate a partial configuration without coercing values or accepting obsolete preferences. */
export function parseUiSettings(value: unknown): Partial<UiSettings> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ui must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("ui must be an object");
  const parsed = uiSettingsPatchSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.code === "unrecognized_keys")
      throw new Error(`unknown ui setting: ${issue.keys[0]}`);
    throw new Error(`ui.${issue.path.join(".")}: ${issue.message}`);
  }
  return parsed.data;
}
