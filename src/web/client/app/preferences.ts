import { useEffect, useState } from "react";

export function useStored<T>(key: string, fallback: T) {
  const read = () => {
    try {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(read);
  const [error, setError] = useState("");
  useEffect(() => {
    setValue(read());
  }, [key]);
  // The key is fixed for a mounted review workspace, so a write can never migrate a draft to another repo.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setError("");
    } catch {
      setError(
        "Browser storage is unavailable. Keep this page open until your note is saved.",
      );
    }
  }, [key, value]);
  return [value, setValue, error] as const;
}
