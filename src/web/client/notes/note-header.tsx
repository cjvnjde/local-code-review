import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import type { ReviewComment } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";

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
  const reference = note.id?.split("|#").at(-1);
  const label = note.web ? "Web note" : noteKey(note);
  return (
    <header className="flex min-h-14 items-center gap-2 border-b px-4 py-3">
      <span className="min-w-0 truncate text-xs font-medium" title={label}>
        {label}
      </span>
      {reference && (
        <div className="shrink-0">
          <Tooltip label="Copy note reference">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copy note reference"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`#${reference}`)
                  .catch(() => {})
              }
            >
              <Copy />
              <span className="max-w-24 truncate font-mono text-[10px]">
                #{reference.slice(-8)}
              </span>
            </Button>
          </Tooltip>
        </div>
      )}
      <div className="ml-auto" />
      {children}
      {status && (
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            ["applied", "answered"].includes(status)
              ? "border-success/25 bg-success/10 text-success"
              : status === "needs-input"
                ? "border-warning/25 bg-warning/10 text-warning"
                : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      )}
    </header>
  );
}
