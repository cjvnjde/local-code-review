import { useRef, useState } from "react";
import { ImagePlus, Code2, Eye, Pencil, LoaderCircle } from "lucide-react";
import type { ReviewComment } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { useAction } from "../app/api.ts";
import { Button } from "../components/ui/button.tsx";
import { Dialog, DialogContent } from "../components/ui/dialog.tsx";
import { Markdown } from "../components/markdown.tsx";
import { Code } from "../components/code.tsx";
import { suggestionBlock } from "../diff/model.ts";
import { WebEvidence } from "../web-review/evidence.tsx";

export type Draft =
  | { kind: "note"; comment: ReviewComment }
  | {
      kind: "reply";
      id: string;
      at?: string;
      body: string;
      label: string;
      file: string;
      code?: string;
    };
export const draftBody = (draft: Draft) =>
  draft.kind === "note" ? draft.comment.body : draft.body;
export const withBody = (draft: Draft, body: string): Draft =>
  draft.kind === "note"
    ? { ...draft, comment: { ...draft.comment, body } }
    : { ...draft, body };

export function Composer({
  draft,
  onChange,
  onClose,
  agent,
  embedded = false,
  onSaved,
  onBusy,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  agent: boolean;
  embedded?: boolean;
  onSaved?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const action = useAction();
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const body = draftBody(draft);
  const code = draft.kind === "note" ? draft.comment.code : draft.code;
  const file = draft.kind === "note" ? draft.comment.file : draft.file;
  const title =
    draft.kind === "note" ? noteKey(draft.comment) : `Reply · ${draft.label}`;
  const busy = action.isPending || uploading;
  // Upload completion reads the current draft, so text typed during an upload is kept.
  const latest = useRef(draft);
  latest.current = draft;
  function insert(text: string) {
    const current = latest.current,
      value = draftBody(current);
    const at = textarea.current?.selectionStart ?? value.length;
    const next = value.slice(0, at) + text + value.slice(at);
    onChange(withBody(current, next));
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(at + text.length, at + text.length);
    });
  }
  async function attach(files: File[]) {
    if (busy || !files.length) return;
    setUploading(true);
    onBusy?.(true);
    setUploadError("");
    try {
      for (const file of files.filter((f) => f.type.startsWith("image/"))) {
        const response = await fetch("/api/attach", {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Image upload failed.");
        insert(
          `\n![${file.name.replace(/[\[\]\\\r\n]/g, " ")}](${result.ref})\n`,
        );
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      onBusy?.(false);
    }
  }
  async function save(ask = agent) {
    if (!body.trim() || busy) return;
    onBusy?.(true);
    try {
      if (draft.kind === "note")
        await action.mutateAsync({
          url: "/api/note",
          method: "POST",
          body: { comment: draft.comment, ask },
        });
      else
        await action.mutateAsync({
          url: "/api/reply",
          method: draft.at ? "PUT" : "POST",
          body: { id: draft.id, at: draft.at, body, ask },
        });
      if (onSaved) onSaved();
      else onClose();
    } catch {
      /* Keep the editor and error visible for retry. */
    } finally {
      onBusy?.(false);
    }
  }
  const content = (
    <div
      className="flex min-h-0 flex-col gap-3"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void attach([...event.dataTransfer.files]);
        }
      }}
    >
      {code && (
        <details className="rounded-lg border bg-muted/30 text-xs">
          <summary className="cursor-pointer px-3 py-2 text-muted-foreground">
            Captured code · {file}
          </summary>
          <pre className="max-h-40 overflow-auto p-3">
            <Code value={code} language="diff" />
          </pre>
        </details>
      )}
      {draft.kind === "note" && draft.comment.web && (
        <div className="max-h-56 overflow-auto">
          <WebEvidence value={draft.comment.web} />
        </div>
      )}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)}>
          {preview ? <Pencil /> : <Eye />}
          {preview ? "Write" : "Preview"}
        </Button>
        {code && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreview(false);
              insert(`\n\n${suggestionBlock(code)}\n`);
            }}
          >
            <Code2 />
            Suggest change
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          <ImagePlus />
          Image
        </Button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void attach([...(e.target.files || [])]);
            e.target.value = "";
          }}
        />
      </div>
      {preview ? (
        <div className="max-h-80 min-h-40 overflow-auto rounded-lg border p-4">
          <Markdown
            body={body || "Nothing to preview yet."}
            file={file}
            captured={code}
          />
        </div>
      ) : (
        <textarea
          ref={textarea}
          aria-label="Note text"
          autoFocus
          value={body}
          onChange={(e) => onChange(withBody(draft, e.target.value))}
          onPaste={(event) => {
            const images = [...event.clipboardData.files].filter((f) =>
              f.type.startsWith("image/"),
            );
            if (images.length) {
              event.preventDefault();
              void attach(images);
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder="Write feedback, ask a question, or propose a change…"
          className="min-h-44 w-full resize-y rounded-lg border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
        />
      )}
      {(action.error || uploadError) && (
        <p role="alert" className="text-sm text-destructive">
          {action.error?.message || uploadError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="mr-auto text-xs text-muted-foreground">
          Markdown supported · ⌘/Ctrl Enter to save
        </span>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {agent && (
          <Button
            variant="outline"
            disabled={busy || !body.trim()}
            onClick={() => void save(false)}
          >
            Save only
          </Button>
        )}
        <Button disabled={busy || !body.trim()} onClick={() => void save()}>
          {busy && <LoaderCircle className="animate-spin" />}
          {agent
            ? "Save & ask AI"
            : draft.kind === "reply"
              ? "Send reply"
              : "Save note"}
        </Button>
      </div>
    </div>
  );
  if (embedded)
    return (
      <section className="p-4">
        <h1 className="mb-4 truncate text-sm font-medium">{title}</h1>
        {content}
      </section>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        title={title}
        description="Saved with the conversation in your Markdown review file."
        onInteractOutside={(event) => event.preventDefault()}
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}
