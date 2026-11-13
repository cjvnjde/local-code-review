import { webReview } from "../../../shared/web-review.ts";
import { useState } from "react";
import { useNoteState, canResolve } from "./review-state.tsx";
import { AttachmentImage } from "../components/images.tsx";
import {
  Copy,
  Pencil,
  Trash2,
  Reply,
  Sparkles,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { Markdown } from "../components/markdown.tsx";
import { Code } from "../components/code.tsx";
import { useAction, useDiff } from "../app/api.ts";
import type { Draft } from "./composer.tsx";
import { WebEvidence, ConversationBody } from "../web-review/evidence.tsx";
import { placeNote } from "../diff/model.ts";
import {
  NoteAgentActivity,
  useNoteAgentActivity,
} from "../app/agent-activity.tsx";
import { useUi } from "../app/ui-preferences.tsx";

export function NoteCard({
  note,
  file,
  agent,
  onCompose,
  inline = false,
  onJump,
  editor,
  editorDraft,
}: {
  note: ReviewNote;
  file?: DiffFile;
  agent: boolean;
  onCompose: (draft: Draft) => void;
  inline?: boolean;
  onJump?: () => void;
  editor?: React.ReactNode;
  editorDraft?: Draft;
}) {
  const { settings } = useUi();
  const state = useNoteState();
  const webEnabled = !!useDiff().data?.web;
  const action = useAction();
  const activity = useNoteAgentActivity(note.id);
  const asking =
    action.isPending &&
    action.variables?.url === "/api/note" &&
    action.variables?.method === "POST";
  const [removing, setRemoving] = useState<string | null>(null);
  const editable =
    !note.messages.some((m) => m.role === "agent") &&
    !["applied", "answered", "skipped"].includes(note.status);
  const reference = note.id.split("|#").at(-1)!;
  const outdated = !note.scope && (!file || !placeNote(file, note));
  const editingNote = !!editor && editorDraft?.kind === "note";
  const editingReply =
    editor && editorDraft?.kind === "reply" ? editorDraft.at : undefined;
  const icon = (label: string, element: React.ReactElement) => (
    <Tooltip label={label}>{element}</Tooltip>
  );
  return (
    <article
      className="rounded-xl border bg-card shadow-sm"
      data-note-id={note.id}
      onPointerEnter={() => state.read(note)}
      onFocus={() => state.read(note)}
      id={`${inline ? "diff-note" : "note"}-${reference}`}
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={noteKey(note)}
        >
          {noteKey(note)}
        </span>
        {state.unread(note) > 0 && (
          <span className="rounded bg-primary/15 px-2 py-1 text-[10px] text-primary">
            {state.unread(note)} new
          </span>
        )}
        {state.resolved(note) && (
          <span className="text-[10px] text-emerald-500">Resolved</span>
        )}
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
          <>
            {outdated && (
              <p className="text-xs text-muted-foreground">
                Captured code · no longer in diff
              </p>
            )}
            <pre
              aria-label="Captured code"
              className="max-h-48 overflow-auto border-y bg-muted/30 py-3 text-xs"
            >
              <Code value={note.code} language="diff" />
            </pre>
          </>
        )}
        {webEnabled && note.web && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  url: "/api/web/focus",
                  method: "POST",
                  body: { id: note.id },
                })
              }
            >
              Select more / reply on page
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={async () => {
                const result = (await action
                  .mutateAsync({
                    url: "/api/web/capture",
                    method: "POST",
                    body: { id: note.id },
                  })
                  .catch(() => null)) as {
                  web?: unknown;
                  draftId?: string;
                } | null;
                const web = webReview(result?.web);
                if (web)
                  onCompose({
                    kind: "reply",
                    id: note.id,
                    body: "",
                    label: noteKey(note),
                    file: note.file,
                    code: note.code,
                    web,
                    webDraftId: result?.draftId,
                  });
              }}
            >
              Capture after
            </Button>
          </div>
        )}
        <WebEvidence
          value={note.web}
          editable={editable && !editingNote}
          messages={note.messages}
          onAnnotate={async (target, annotation) => {
            await action.mutateAsync({
              url: "/api/web/annotation",
              method: "POST",
              body: { id: note.id, target, annotation },
            });
          }}
          onRemove={async (index, key) => {
            await action.mutateAsync({
              url: "/api/web/selection",
              method: "POST",
              body: { id: note.id, index, key },
            });
          }}
        />
        {note.image && (
          <div className="rounded-lg border p-3 text-xs">
            <p className="mb-2">
              Screenshot region ·{" "}
              {note.image.side === "old" ? "before" : "after"} ·{" "}
              {note.image.width}×{note.image.height}
              {file && note.image.source !== file.hash
                ? " · image has changed"
                : ""}
            </p>
            <AttachmentImage
              source={note.image.capture}
              label="Selected screenshot region"
            />
          </div>
        )}
        {editingNote ? (
          editor
        ) : (
          <Markdown body={note.body} file={note.file} captured={note.code} />
        )}
        {note.detail && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            {note.detail}
          </p>
        )}
        {agent && <NoteAgentActivity activity={activity} />}
        {!editingNote && (
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
            {(state.resolved(note) || canResolve(note)) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!!editor}
                onClick={() => state.toggle(note)}
              >
                {state.resolved(note) ? "Reopen" : "Resolve"}
              </Button>
            )}
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
                onClick={() => setRemoving("note")}
              >
                <Trash2 />
              </Button>,
            )}
            {agent && settings.aiAnswers && (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending || !!activity?.blocksAsk}
                aria-label="Ask AI"
                onClick={() =>
                  action.mutate({
                    url: "/api/note",
                    method: "POST",
                    body: { comment: note, retry: true },
                  })
                }
              >
                {asking ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {asking
                  ? "Sending…"
                  : activity?.blocksAsk
                    ? activity.label
                    : "Ask AI"}
              </Button>
            )}
          </div>
        )}
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
              {own && editingReply !== message.at && (
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
                      onClick={() => setRemoving(message.at!)}
                    >
                      <Trash2 />
                    </Button>,
                  )}
                </>
              )}
            </div>
            {editingReply && editingReply === message.at ? (
              editor
            ) : (
              <ConversationBody
                body={message.body}
                file={note.file}
                captured={note.code}
              />
            )}
          </section>
        );
      })}
      {editor ? (
        !editingNote &&
        !editingReply && <div className="border-t p-4">{editor}</div>
      ) : (
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
      )}
      {removing && (
        <div className="flex items-center gap-3 border-t p-3 text-xs">
          <span className="flex-1">
            Delete{" "}
            {removing === "note"
              ? "this note and its conversation"
              : "this reply"}
            ?
          </span>
          <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
            Keep
          </Button>
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                {
                  url:
                    removing === "note"
                      ? `/api/note?${new URLSearchParams({ id: note.id })}`
                      : `/api/reply?${new URLSearchParams({ id: note.id, at: removing })}`,
                  method: "DELETE",
                },
                { onSuccess: () => setRemoving(null) },
              )
            }
          >
            Delete
          </Button>
        </div>
      )}
      {action.error && (
        <p className="p-4 text-sm text-destructive" role="alert">
          {action.error.message}
        </p>
      )}
    </article>
  );
}
