import { webReview } from "../../../shared/web-review.ts";
import { useEffect, useRef, useState } from "react";
import { useNoteState, canResolve } from "./review-state.tsx";
import { AttachmentImage } from "../components/images.tsx";
import {
  Pencil,
  Trash2,
  Reply,
  Sparkles,
  ArrowRight,
  LoaderCircle,
  Copy,
  MoreHorizontal,
} from "lucide-react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { ActionMenu, ActionMenuItem } from "../components/ui/action-menu.tsx";
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
import { useNoteEntrance } from "./note-motion.tsx";
import { NoteHeader } from "./note-header.tsx";
import { refOf, refToken } from "./note-ref.ts";

export function NoteCard({
  note,
  file,
  agent,
  onCompose,
  inline = false,
  onJump,
  editor,
  editorDraft,
  onAddCapture,
}: {
  note: ReviewNote;
  file?: DiffFile;
  agent: boolean;
  onCompose: (draft: Draft) => void;
  inline?: boolean;
  onJump?: () => void;
  editor?: React.ReactNode;
  editorDraft?: Draft;
  embedded?: boolean;
  onAddCapture?: () => void;
}) {
  const { settings } = useUi();
  const state = useNoteState();
  const entrance = useNoteEntrance(note.id);
  const webEnabled = !!useDiff().data?.web;
  const action = useAction();
  const activity = useNoteAgentActivity(note.id);
  const asking =
    action.isPending &&
    action.variables?.url === "/api/note" &&
    action.variables?.method === "POST";
  const [removing, setRemoving] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(
    null,
  );
  const confirmation = useRef<HTMLButtonElement>(null);
  const menuTriggers = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!removing) return;
    const frame = requestAnimationFrame(() => confirmation.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [removing]);
  const cancelRemoval = () => {
    if (removing) menuTriggers.current.get(removing)?.focus();
    setRemoving(null);
  };
  const menuTrigger = (key: string, label: string) => (
    <Button
      ref={(element) => {
        if (element) menuTriggers.current.set(key, element);
        else menuTriggers.current.delete(key);
      }}
      size="icon"
      variant="ghost"
      aria-label={label}
    >
      <MoreHorizontal />
    </Button>
  );
  const editable =
    !note.messages.some((m) => m.role === "agent") &&
    !["applied", "answered", "skipped"].includes(note.status);
  const reference = note.id.split("|#").at(-1)!;
  const outdated = !note.scope && (!file || !placeNote(file, note));
  const editingNote = !!editor && editorDraft?.kind === "note";
  const editingReply =
    editor && editorDraft?.kind === "reply" ? editorDraft.at : undefined;
  const header = (
    <NoteHeader
      note={note}
      status={
        ["pending", "unknown"].includes(note.status) ? undefined : note.status
      }
    >
      <span
        className={
          state.resolved(note) ? "text-success" : "text-muted-foreground"
        }
        title="Reviewer acknowledgement saved only in this browser. Conversation changes reopen this note."
      >
        {state.resolved(note) ? "Resolved" : "Open"} · this browser
      </span>
      {state.unread(note) > 0 && (
        <span className="text-xs font-medium text-primary">
          {state.unread(note)} new from agent
        </span>
      )}
    </NoteHeader>
  );
  return (
    <article
      ref={entrance}
      className="min-w-0 w-full rounded-lg border bg-card"
      data-note-id={note.id}
      data-note-surface
      onPointerEnter={() => state.read(note)}
      onFocus={() => state.read(note)}
      id={`${inline ? "diff-note" : "note"}-${reference}`}
    >
      {header}
      <div className="space-y-3 p-3">
        {note.code &&
          (inline ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Captured code{outdated ? " · no longer in diff" : ""}
              </summary>
              <pre
                aria-label="Captured code"
                className="mt-2 max-h-48 overflow-auto bg-muted/30 py-2 text-xs"
              >
                <Code value={note.code} language="diff" />
              </pre>
            </details>
          ) : (
            <div>
              {outdated && (
                <p className="mb-1 text-xs text-muted-foreground">
                  Captured code · no longer in diff
                </p>
              )}
              <pre
                aria-label="Captured code"
                className="max-h-48 overflow-auto bg-muted/30 py-2 text-xs"
              >
                <Code value={note.code} language="diff" />
              </pre>
            </div>
          ))}
        {webEnabled && note.web && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() =>
                onAddCapture
                  ? onAddCapture()
                  : action.mutate({
                      url: "/api/web/focus",
                      method: "POST",
                      body: { id: note.id },
                    })
              }
            >
              {onAddCapture ? "Add capture" : "Select on page"}
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
          saved
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
          <div className="text-xs">
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
        {agent &&
          !(
            settings.aiAnswers &&
            !editingNote &&
            !asking &&
            activity?.blocksAsk &&
            ["queued", "paused"].includes(activity.state)
          ) && <NoteAgentActivity activity={activity} />}
      </div>
      {note.messages.map((message, i) => {
        const own =
          message.role === "reviewer" &&
          !!message.at &&
          !note.messages.slice(i + 1).some((m) => m.role === "agent");
        return (
          <section
            key={message.at || i}
            data-note-message={i}
            className="space-y-2 border-t bg-muted/15 p-3"
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
                <ActionMenu trigger={menuTrigger(message.at!, "Reply actions")}>
                  <ActionMenuItem
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
                    <Pencil /> Edit reply
                  </ActionMenuItem>
                  <ActionMenuItem
                    disabled={action.isPending}
                    onClick={() => setRemoving(message.at!)}
                  >
                    <Trash2 /> Delete reply
                  </ActionMenuItem>
                </ActionMenu>
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
      {editor && !editingNote && !editingReply && (
        <div className="border-t p-3">{editor}</div>
      )}
      {!editingNote && (
        <footer className="flex flex-wrap items-center gap-1 border-t px-3 py-1.5">
          {!editor && (
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
          )}
          {onJump && (
            <Button size="sm" variant="ghost" onClick={onJump}>
              <ArrowRight />
              In diff
            </Button>
          )}
          <div className="ml-auto" />
          {(state.resolved(note) || canResolve(note)) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!!editor}
              title="Reviewer acknowledgement in this browser only; conversation changes reopen the note."
              onClick={() => state.toggle(note)}
            >
              {state.resolved(note) ? "Reopen" : "Resolve"}
            </Button>
          )}
          <ActionMenu trigger={menuTrigger("note", "Note actions")}>
            <ActionMenuItem
              disabled={!refOf(note.id)}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(refToken(note));
                  setCopyResult("copied");
                } catch {
                  setCopyResult("failed");
                }
              }}
            >
              <Copy /> Copy note reference
            </ActionMenuItem>
            {editable && !editor && (
              <ActionMenuItem
                onClick={() =>
                  onCompose({ kind: "note", comment: { ...note } })
                }
              >
                <Pencil /> Edit note
              </ActionMenuItem>
            )}
            <ActionMenuItem
              disabled={action.isPending || !!editor}
              onClick={() => setRemoving("note")}
            >
              <Trash2 /> Delete note
            </ActionMenuItem>
          </ActionMenu>
          {agent && settings.aiAnswers && (
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending || !!activity?.blocksAsk}
              aria-label="Ask AI"
              title={activity?.detail}
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
        </footer>
      )}
      {copyResult && (
        <p
          className={cn(
            "px-3 py-2 text-xs",
            copyResult === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          role={copyResult === "failed" ? "alert" : "status"}
        >
          {copyResult === "copied" ? (
            "Note reference copied."
          ) : (
            <>
              Could not copy. Select and copy this reference:{" "}
              <code className="select-all break-all">{refToken(note)}</code>
            </>
          )}
        </p>
      )}
      {removing && (
        <div
          role="group"
          aria-label="Confirm deletion"
          className="flex flex-wrap items-center gap-2 border-t p-3 text-xs"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelRemoval();
            }
          }}
        >
          <span className="flex-1">
            Delete{" "}
            {removing === "note"
              ? "this note and its conversation"
              : "this reply"}
            ?
          </span>
          <Button
            ref={confirmation}
            size="sm"
            variant="ghost"
            onClick={cancelRemoval}
          >
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
                {
                  onSuccess: () => {
                    if (removing !== "note")
                      menuTriggers.current.get("note")?.focus();
                    setRemoving(null);
                  },
                },
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
