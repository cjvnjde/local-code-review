import { useUi } from "../app/ui-preferences.tsx";
import { Code } from "../components/code.tsx";

export function CapturedCode({
  value,
  outdated = false,
  label = "Captured code",
}: {
  value: string;
  outdated?: boolean;
  label?: string;
}) {
  const { settings } = useUi();
  return (
    <details className="text-xs" open={settings.capturedCodeOpen}>
      <summary className="cursor-pointer text-muted-foreground">
        Captured code{outdated ? " · no longer in diff" : ""}
      </summary>
      <pre
        aria-label={label}
        className="mt-1 max-h-48 overflow-auto py-1 text-xs"
      >
        <Code value={value} language="diff" />
      </pre>
    </details>
  );
}
