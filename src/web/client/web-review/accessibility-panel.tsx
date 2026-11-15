import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AccessibilityReport,
  AccessibilitySaveResult,
} from "../../../shared/accessibility.ts";
import { request } from "../app/api.ts";
import { Button } from "../components/ui/button.tsx";

/** Mount in the review application's QueryClientProvider; scanning and saving are explicit actions. */
export function AccessibilityPanel() {
  const heading = useId();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<AccessibilityReport>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"scan" | "save" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function scan() {
    setBusy("scan");
    setError("");
    setMessage("");
    setSelected([]);
    setReport(undefined);
    try {
      setReport(
        await request<AccessibilityReport>(
          "/api/web/accessibility",
          "POST",
          {},
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const result = await request<AccessibilitySaveResult>(
        "/api/web/accessibility/notes",
        "POST",
        { ids: selected },
      );
      setReport(
        (current) =>
          current && {
            ...current,
            findings: current.findings.map((finding) => {
              const saved = result.saved.find(
                (item) => item.findingId === finding.id,
              );
              return saved
                ? { ...finding, savedNoteId: saved.noteId }
                : finding;
            }),
          },
      );
      setSelected([]);
      setMessage(
        `Saved ${result.saved.length} selected findings as review notes. Nothing was sent to an agent.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["review"] });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-labelledby={heading} className="space-y-3">
      <h2 id={heading} className="font-semibold">
        Accessibility scan
      </h2>
      <p className="text-sm text-muted-foreground">
        Run bundled axe-core on the connected local page. Results remain in
        memory until you select findings and save notes. Selected findings,
        target selectors and page URL are saved; active pre-capture privacy
        masks suppress page-derived details. No screenshots, automatic notes, or
        agent dispatch.
      </p>
      <Button onClick={() => void scan()} disabled={!!busy}>
        {busy === "scan" ? "Scanning…" : "Run accessibility scan"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {report && (
        <>
          <p className="text-sm">
            {report.engine.name} {report.engine.version} ·{" "}
            {new Date(report.at).toLocaleString()} · {report.url}
          </p>
          <p className="text-sm text-muted-foreground">{report.scope}</p>
          {report.omissionReason && (
            <p className="text-sm">{report.omissionReason}</p>
          )}
          <p role="status" className="text-sm">
            {report.findings.filter((f) => f.kind === "violation").length}{" "}
            violation targets ·{" "}
            {report.findings.filter((f) => f.kind === "incomplete").length}{" "}
            incomplete/manual-review targets.{" "}
            {report.findings.length === 0 &&
              "No findings from the automated checks run; manual review is still required."}
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {report.findings.map((finding) => (
              <article
                key={finding.id}
                className="rounded-md border border-border p-3 text-sm"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    disabled={!!busy || !!finding.savedNoteId}
                    checked={selected.includes(finding.id)}
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked
                          ? [...ids, finding.id]
                          : ids.filter((id) => id !== finding.id),
                      )
                    }
                  />
                  <span>
                    <strong>{finding.help}</strong> ·{" "}
                    {finding.kind === "incomplete"
                      ? "Incomplete — manual review, not a confirmed violation"
                      : "Violation"}{" "}
                    · {finding.impact ?? "impact not assigned"}
                    {finding.savedNoteId && " · Saved"}
                  </span>
                </label>
                <p>{finding.description}</p>
                <p className="whitespace-pre-wrap">{finding.summary}</p>
                {finding.targets.length > 0 && (
                  <pre className="overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(finding.targets, null, 2)}
                  </pre>
                )}
                <p className="text-muted-foreground">
                  Rule: {finding.rule} · {finding.tags.join(", ")}
                </p>
                <a
                  className="underline"
                  href={finding.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Rule documentation
                </a>
              </article>
            ))}
          </div>
          <Button
            disabled={!!busy || !selected.length}
            onClick={() => void save()}
          >
            {busy === "save"
              ? "Saving…"
              : `Save ${selected.length} selected findings as notes`}
          </Button>
        </>
      )}
    </section>
  );
}
