import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, type DiffResponse, type ReviewResponse } from "../app/api.ts";
import { useStored } from "../app/preferences.ts";
import { Composer, draftBody, type Draft } from "../notes/composer.tsx";
import { NoteCard } from "../notes/note-card.tsx";
import { makeComment } from "../diff/model.ts";
import { webReview } from "../../../shared/web-review.ts";
import { Button } from "../components/ui/button.tsx";

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
  const [draft, setDraft, storageError] = useStored<Draft | null>(
    `lcr:v2:embed:${diff.repo}:${embedToken}`,
    null,
  );
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
  latest.current = draft;
  const tell = (action: string, values: object = {}) => {
    if (origin)
      window.parent.postMessage(
        { type: "lcr:ui", token: embedToken, action, ...values },
        origin,
      );
  };
  useEffect(() => {
    if (evidence.data && !latest.current) {
      const web = webReview(evidence.data.web);
      if (web) setDraft({ kind: "note", comment: { ...makeComment(), web } });
    }
  }, [evidence.data]);
  useEffect(() => {
    document.documentElement.classList.add("dark");
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
      if (event.data.action === "evidence") {
        const web = webReview(event.data.web);
        if (draftId && web)
          setDraft((current) =>
            current?.kind === "note"
              ? { ...current, comment: { ...current.comment, web } }
              : { kind: "note", comment: { ...makeComment(), web } },
          );
        void client.invalidateQueries({ queryKey: ["review"] });
      }
    };
    window.addEventListener("message", receive);
    tell("ready");
    return () => window.removeEventListener("message", receive);
  }, [origin, client]);
  useEffect(() => {
    tell("dirty", {
      dirty: !!draft && !!draftBody(draft).trim(),
      saving: busy || capturing,
      editOriginal: draft?.kind === "note" && !!noteId,
    });
  }, [draft, busy, capturing]);
  const close = () => {
    if (
      busy ||
      capturing ||
      (draft && draftBody(draft).trim() && !confirm("Discard this draft?"))
    )
      return;
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
  return (
    <div className="min-h-dvh bg-background text-foreground">
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
          onChange={setDraft}
          onClose={close}
          onSaved={saved}
          agent={!!diff.agent}
          embedded
          onBusy={setBusy}
        />
      ) : note ? (
        <div className="p-3">
          <NoteCard note={note} agent={!!diff.agent} onCompose={setDraft} />
        </div>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">
          {draftId
            ? "Loading captured selection…"
            : "This note is no longer in the review."}
        </p>
      )}
      <div className="flex justify-end border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => tell("review", noteId ? { id: noteId } : {})}
        >
          Open full review
        </Button>
      </div>
    </div>
  );
}
