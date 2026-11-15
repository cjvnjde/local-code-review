import type { ReactNode } from "react";
import type {
  NoteTriage,
  ReviewComment,
} from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { cn } from "../components/ui/button.tsx";
import { Select } from "../components/ui/select.tsx";

export const triageOptions = [
  { value: "", label: "Unclassified" },
  { value: "blocker", label: "Blocker" },
  { value: "bug", label: "Bug" },
  { value: "suggestion", label: "Suggestion" },
  { value: "question", label: "Question" },
] as const;

export function TriageSelect({
  value,
  onChange,
  disabled,
}: {
  value?: NoteTriage;
  onChange: (value: NoteTriage | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      label="Note triage"
      className="h-8"
      value={value || ""}
      options={[...triageOptions]}
      disabled={disabled}
      onValueChange={(next) => onChange(next || undefined)}
    />
  );
}

/** Drafts and saved conversations keep the same identity row and spacing. */
export function NoteHeader({
  note,
  status,
  children,
}: {
  note: ReviewComment;
  status?: string;
  children?: ReactNode;
}) {
  const fullLocation = note.web
    ? `Web note · ${note.web.before.title || note.web.before.url}`
    : noteKey(note);
  const basename = note.file.split("/").at(-1) || note.file;
  const location = note.web
    ? "Web note"
    : note.scope === "global"
      ? "Overall note"
      : basename;
  const lines =
    note.web || note.scope === "global"
      ? ""
      : note.scope === "file"
        ? "whole file"
        : note.label ||
          (note.start === note.end
            ? `${note.start}`
            : `${note.start}–${note.end}`);
  const statusLabel =
    status === "needs-input"
      ? "Agent needs input"
      : status && ["applied", "answered", "skipped"].includes(status)
        ? `Agent ${status}`
        : status;
  return (
    <header className="space-y-1.5 border-b px-3 py-2">
      <div
        className="flex min-w-0 items-baseline gap-1 text-sm font-medium"
        title={fullLocation}
        aria-label={fullLocation}
      >
        <span className="min-w-0 truncate">{location}</span>
        {lines && (
          <span className="shrink-0 text-xs text-muted-foreground">
            · {lines}
          </span>
        )}
      </div>
      {(children || statusLabel || note.triage) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {children}
          {note.triage && (
            <span
              className="rounded border px-1.5 py-0.5 font-medium"
              aria-label={`Triage: ${note.triage}`}
            >
              {note.triage}
            </span>
          )}
          {statusLabel && (
            <span
              className={cn(
                "text-xs",
                status && ["applied", "answered"].includes(status)
                  ? "text-success"
                  : status === "needs-input"
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              {statusLabel}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
