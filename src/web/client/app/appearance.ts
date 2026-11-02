import { THEMES } from "./theme-registry.ts";

const STORAGE_KEY = "gitreview:appearance";
type ColorMode = "auto" | "light" | "dark";

/** Appearance is browser-local, separate from the server-shared review settings. */
export function startAppearance() {
  const themeControl = document.getElementById("theme") as HTMLSelectElement;
  const modeControl = document.getElementById("colorMode") as HTMLSelectElement;
  const colors = document.createElement("style");
  document.head.append(colors);
  for (const theme of THEMES) {
    themeControl.add(new Option(theme.label, theme.id));
  }

  let theme = THEMES[0];
  let mode: ColorMode = "auto";
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    theme = THEMES.find((entry) => entry.id === saved?.theme) || theme;
    if (saved?.mode === "light" || saved?.mode === "dark") mode = saved.mode;
  } catch {
    // Restricted storage or a stale preference must not prevent reviewing.
  }

  const apply = () => {
    colors.textContent = theme.colors;
    // light-dark() in the palettes follows the OS live in Auto, without rebuilding the page.
    document.documentElement.style.colorScheme =
      mode === "auto" ? "light dark" : mode;
    themeControl.value = theme.id;
    modeControl.value = mode;
  };
  const save = () => {
    apply();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: theme.id, mode }),
      );
    } catch {
      // The selection still works for this page when browser storage is unavailable.
    }
  };
  themeControl.addEventListener("change", () => {
    theme =
      THEMES.find((entry) => entry.id === themeControl.value) || THEMES[0];
    save();
  });
  modeControl.addEventListener("change", () => {
    mode = modeControl.value as ColorMode;
    save();
  });
  apply();
}
