import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

export function useStored<T>(
  key: string,
  fallback: T,
  storageKind: "local" | "session" = "local",
) {
  const read = () => {
    try {
      const value = (
        storageKind === "session" ? sessionStorage : localStorage
      ).getItem(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(read);
  const latest = useRef(value);
  latest.current = value;
  const [error, setError] = useState("");
  useEffect(() => {
    const next = read();
    latest.current = next;
    setValue(next);
  }, [key, storageKind]);
  // Persist at the action boundary: a reload immediately after typing must not outrun an effect.
  const update = useCallback(
    (change: SetStateAction<T>) => {
      const next =
        typeof change === "function"
          ? (change as (previous: T) => T)(latest.current)
          : change;
      latest.current = next;
      setValue(next);
      try {
        (storageKind === "session" ? sessionStorage : localStorage).setItem(
          key,
          JSON.stringify(next),
        );
        setError("");
      } catch {
        setError(
          "Browser storage is unavailable. Keep this page open until your note is saved.",
        );
      }
    },
    [key, storageKind],
  );
  return [value, update, error] as const;
}
