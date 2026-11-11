import {
  Copy,
  Pencil,
  Trash2,
  Reply,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { Markdown } from "../components/markdown.tsx";
import { Code } from "../components/code.tsx";
import { useAction } from "../app/api.ts";
import type { Draft } from "./composer.tsx";
import { WebEvidence, ConversationBody } from "../web-review/evidence.tsx";
import { placeNote } from "../diff/model.ts";

export function NoteCard({
  note,
  file,
  agent,
  onCompose,
  inline = false,
  onJump,
}: {
  note: ReviewNote;
  file?: DiffFile;
  agent: boolean;
  onCompose: (draft: Draft) => void;
  inline?: boolean;
  onJump?: () => void;
}) {
  const action = useAction();
  const editable =
    !note.messages.some((m) => m.role === "agent") &&
    !["applied", "answered", "skipped"].includes(note.status);
  const reference = note.id.split("|#").at(-1)!;
  const outdated = !note.scope && (!file || !placeNote(file, note));
  const icon = (label: string, element: React.ReactNode) => (
    <Tooltip label={label}>{element}</Tooltip>
  );
  return (
    <article
      className="rounded-xl border bg-card shadow-sm"
      data-note-id={note.id}
      id={`${inline ? "diff-note" : "note"}-${reference}`}
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={noteKey(note)}
        >
          {noteKey(note)}
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            ["applied", "answered"].includes(note.status)
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
              : note.status === "needs-input"
                ? "border-amber-500/25 bg-amber-500/10 text-amber-500"
                : "text-muted-foreground",
          )}
        >
          {note.status}
        </span>
      </header>
      <div className="space-y-3 p-4">
        {note.code && (
          <details className="rounded-md bg-muted/50 text-xs">
            <summary className="cursor-pointer px-3 py-2 text-muted-foreground">
              {outdated ? "Captured code · no longer in diff" : "Captured code"}
            </summary>
            <pre className="max-h-48 overflow-auto p-3">
              <Code value={note.code} language="diff" />
            </pre>
          </details>
        )}
        <WebEvidence value={note.web} />
        <Markdown body={note.body} file={note.file} captured={note.code} />
        {note.detail && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            {note.detail}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {onJump && (
            <Button size="sm" variant="ghost" onClick={onJump}>
              <ArrowRight />
              In diff
            </Button>
          )}
          {icon(
            "Copy note reference",
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
            </Button>,
          )}
          <div className="ml-auto" />
          {editable &&
            icon(
              "Edit note",
              <Button
                size="icon"
                variant="ghost"
                aria-label="Edit note"
                onClick={() =>
                  onCompose({ kind: "note", comment: { ...note } })
                }
              >
                <Pencil />
              </Button>,
            )}
          {icon(
            "Delete note",
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete note"
              disabled={action.isPending}
              onClick={() => {
                if (confirm("Delete this note and its conversation?"))
                  action.mutate({
                    url: `/api/note?${new URLSearchParams({ id: note.id })}`,
                    method: "DELETE",
                  });
              }}
            >
              <Trash2 />
            </Button>,
          )}
          {agent && (
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  url: "/api/note",
                  method: "POST",
                  body: { comment: note, retry: true },
                })
              }
            >
              <Sparkles />
              Ask AI
            </Button>
          )}
        </div>
      </div>
      {note.messages.map((message, i) => {
        const own =
          message.role === "reviewer" &&
          !!message.at &&
          !note.messages.slice(i + 1).some((m) => m.role === "agent");
        return (
          <section
            key={message.at || i}
            className="space-y-3 border-t bg-muted/15 p-4"
          >
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "font-medium",
                  message.role === "agent" && "text-primary",
                )}
              >
                {message.role === "agent" ? "Agent" : "You"}
              </span>
              <span className="text-muted-foreground">
                {message.at && new Date(message.at).toLocaleString()}
              </span>
              <div className="ml-auto" />
              {own && (
                <>
                  {icon(
                    "Edit reply",
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit reply"
                      onClick={() =>
                        onCompose({
                          kind: "reply",
                          id: note.id,
                          at: message.at,
                          body: message.body,
                          label: noteKey(note),
                          file: note.file,
                          code: note.code,
                        })
                      }
                    >
                      <Pencil />
                    </Button>,
                  )}
                  {icon(
                    "Delete reply",
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete reply"
                      disabled={action.isPending}
                      onClick={() => {
                        if (confirm("Delete this reply?"))
                          action.mutate({
                            url: `/api/reply?${new URLSearchParams({ id: note.id, at: message.at })}`,
                            method: "DELETE",
                          });
                      }}
                    >
                      <Trash2 />
                    </Button>,
                  )}
                </>
              )}
            </div>
            <ConversationBody
              body={message.body}
              file={note.file}
              captured={note.code}
            />
          </section>
        );
      })}
      <div className="border-t px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onCompose({
              kind: "reply",
              id: note.id,
              body: "",
              label: noteKey(note),
              file: note.file,
              code: note.code,
            })
          }
        >
          <Reply />
          Reply
        </Button>
      </div>
      {action.error && (
        <p className="p-4 text-sm text-destructive" role="alert">
          {action.error.message}
        </p>
      )}
    </article>
  );
}
