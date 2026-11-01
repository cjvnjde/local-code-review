export interface UiSettings {
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
  expand: number;
  navHidden: boolean;
  ntFold: boolean;
  bmFold: boolean;
  single: boolean;
  ghosts: boolean;
  editor: string;
}

export const DEFAULT_UI_SETTINGS: Readonly<UiSettings> = {
  auto: true,
  back: true,
  limit: 900,
  toast: true,
  hide: "",
  hideEnabled: true,
  disabledHide: [],
  hideDeleted: false,
  foldDel: false,
  enterSaves: false,
  expand: 20,
  navHidden: false,
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
