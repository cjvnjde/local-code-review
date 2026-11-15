import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_UI_SETTINGS,
  type UiSettings,
} from "../../../shared/settings.ts";
import { request } from "./api.ts";

const UI = createContext<{
  settings: UiSettings;
  update: (patch: Partial<UiSettings>) => void;
}>({ settings: { ...DEFAULT_UI_SETTINGS }, update: () => {} });
export const useUi = () => useContext(UI);
export function UiPreferences({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [settings, setSettings] = useState<UiSettings>({
    ...DEFAULT_UI_SETTINGS,
  });
  const pending = useRef(0);
  const config = useQuery({
    queryKey: ["settings"],
    queryFn: () => request<{ settings: UiSettings }>("/api/settings"),
  });
  useEffect(() => {
    if (config.data && !pending.current) setSettings(config.data.settings);
  }, [config.data]);
  const save = useMutation({
    scope: { id: "ui-settings" },
    mutationFn: (patch: Partial<UiSettings>) =>
      request<{ settings: UiSettings }>("/api/settings", "PUT", patch),
    onSettled: async () => {
      pending.current--;
      if (!pending.current) {
        await client.invalidateQueries({ queryKey: ["settings"] });
        const snapshot = client.getQueryData<{ settings: UiSettings }>([
          "settings",
        ]);
        if (!pending.current && snapshot) setSettings(snapshot.settings);
      }
    },
  });
  const update = useCallback(
    (patch: Partial<UiSettings>) => {
      // Claim local intent synchronously, before an initial GET/refetch can commit.
      pending.current++;
      setSettings((current) => ({ ...current, ...patch }));
      void client.cancelQueries({ queryKey: ["settings"] });
      save.mutate(patch);
    },
    [client, save.mutate],
  );
  return (
    <UI value={{ settings, update }}>
      {children}
      {save.error && (
        <p
          role="alert"
          className="fixed inset-x-3 bottom-11 z-90 border border-destructive bg-card p-3 text-xs text-destructive"
        >
          Could not save settings: {save.error.message}
        </p>
      )}
    </UI>
  );
}
