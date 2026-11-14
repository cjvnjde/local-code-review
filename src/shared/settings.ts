import { DEFAULT_CONTEXT_SETTINGS, type ContextSettings } from "./context.ts";

export interface UiSettings extends ContextSettings {
  aiAnswers: boolean;
  auto: boolean;
  back: boolean;
  limit: number;
  toast: boolean;
  hide: string;
  hideEnabled: boolean;
  disabledHide: string[];
  hideDeleted: boolean;
  foldDel: boolean;
  enterSaves: boolean;
  lineNumbers: boolean;
  wrapLines: boolean;
  expand: number;
  navHidden: boolean;
  navWidth: number;
  ntFold: boolean;
  bmFold: boolean;
  single: boolean;
  ghosts: boolean;
  editor: string;
}

export const DEFAULT_UI_SETTINGS: Readonly<UiSettings> = {
  ...DEFAULT_CONTEXT_SETTINGS,
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
  enterSaves: true,
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
const LIMIT_CHOICES = [0, 500, 900, 1800];
const EXPAND_CHOICES = [10, 20, 50, 100];

/** Validate a partial configuration without coercing values or accepting obsolete preferences. */
export function parseUiSettings(value: unknown): Partial<UiSettings> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ui must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("ui must be an object");
  const settings: Partial<UiSettings> = {};
  for (const [key, next] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_UI_SETTINGS, key))
      throw new Error(`unknown ui setting: ${key}`);
    if (key === "disabledHide") {
      if (
        !Array.isArray(next) ||
        !next.every((item) => typeof item === "string")
      )
        throw new Error("ui.disabledHide must be an array of strings");
      settings.disabledHide = [...next];
    } else if (key === "limit") {
      if (typeof next !== "number" || !LIMIT_CHOICES.includes(next))
        throw new Error("ui.limit must be one of 0, 500, 900, 1800");
      settings.limit = next;
    } else if (key === "expand") {
      if (typeof next !== "number" || !EXPAND_CHOICES.includes(next))
        throw new Error("ui.expand must be one of 10, 20, 50, 100");
      settings.expand = next;
    } else if (key === "navWidth") {
      if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0)
        throw new Error("ui.navWidth must be a non-negative safe integer");
      settings.navWidth = next;
    } else {
      const name = key as keyof UiSettings;
      if (typeof next !== typeof DEFAULT_UI_SETTINGS[name])
        throw new Error(
          `ui.${key} must be a ${typeof DEFAULT_UI_SETTINGS[name]}`,
        );
      Reflect.set(settings, name, next);
    }
  }
  return settings;
}
