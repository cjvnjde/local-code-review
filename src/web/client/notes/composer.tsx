import {
  dropWebSelection,
  webReview,
  webReviewLines,
  type WebReview,
} from "../../../shared/web-review.ts";
import { ColorTools } from "../components/colors.tsx";
import { AttachmentImage } from "../components/images.tsx";
import { AddContext } from "../components/context.tsx";
import { useReferences } from "./references.tsx";
import { refOf } from "./note-ref.ts";
import { useUi } from "../app/ui-preferences.tsx";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Code as CodeIcon,
  SquareCode,
  Quote,
  List,
  ListTodo,
  Link,
  ImagePlus,
  Code2,
  Eye,
  Pencil,
  LoaderCircle,
} from "lucide-react";
import type { ReviewComment } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { request, useAction } from "../app/api.ts";
import { Button } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { ComposerImages } from "../components/images.tsx";
import { Markdown } from "../components/markdown.tsx";
import { Code } from "../components/code.tsx";
import { suggestionBlock } from "../diff/model.ts";
import { WebEvidence } from "../web-review/evidence.tsx";

export type Draft = {
  host?: "diff" | "panel";
  original?: string;
  editing?: boolean;
} & (
  | { kind: "note"; comment: ReviewComment }
  | {
      kind: "reply";
      id: string;
      at?: string;
      body: string;
      label: string;
      file: string;
      code?: string;
      web?: WebReview;
      webDraftId?: string;
    }
);
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
  webDraftId,
  onWebDrawing,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  agent: boolean;
  embedded?: boolean;
  onSaved?: () => void;
  onBusy?: (busy: boolean) => void;
  webDraftId?: string;
  onWebDrawing?: (open: boolean) => void;
}) {
  const action = useAction();
  const { settings } = useUi();
  const { notes: referenceNotes } = useReferences();
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const body = draftBody(draft);
  const web = draft.kind === "note" ? draft.comment.web : draft.web;
  const captureDraft =
    webDraftId || (draft.kind === "reply" ? draft.webDraftId : undefined);
  const hasContent = !!body.trim() || !!web;
  function changeWeb(web: WebReview | null) {
    const current = latest.current;
    onChange(
      current.kind === "note"
        ? { ...current, comment: { ...current.comment, web: web || undefined } }
        : { ...current, web: web || undefined },
    );
  }
  const code = draft.kind === "note" ? draft.comment.code : draft.code;
  const file = draft.kind === "note" ? draft.comment.file : draft.file;
  const title =
    draft.kind === "note" ? noteKey(draft.comment) : `Reply · ${draft.label}`;
  const busy = action.isPending || uploading || drawing;
  const subject =
    draft.kind === "note"
      ? draft.comment.id || "new"
      : `${draft.id}:${draft.at || "reply"}`;
  const caret = useRef({ start: 0, end: 0 });
  useLayoutEffect(() => {
    const field = textarea.current;
    if (field) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(caret.current.start, caret.current.end);
    }
  }, [subject, preview]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(embedded ? 200 : 480, Math.max(112, field.scrollHeight))}px`;
    }
  }, [body, preview, embedded]);
  // Upload completion reads the current draft, so text typed during an upload is kept.
  const latest = useRef(draft);
  latest.current = draft;
  function insert(text: string) {
    const current = latest.current,
      value = draftBody(current);
    const at = textarea.current?.selectionStart ?? value.length;
    const end = textarea.current?.selectionEnd ?? at;
    const next = value.slice(0, at) + text + value.slice(end);
    onChange(withBody(current, next));
    requestAnimationFrame(() => {
      textarea.current?.focus({ preventScroll: true });
      textarea.current?.setSelectionRange(at + text.length, at + text.length);
    });
  }
  function wrap(before: string, after = before) {
    const field = textarea.current;
    if (!field) return;
    const from = field.selectionStart,
      to = field.selectionEnd,
      value = draftBody(latest.current);
    onChange(
      withBody(
        latest.current,
        value.slice(0, from) +
          before +
          value.slice(from, to) +
          after +
          value.slice(to),
      ),
    );
    requestAnimationFrame(() => {
      field.focus({ preventScroll: true });
      field.setSelectionRange(from + before.length, to + before.length);
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
    if (!hasContent || busy) return;
    onBusy?.(true);
    try {
      if (draft.kind === "note")
        await action.mutateAsync({
          url: "/api/note",
          method: "POST",
          body: { comment: draft.comment, ask, replace: settings.single },
        });
      else
        await action.mutateAsync({
          url: "/api/reply",
          method: draft.at ? "PUT" : "POST",
          body: {
            id: draft.id,
            at: draft.at,
            body: draft.web
              ? `${body.trim()}\n\n${webReviewLines(draft.web).join("\n")}`.trim()
              : body,
            ask,
          },
        });
      if (draft.kind === "reply" && captureDraft)
        void request("/api/web/draft", "DELETE", {
          draftId: captureDraft,
        }).catch(() => {});
      if (onSaved) onSaved();
      else onClose();
    } catch {
      /* Keep the editor and error visible for retry. */
    } finally {
      onBusy?.(false);
    }
  }
  const attachments = (
    <>
      <ColorTools
        body={body}
        onChange={(body) => onChange(withBody(latest.current, body))}
      />
      <AddContext
        onInsert={insert}
        onBusy={(value) => {
          setUploading(value);
          onBusy?.(value);
        }}
      />
      <ComposerImages
        body={body}
        subject={subject}
        onBusy={(value) => {
          setDrawing(value);
          onBusy?.(value);
          onWebDrawing?.(value);
        }}
        onReplace={(from, to, expected, ref) => {
          const current = latest.current,
            text = draftBody(current);
          if (text.slice(from, to) !== expected)
            throw new Error(
              "This image link changed while the drawing was open. Reopen it to edit the current image.",
            );
          onChange(
            withBody(current, text.slice(0, from) + ref + text.slice(to)),
          );
        }}
      />
    </>
  );
  const content = (
    <div
      className={`flex min-h-0 flex-col gap-3 ${embedded ? "flex-1" : ""}`}
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
      <div
        role={embedded ? "region" : undefined}
        aria-label={embedded ? "Evidence and attachments" : undefined}
        className={
          embedded ? "min-h-0 flex-1 space-y-3 overflow-auto px-4" : "contents"
        }
      >
        {draft.kind === "note" && draft.comment.image && (
          <AttachmentImage
            source={draft.comment.image.capture}
            label="Selected screenshot region"
          />
        )}
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
        {web && (
          <div className={embedded ? "" : "max-h-56 overflow-auto"}>
            <WebEvidence
              value={web}
              editable={!draft.editing}
              onDrawing={(value) => {
                setDrawing(value);
                onBusy?.(value);
                onWebDrawing?.(value);
              }}
              onAnnotate={
                captureDraft
                  ? async (target, annotation) => {
                      const result = await request<{ web: unknown }>(
                        "/api/web/annotation",
                        "POST",
                        { draftId: captureDraft, target, annotation },
                      );
                      changeWeb(webReview(result.web));
                    }
                  : undefined
              }
              onRemove={async (index, key) => {
                const current = latest.current;
                const evidence =
                  current.kind === "note" ? current.comment.web : current.web;
                if (!evidence) return;
                changeWeb(
                  captureDraft
                    ? webReview(
                        (
                          await request<{ web: unknown }>(
                            "/api/web/selection",
                            "POST",
                            { draftId: captureDraft, index, key },
                          )
                        ).web,
                      )
                    : dropWebSelection(evidence, index, key),
                );
              }}
              onChange={changeWeb}
            />
          </div>
        )}
        {embedded && attachments}
      </div>
      <div
        className={
          embedded
            ? "shrink-0 space-y-3 border-t bg-background p-4"
            : "space-y-3"
        }
      >
        <div
          role="toolbar"
          aria-label="Text formatting"
          className="flex flex-wrap items-center gap-0.5"
        >
          {[
            { label: "Bold", Icon: Bold, before: "**", after: "**" },
            { label: "Italic", Icon: Italic, before: "_", after: "_" },
            { label: "Inline code", Icon: CodeIcon, before: "`", after: "`" },
            {
              label: "Code block",
              Icon: SquareCode,
              before: "\n```\n",
              after: "\n```\n",
            },
            { label: "Quote", Icon: Quote, before: "\n> ", after: "" },
            { label: "List", Icon: List, before: "\n- ", after: "" },
            {
              label: "Checklist",
              Icon: ListTodo,
              before: "\n- [ ] ",
              after: "",
            },
            { label: "Link", Icon: Link, before: "[", after: "](https://)" },
          ].map(({ label, Icon, before, after }) => (
            <Tooltip key={label} label={label}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={label}
                disabled={preview}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => wrap(before, after)}
              >
                <Icon />
              </Button>
            </Tooltip>
          ))}
          <Tooltip label={preview ? "Write" : "Preview"}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={preview ? "Write" : "Preview"}
              aria-pressed={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? <Pencil /> : <Eye />}
            </Button>
          </Tooltip>
          {code && (
            <Tooltip label="Suggest change">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Suggest change"
                onClick={() => {
                  setPreview(false);
                  insert(`\n\n${suggestionBlock(code)}\n`);
                }}
              >
                <Code2 />
              </Button>
            </Tooltip>
          )}
          <Tooltip label="Attach image">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Attach image"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              <ImagePlus />
            </Button>
          </Tooltip>
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
          <select
            aria-label="Insert note reference"
            className="h-8 min-w-0 max-w-full flex-1 basis-36 rounded border bg-background px-2 text-xs"
            value=""
            onChange={(event) => {
              if (event.target.value) insert(` #${event.target.value} `);
            }}
          >
            <option value="">Reference a note…</option>
            {referenceNotes.map((note) => (
              <option key={note.id} value={refOf(note.id)}>
                {noteKey(note)} · {note.body.slice(0, 50)}
              </option>
            ))}
          </select>
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
            disabled={action.isPending}
            onSelect={(event) => {
              caret.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              };
            }}
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
              if (
                (event.metaKey || event.ctrlKey) &&
                ["KeyB", "KeyI"].includes(event.code)
              ) {
                event.preventDefault();
                wrap(event.code === "KeyB" ? "**" : "_");
                return;
              }
              if (
                event.key === "Escape" &&
                !busy &&
                body === (draft.original || "")
              ) {
                event.preventDefault();
                onClose();
              }
              if (
                !event.nativeEvent.isComposing &&
                event.key === "Enter" &&
                (event.metaKey ||
                  event.ctrlKey ||
                  (settings.enterSaves ? !event.shiftKey : event.shiftKey))
              ) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="Write feedback, ask a question, or propose a change…"
            className={`w-full rounded-lg border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring ${embedded ? "min-h-20 max-h-[30dvh] resize-none" : "min-h-28 resize-y"}`}
          />
        )}
        {!embedded && attachments}
        {(action.error || uploadError) && (
          <p role="alert" className="text-sm text-destructive">
            {action.error?.message || uploadError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="mr-auto text-xs text-muted-foreground">
            Markdown supported · ⌘/Ctrl Enter to save
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            {agent && (
              <Button
                variant="outline"
                disabled={busy || !hasContent}
                onClick={() => void save(false)}
              >
                Save only
              </Button>
            )}
            <Button disabled={busy || !hasContent} onClick={() => void save()}>
              {busy && <LoaderCircle className="animate-spin" />}
              {agent
                ? "Save & ask AI"
                : draft.kind === "reply"
                  ? "Send reply"
                  : "Save note"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <section
      data-review-editor
      data-editor-subject={subject}
      aria-label="Comment editor"
      className={
        embedded
          ? "flex min-h-0 flex-1 flex-col"
          : "rounded-xl border border-primary/40 bg-card p-4 shadow-sm"
      }
    >
      <h2
        className={`mb-3 shrink-0 break-words font-mono text-xs font-medium text-primary ${embedded ? "px-4 pt-4" : ""}`}
      >
        {title}
      </h2>
      {content}
    </section>
  );
}
