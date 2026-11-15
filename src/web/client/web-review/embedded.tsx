import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  request,
  useAction,
  type DiffResponse,
  type ReviewResponse,
} from "../app/api.ts";
import { useStored } from "../app/preferences.ts";
import {
  Composer,
  DraftReviewNotice,
  draftBody,
  type Draft,
} from "../notes/composer.tsx";
import { NoteCard } from "../notes/note-card.tsx";
import { NoteState, useReviewState } from "../notes/review-state.tsx";
import { makeComment } from "../diff/model.ts";
import { webReview } from "../../../shared/web-review.ts";
import { commentInput } from "../notes/comment-input.ts";
import { triageOptions } from "../notes/note-header.tsx";

const query =
  typeof location === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(location.search);
const draftId = query.get("ui-draft"),
  noteId = query.get("ui-note");
export const embedToken =
  typeof window !== "undefined" && window.parent !== window
    ? draftId || noteId
    : "";

export function EmbeddedReview({
  diff,
  review,
}: {
  diff: DiffResponse;
  review?: ReviewResponse;
}) {
  const noteState = useReviewState(
    `${diff.repo}:${diff.id ? `#${diff.id}` : diff.range}`,
  );
  const [draft, setDraft, storageError] = useStored<Draft | null>(
    `lcr:v2:embed:${diff.repo}:${embedToken}`,
    null,
  );
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const headerAction = useAction();
  const client = useQueryClient();
  const origin = diff.web ? new URL(diff.web.url).origin : "";
  const evidence = useQuery({
    queryKey: ["web-draft", draftId],
    enabled: !!draftId,
    queryFn: () =>
      request<{ web: unknown }>(
        `/api/web/draft?id=${encodeURIComponent(draftId!)}`,
      ),
  });
  const latest = useRef(draft);
  const content = useRef<HTMLDivElement>(null);
  latest.current = draft;
  const headerBusy = useRef(false);
  headerBusy.current = busy || capturing || headerAction.isPending;
  const tell = (action: string, values: object = {}) => {
    if (origin)
      window.parent.postMessage(
        { type: "lcr:ui", token: embedToken, action, ...values },
        origin,
      );
  };
  useEffect(() => {
    if (evidence.data && review && !latest.current) {
      const web = webReview(evidence.data.web);
      if (web)
        setDraft({
          kind: "note",
          review: review.file,
          comment: { ...makeComment(), web },
        });
    }
  }, [evidence.data, review?.file]);
  useEffect(() => {
    const element = content.current;
    if (!element || !origin) return;
    const observer = new ResizeObserver(() =>
      tell("content-size", {
        height: Math.ceil(element.getBoundingClientRect().height),
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [origin]);
  useEffect(() => {
    const preview = () => {
      tell("image-preview", {
        open: !!document.querySelector("dialog.image-viewer[open]"),
      });
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== origin ||
        event.data?.type !== "lcr:ui" ||
        event.data.token !== embedToken
      )
        return;
      if (event.data.action === "capturing")
        setCapturing(event.data.busy === true);
      if (event.data.action === "triage") {
        const option = triageOptions.find(
          ({ value }) => value === event.data.triage,
        );
        if (!option || headerBusy.current) return;
        const triage = option.value || undefined;
        const current = latest.current;
        if (current?.kind === "note")
          setDraft({ ...current, comment: { ...current.comment, triage } });
        else if (!current) {
          const note = review?.notes.find((note) => note.id === noteId);
          if (note)
            headerAction.mutate({
              url: "/api/note",
              method: "POST",
              body: { comment: { ...commentInput(note), triage }, ask: false },
            });
        }
      }
      if (event.data.action === "evidence") {
        const web = webReview(event.data.web);
        if (noteId && event.data.reply && web) {
          const note = review?.notes.find((note) => note.id === noteId);
          setDraft((current) =>
            current?.kind === "reply"
              ? { ...current, web, webDraftId: event.data.draftId }
              : {
                  kind: "reply",
                  review: review?.file,
                  id: noteId,
                  body: "",
                  label: note?.key || "UI note",
                  file: note?.file || "",
                  code: note?.code,
                  web,
                  webDraftId: event.data.draftId,
                },
          );
        }
        if (draftId && web)
          setDraft((current) =>
            current?.kind === "note"
              ? { ...current, comment: { ...current.comment, web } }
              : {
                  kind: "note",
                  review: review?.file,
                  comment: { ...makeComment(), web },
                },
          );
        void client.invalidateQueries({ queryKey: ["review"] });
      }
    };
    window.addEventListener("message", receive);
    document.addEventListener("lcr:image-preview", preview);
    tell("ready");
    preview();
    return () => {
      window.removeEventListener("message", receive);
      document.removeEventListener("lcr:image-preview", preview);
    };
  }, [origin, client, review?.notes, review?.file, headerAction.mutate]);
  useEffect(() => {
    tell("dirty", {
      dirty: !!draft && !!draftBody(draft).trim(),
      saving: busy || capturing,
      editOriginal: draft?.kind === "note" && !!noteId,
    });
  }, [draft, busy, capturing]);
  const editedEvidence =
    draft?.kind === "note" ? draft.comment.web : draft?.web;
  const editingEvidence = !!draft && !draft.editing;
  useEffect(() => {
    if (editingEvidence)
      tell("evidence-changed", { web: editedEvidence ?? null });
  }, [editingEvidence, editedEvidence]);
  const close = () => {
    if (busy || capturing) return;
    setDraft(null);
    tell("dirty", { dirty: false, saving: false });
    tell("close");
  };
  const saved = () => {
    setDraft(null);
    tell("dirty", { dirty: false, saving: false });
    tell(noteId ? "reply-sent" : "close");
  };
  const note = review?.notes.find((n) => n.id === noteId);
  const triage = draft?.kind === "note" ? draft.comment.triage : note?.triage;
  const classify = draft ? draft.kind === "note" : !!note;
  useEffect(() => {
    tell("header", {
      triage: triage || "",
      options: classify ? triageOptions : [],
      disabled: busy || capturing || headerAction.isPending,
    });
  }, [origin, triage, classify, busy, capturing, headerAction.isPending]);
  return (
    <NoteState value={noteState}>
      <div
        ref={content}
        className="flex flex-col bg-background text-foreground"
      >
        {draft && (
          <DraftReviewNotice
            draft={draft}
            onChange={setDraft}
            busy={busy || capturing}
          />
        )}
        {headerAction.error && (
          <p role="alert" className="p-3 text-xs text-destructive">
            {headerAction.error.message}
          </p>
        )}
        {(evidence.error || storageError) && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {evidence.error?.message || storageError}
          </p>
        )}
        {capturing && (
          <p role="status" className="p-3 text-xs text-muted-foreground">
            Capturing selection…
          </p>
        )}
        {draft ? (
          <Composer
            draft={draft}
            draftStorageError={storageError}
            onChange={setDraft}
            onClose={close}
            onSaved={saved}
            agent={!!diff.agent}
            embedded
            onBusy={setBusy}
            webDraftId={draftId || undefined}
            onAddCapture={
              !capturing &&
              !draft.editing &&
              (draft.kind === "reply" || !noteId)
                ? () => tell("add-capture")
                : undefined
            }
            onWebDrawing={(open) =>
              tell("annotation", { open, ...(draftId ? { draftId } : {}) })
            }
          />
        ) : note ? (
          <div className="p-3">
            <NoteCard
              note={note}
              agent={!!diff.agent}
              onCompose={(next) => setDraft({ ...next, review: review?.file })}
              embedded
            />
          </div>
        ) : (
          <p className="p-5 text-sm text-muted-foreground">
            {draftId
              ? "Loading captured selection…"
              : "This note is no longer in the review."}
          </p>
        )}
      </div>
    </NoteState>
  );
}
