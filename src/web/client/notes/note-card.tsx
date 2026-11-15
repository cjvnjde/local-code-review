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
  Bot,
  UserRound,
} from "lucide-react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { ActionMenu, ActionMenuItem } from "../components/ui/action-menu.tsx";
import { Markdown } from "../components/markdown.tsx";
import { CapturedCode } from "./captured-code.tsx";
import { useAction } from "../app/api.ts";
import type { Draft } from "./composer.tsx";
import { WebEvidence, ConversationBody } from "../web-review/evidence.tsx";
import { placeNote } from "../diff/model.ts";
import {
  NoteAgentActivity,
  useNoteAgentActivity,
} from "../app/agent-activity.tsx";
import { useUi } from "../app/ui-preferences.tsx";
import { useNoteEntrance } from "./note-motion.tsx";
import { NoteHeader, TriageSelect } from "./note-header.tsx";
import { refOf, refToken } from "./note-ref.ts";
import { commentInput } from "./comment-input.ts";

export function NoteCard({
  note,
  file,
  agent,
  onCompose,
  inline = false,
  onJump,
  editor,
  editorDraft,
  onChangeDraft,
  embedded = false,
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
  onChangeDraft?: (draft: Draft) => void;
}) {
  const { settings } = useUi();
  const state = useNoteState();
  const entrance = useNoteEntrance(note.id);
  const action = useAction();
  const activity = useNoteAgentActivity(note.id);
  const unread = state.unread(note);
  const unreadBadge = useRef(unread);
  if (unread > 0) unreadBadge.current = unread;
  const asking =
    action.isPending &&
    action.variables?.url === "/api/note" &&
    action.variables?.method === "POST";
  const [removing, setRemoving] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
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
      className="size-7 rounded"
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
      locationAction={
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Copy note reference"
          title="Copy note reference"
          disabled={!refOf(note.id)}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(refToken(note));
              setCopyFailed(false);
            } catch {
              setCopyFailed(true);
            }
          }}
        >
          <Copy />
        </Button>
      }
      status={
        ["pending", "unknown"].includes(note.status) ? undefined : note.status
      }
    >
      {unreadBadge.current > 0 && (
        // Keep a small fixed slot so reading the note cannot move a targeted action.
        <span
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded border border-primary/40 text-[10px] font-medium text-primary",
            unread === 0 && "invisible",
          )}
          title={`${unreadBadge.current} new from agent`}
          aria-label={`${unreadBadge.current} new from agent`}
          aria-hidden={unread === 0}
        >
          {unreadBadge.current > 9 ? "9+" : unreadBadge.current}
        </span>
      )}
      {!embedded && (
        <TriageSelect
          value={
            editingNote && editorDraft?.kind === "note"
              ? editorDraft.comment.triage
              : note.triage
          }
          disabled={action.isPending}
          onChange={(triage) => {
            if (editingNote && editorDraft?.kind === "note")
              onChangeDraft?.({
                ...editorDraft,
                comment: { ...editorDraft.comment, triage },
              });
            else
              action.mutate({
                url: "/api/note",
                method: "POST",
                body: {
                  comment: { ...commentInput(note), triage },
                  ask: false,
                },
              });
          }}
        />
      )}
      {(state.resolved(note) || canResolve(note)) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={!!editor}
          title="Reviewer acknowledgement in this browser only; conversation changes reopen the note."
          onClick={() => state.toggle(note)}
        >
          {state.resolved(note) ? "Reopen" : "Resolve"}
        </Button>
      )}
      <ActionMenu trigger={menuTrigger("note", "Note actions")}>
        <ActionMenuItem
          disabled={action.isPending || !!editor}
          onClick={() => setRemoving("note")}
        >
          <Trash2 /> Delete note
        </ActionMenuItem>
      </ActionMenu>
    </NoteHeader>
  );
  return (
    <article
      ref={entrance}
      className="min-w-0 w-full rounded border bg-card [&_button]:rounded"
      data-note-id={note.id}
      data-note-surface
      onPointerEnter={() => state.read(note)}
      onFocus={() => state.read(note)}
      id={`${inline ? "diff-note" : "note"}-${reference}`}
    >
      {header}
      <div className="space-y-2 px-2.5 py-2">
        {note.code && <CapturedCode value={note.code} outdated={outdated} />}
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
        <section aria-label="Your note" className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <UserRound aria-hidden="true" className="size-3.5" />
            You
          </div>
          {editingNote ? (
            editor
          ) : (
            <Markdown body={note.body} file={note.file} captured={note.code} />
          )}
        </section>
        {note.detail && (
          <section
            aria-label="Agent summary"
            className="space-y-1 border-l-2 border-l-primary/40 pl-2"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Bot aria-hidden="true" className="size-3.5" />
              Agent summary
            </div>
            <p className="text-xs text-muted-foreground">{note.detail}</p>
          </section>
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
            aria-label={message.role === "agent" ? "Agent reply" : "Your reply"}
            className={cn(
              "space-y-1.5 border-t border-l-2 py-2 pl-2 pr-2.5",
              message.role === "agent"
                ? "border-l-primary/40"
                : "border-l-muted-foreground/30",
            )}
          >
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "flex items-center gap-1.5 font-medium",
                  message.role === "agent" && "text-primary",
                )}
              >
                {message.role === "agent" ? (
                  <Bot aria-hidden="true" className="size-3.5" />
                ) : (
                  <UserRound aria-hidden="true" className="size-3.5" />
                )}
                {message.role === "agent" ? "Agent" : "You"}
              </span>
              {message.at && (
                <time dateTime={message.at} className="text-muted-foreground">
                  {new Date(message.at).toLocaleString()}
                </time>
              )}
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
        <section
          aria-label="Your reply"
          className="space-y-1.5 border-t border-l-2 border-l-muted-foreground/30 py-2 pl-2 pr-2.5"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <UserRound aria-hidden="true" className="size-3.5" />
            You
          </div>
          {editor}
        </section>
      )}
      {!editingNote && (
        <footer className="flex flex-wrap items-center gap-1 border-t px-2 py-1 [&_button]:h-7">
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
                  body: {
                    comment: commentInput(note),
                    retry: true,
                    preserveTriage: true,
                  },
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
          {editable && !editor && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onCompose({ kind: "note", comment: commentInput(note) })
              }
            >
              <Pencil /> Edit note
            </Button>
          )}
        </footer>
      )}
      {copyFailed && (
        <p className="px-3 py-2 text-xs text-destructive" role="alert">
          Could not copy. Select and copy this reference:{" "}
          <code className="select-all break-all">{refToken(note)}</code>
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
