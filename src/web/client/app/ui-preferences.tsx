import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_UI_SETTINGS,
  type UiSettings,
} from "../../../shared/settings.ts";
import { request } from "./api.ts";
import { useStored } from "./preferences.ts";

const UI = createContext<{
  settings: UiSettings;
  update: (patch: Partial<UiSettings>) => void;
}>({ settings: { ...DEFAULT_UI_SETTINGS }, update: () => {} });
export const useUi = () => useContext(UI);
export function UiPreferences({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useStored<Partial<UiSettings>>(
    "lcr:v2:preferences",
    {},
  );
  const config = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      request<{
        runId: string;
        defaults: Partial<UiSettings>;
        settings: UiSettings;
      }>("/api/settings"),
  });
  const run = useRef("");
  useEffect(() => {
    if (!config.data) return;
    const data = config.data;
    if (run.current !== data.runId) {
      run.current = data.runId;
      setSaved((current) => ({ ...current, ...data.defaults }));
    }
    setSaved((current) => {
      const context = {
        aiContext: data.settings.aiContext,
        contextHtml: data.settings.contextHtml,
        contextFullPage: data.settings.contextFullPage,
      };
      return Object.entries(context).every(
        ([key, value]) => current[key as keyof UiSettings] === value,
      )
        ? current
        : { ...current, ...context };
    });
  }, [config.data]);
  const update = (patch: Partial<UiSettings>) => {
    setSaved((current) => ({ ...current, ...patch }));
    void request("/api/settings", "PUT", patch).catch(() => {});
  };
  return (
    <UI value={{ settings: { ...DEFAULT_UI_SETTINGS, ...saved }, update }}>
      {children}
    </UI>
  );
}
