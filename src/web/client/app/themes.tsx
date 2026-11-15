import {
  createContext,
  useContext,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  THEME_COLORS,
  type Theme,
  type ThemeCatalog,
} from "../../../shared/themes.ts";
import { request, useLive } from "./api.ts";
import { useUi } from "./ui-preferences.tsx";

export function themeStyle(theme: Theme): CSSProperties {
  return Object.fromEntries([
    ["colorScheme", theme.mode],
    ...THEME_COLORS.map(({ key }) => [`--${key}`, theme.colors[key]]),
  ]) as CSSProperties;
}

const Themes = createContext<{
  theme: Theme;
  themes: Theme[];
  directory: string;
  errors: string[];
  loading: boolean;
  unavailable: boolean;
  toggleMode: () => void;
} | null>(null);

export function useThemes() {
  const themes = useContext(Themes);
  if (!themes) throw new Error("Theme controls require ThemeProvider.");
  return themes;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useLive();
  const { settings, update } = useUi();
  const catalog = useQuery({
    queryKey: ["themes"],
    queryFn: () => request<ThemeCatalog>("/api/themes"),
  });
  const themes = catalog.data?.themes ?? BUILTIN_THEMES;
  const selected = themes.find((item) => item.id === settings.theme);
  const theme = selected ?? DEFAULT_THEME;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme.mode === "dark");
    root.style.colorScheme = theme.mode;
    root.dataset.theme = theme.id;
    for (const { key } of THEME_COLORS)
      root.style.setProperty(`--${key}`, theme.colors[key]);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme.colors.background);
  }, [theme]);
  return (
    <Themes
      value={{
        theme,
        themes,
        directory: catalog.data?.directory ?? "",
        errors: [
          ...(catalog.data?.errors ?? []),
          ...(catalog.error ? [catalog.error.message] : []),
        ],
        loading: catalog.isPending,
        unavailable: !!catalog.data && !selected,
        toggleMode: () =>
          update({
            theme:
              theme.id === "catppuccin-latte"
                ? "catppuccin-mocha"
                : theme.id === "catppuccin-mocha"
                  ? "catppuccin-latte"
                  : theme.mode === "dark"
                    ? "light"
                    : "dark",
          }),
      }}
    >
      {children}
    </Themes>
  );
}
