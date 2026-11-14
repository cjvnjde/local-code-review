import {
  dropWebSelection,
  webReview,
  webReviewLines,
  type WebReview,
} from "../../../shared/web-review.ts";
import { ColorTools } from "../components/colors.tsx";
import { AttachmentImage } from "../components/images.tsx";
import { attachmentSrc, uploadAttachment } from "../components/attachments.ts";
import { useReferences } from "./references.tsx";
import {
  fileRef,
  insertRef,
  matchingFiles,
  plainRefs,
  referenceAt,
  refLabel,
  refOf,
  type ReferenceCompletion,
} from "./note-ref.ts";
import { useUi } from "../app/ui-preferences.tsx";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Code as CodeIcon,
  SquareCode,
  Quote,
  List,
  ListTodo,
  Link,
  Paperclip,
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
  const askAI = agent && settings.aiAnswers;
  const { notes: referenceNotes, files: referenceFiles } = useReferences();
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const listbox = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const dismissedReference = useRef<string | null>(null);
  const [completion, setCompletion] = useState<ReferenceCompletion | null>(
    null,
  );
  const [activeReference, setActiveReference] = useState(0);
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
  const integrated = !embedded && (draft.editing || draft.kind === "reply");
  const inlineSelection =
    !embedded &&
    draft.kind === "note" &&
    !draft.editing &&
    draft.host !== "panel" &&
    !draft.comment.scope &&
    !!code;
  const matches = useMemo(
    () =>
      completion?.kind === "file"
        ? matchingFiles(referenceFiles, completion.query).map((file) => ({
            kind: "file" as const,
            path: file.path,
          }))
        : completion
          ? referenceNotes
              .filter((note) => {
                if (!refOf(note.id)) return false;
                const query = completion.query.toLocaleLowerCase();
                return [
                  note.id,
                  note.file,
                  noteKey(note),
                  plainRefs(note.body),
                ].some((value) => value.toLocaleLowerCase().includes(query));
              })
              .map((note) => ({ kind: "note" as const, note }))
          : [],
    [completion, referenceFiles, referenceNotes],
  );
  const selectedReference = Math.min(activeReference, matches.length - 1);
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
    setCompletion(null);
    dismissedReference.current = null;
  }, [subject, preview]);
  useLayoutEffect(() => {
    const option = listbox.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (option) {
      const list = listbox.current!;
      if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
      else if (
        option.offsetTop + option.offsetHeight >
        list.scrollTop + list.clientHeight
      )
        list.scrollTop =
          option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [selectedReference, completion]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(embedded ? 200 : 480, Math.max(embedded ? 112 : 72, field.scrollHeight))}px`;
    }
  }, [body, preview, embedded]);
  // Upload completion reads the current draft, so text typed during an upload is kept.
  const latest = useRef(draft);
  latest.current = draft;
  function updateCompletion(field: HTMLTextAreaElement) {
    if (composing.current) return;
    const { selectionStart: start, selectionEnd: end, value } = field;
    const match = referenceAt(value, start, end);
    if (!match) {
      setCompletion(null);
      dismissedReference.current = null;
      return;
    }
    if (dismissedReference.current === `${match.kind}:${match.from}`) return;
    if (
      completion?.from !== match.from ||
      completion.kind !== match.kind ||
      completion.query !== match.query
    )
      setActiveReference(0);
    setCompletion(match);
  }
  function replaceText(
    from: number,
    to: number,
    text: string,
    start = from + text.length,
    end = start,
  ) {
    const current = latest.current;
    const value = draftBody(current);
    const field = textarea.current;
    if (field) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(from, to);
      // Native text insertion keeps references, formatting and uploads undoable.
      document.execCommand("insertText", false, text);
    }
    onChange(withBody(current, value.slice(0, from) + text + value.slice(to)));
    setCompletion(null);
    caret.current = { start, end };
    requestAnimationFrame(() => {
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(start, end);
    });
  }
  function insert(text: string) {
    const value = draftBody(latest.current);
    const at = textarea.current?.selectionStart ?? value.length;
    const end = textarea.current?.selectionEnd ?? at;
    replaceText(at, end, text);
  }
  function wrap(before: string, after = before) {
    const field = textarea.current;
    if (!field) return;
    const from = field.selectionStart,
      to = field.selectionEnd;
    replaceText(
      from,
      to,
      before + draftBody(latest.current).slice(from, to) + after,
      from + before.length,
      to + before.length,
    );
  }
  function insertReference(reference: (typeof matches)[number]) {
    if (!completion) return;
    const value = draftBody(latest.current);
    const token =
      reference.kind === "file"
        ? fileRef(reference.path)
        : `[${refLabel(reference.note).replace(/[\\[\]]/g, "\\$&")}](lcr:${refOf(reference.note.id)})`;
    const result = insertRef(value, completion.from, completion.to, token);
    const text = result.value.slice(
      completion.from,
      result.value.length - (value.length - completion.to),
    );
    dismissedReference.current = `${completion.kind}:${completion.from}`;
    replaceText(completion.from, completion.to, text, result.caret);
  }
  async function attach(files: File[]) {
    if (busy || !files.length) return;
    setUploading(true);
    onBusy?.(true);
    setUploadError("");
    try {
      for (const file of files) {
        const ref = await uploadAttachment(file, file.name);
        const label = (file.name || "Attachment")
          .replace(/[\r\n]/g, " ")
          .replace(/[\\`*_[\]{}()<>!#|~&]/g, "\\$&");
        const image =
          file.type.toLowerCase().startsWith("image/") && attachmentSrc(ref);
        insert(`\n${image ? "!" : ""}[${label}](${ref})\n`);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      onBusy?.(false);
    }
  }
  async function save(ask = askAI) {
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
    <div className={`flex min-h-0 flex-col gap-3 ${embedded ? "flex-1" : ""}`}>
      <div
        role={embedded ? "region" : undefined}
        aria-label={embedded ? "Evidence and attachments" : undefined}
        className={
          embedded ? "min-h-0 flex-1 space-y-3 overflow-auto px-4" : "contents"
        }
      >
        {!integrated && draft.kind === "note" && draft.comment.image && (
          <AttachmentImage
            source={draft.comment.image.capture}
            label="Selected screenshot region"
          />
        )}
        {!integrated && !inlineSelection && code && (
          <pre
            aria-label={`Captured code · ${file}`}
            className="max-h-48 overflow-auto border-y bg-muted/30 py-3 text-xs"
          >
            <Code value={code} language="diff" />
          </pre>
        )}
        {(!integrated || draft.kind === "reply") && web && (
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
          <Tooltip label="Attach file">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Attach file"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              <Paperclip />
            </Button>
          </Tooltip>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void attach([...(e.target.files || [])]);
              e.target.value = "";
            }}
          />
        </div>
        {preview ? (
          <div className="max-h-80 min-h-28 overflow-auto">
            <Markdown
              body={body || "Nothing to preview yet."}
              file={file}
              captured={code}
            />
          </div>
        ) : (
          <div className="relative">
            <textarea
              ref={textarea}
              aria-label="Note text"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={!!completion}
              aria-controls={completion ? listboxId : undefined}
              aria-activedescendant={
                completion && selectedReference >= 0
                  ? `${listboxId}-${selectedReference}`
                  : undefined
              }
              disabled={action.isPending}
              onSelect={(event) => {
                caret.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                };
                updateCompletion(event.currentTarget);
              }}
              value={body}
              onChange={(event) => {
                onChange(withBody(latest.current, event.currentTarget.value));
                updateCompletion(event.currentTarget);
              }}
              onFocus={(event) => updateCompletion(event.currentTarget)}
              onBlur={() => setCompletion(null)}
              onCompositionStart={() => {
                composing.current = true;
                setCompletion(null);
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                updateCompletion(event.currentTarget);
              }}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.length) {
                  event.preventDefault();
                  void attach(files);
                }
              }}
              onKeyDown={(event) => {
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                if (completion) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    dismissedReference.current = `${completion.kind}:${completion.from}`;
                    setCompletion(null);
                    return;
                  }
                  if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                    if (
                      matches.length &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      event.preventDefault();
                      setActiveReference(
                        (selectedReference +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          matches.length) %
                          matches.length,
                      );
                      return;
                    }
                    if (
                      matches.length &&
                      !event.shiftKey &&
                      (event.key === "Enter" || event.key === "Tab")
                    ) {
                      event.preventDefault();
                      insertReference(matches[selectedReference]!);
                      return;
                    }
                  }
                }
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
              placeholder="Write feedback, ask a question, or type # for a note or @ for a file…"
              className={`w-full border-0 bg-muted/50 px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground placeholder:opacity-60 outline-none focus-visible:outline-1 focus-visible:outline-ring ${embedded ? "min-h-20 max-h-[30dvh] resize-none" : "min-h-18 resize-y"}`}
            />
            {completion && (
              <div
                ref={listbox}
                id={listboxId}
                role="listbox"
                aria-label={
                  completion.kind === "file"
                    ? "File references"
                    : "Note references"
                }
                className="absolute inset-x-0 top-full z-50 max-h-60 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                {matches.length ? (
                  matches.map((reference, index) => (
                    <button
                      key={
                        reference.kind === "file"
                          ? reference.path
                          : reference.note.id
                      }
                      id={`${listboxId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === selectedReference}
                      tabIndex={-1}
                      className={`block w-full rounded px-3 py-2 text-left text-xs ${index === selectedReference ? "bg-accent text-accent-foreground" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActiveReference(index)}
                      onClick={() => insertReference(reference)}
                    >
                      <span className="block truncate font-medium">
                        {reference.kind === "file"
                          ? reference.path
                          : `#${refOf(reference.note.id)} · ${noteKey(reference.note)}`}
                      </span>
                      {reference.kind === "note" && (
                        <span className="block truncate text-muted-foreground">
                          {plainRefs(reference.note.body)
                            .replace(/\s+/g, " ")
                            .slice(0, 160) || "Empty note"}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No matching {completion.kind === "file" ? "files" : "notes"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {!embedded && attachments}
        {(action.error || uploadError) && (
          <p role="alert" className="text-sm text-destructive">
            {action.error?.message || uploadError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            {askAI && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !hasContent}
                onClick={() => void save(false)}
              >
                Save only
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy || !hasContent}
              onClick={() => void save()}
            >
              {busy && <LoaderCircle className="animate-spin" />}
              {askAI
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
      className={embedded ? "flex min-h-0 flex-1 flex-col" : "min-w-0"}
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
      {!integrated && (embedded || draft.host === "panel") && (
        <h2
          className={`mb-3 shrink-0 break-words font-mono text-xs font-medium text-primary ${embedded ? "px-4 pt-4" : ""}`}
        >
          {title}
        </h2>
      )}
      {content}
    </section>
  );
}
