import { useState } from "react";
import { useAnnotator } from "../components/images.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  captureComparisons,
  canCompareCaptures,
  wipeMismatch,
  wipeImageMismatch,
} from "./capture-comparison.ts";
import {
  webSelectionKey,
  type WebAnnotationTarget,
  type WebReview,
} from "../../../shared/web-review.ts";
import type { WebAnnotation } from "../../../shared/web-annotation.ts";
import type { ReviewMessage } from "../../../shared/review-types.ts";
import { splitWebMessage } from "./capture-comparison.ts";
import { Markdown } from "../components/markdown.tsx";
import { webReview, type WebCapture } from "../../../shared/web-review.ts";
import { attachmentSrc } from "../components/attachments.ts";
import { AttachmentImage } from "../components/images.tsx";

function Capture({
  capture,
  label,
  onAnnotate,
  onRemove,
  onDrawing,
}: {
  capture: WebCapture;
  label: string;
  onAnnotate?: (annotation: WebAnnotation | null) => Promise<void>;
  onRemove?: () => Promise<void>;
  onDrawing?: (open: boolean) => void;
}) {
  const annotate = useAnnotator();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function draw() {
    if (!capture.area || busy || !onAnnotate) return;
    setBusy(true);
    onDrawing?.(true);
    setError("");
    try {
      await annotate(
        `capture:${capture.at}:${capture.area}`,
        capture.area,
        capture.annotation,
        capture.rect.width,
        onAnnotate,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      onDrawing?.(false);
    }
  }
  async function remove() {
    if (!onRemove || busy) return;
    setBusy(true);
    try {
      await onRemove();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const image =
    capture.annotation?.image ||
    capture.proposal ||
    capture.area ||
    capture.page;
  const src = image && attachmentSrc(image);
  return (
    <figure className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <figcaption className="flex items-center gap-2 text-xs font-medium">
        <span>{label}</span>
        <span className="ml-auto text-muted-foreground">
          {new Date(capture.at).toLocaleString()}
        </span>
      </figcaption>
      {capture.annotation && (
        <p className="text-xs text-primary">
          Annotated proposal · original screenshot retained
        </p>
      )}
      {src && (
        <AttachmentImage
          source={image!}
          label={label}
          onDraw={onAnnotate ? () => void draw() : undefined}
        />
      )}
      {onAnnotate && capture.area && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void draw()}
        >
          Draw / edit
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void remove()}
        >
          Remove selection
        </Button>
      )}
      {capture.annotation && capture.area && (
        <details className="text-xs">
          <summary className="cursor-pointer">Original screenshot</summary>
          <AttachmentImage source={capture.area} label="Original screenshot" />
        </details>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Selection details</summary>
        <div className="mt-2 space-y-2 break-all">
          <p>{capture.url}</p>
          {(capture.selections || [capture]).map((selection, i) => (
            <div key={i}>
              <code>{selection.selector}</code>
              <p>{selection.element?.text}</p>
              <p>{selection.components.map((c) => c.name).join(" → ")}</p>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(selection.element?.styles, null, 2)}
              </pre>
            </div>
          ))}
          {capture.context && (
            <p>
              Saved context: <code>{capture.context.id}</code>
            </p>
          )}
        </div>
      </details>
    </figure>
  );
}
export function WebEvidence({
  value,
  onChange,
  onAnnotate,
  editable = true,
  messages = [],
  onRemove,
  onDrawing,
}: {
  value: unknown;
  onChange?: (web: WebReview) => void;
  onAnnotate?: (
    target: WebAnnotationTarget,
    annotation: WebAnnotation | null,
  ) => Promise<void>;
  editable?: boolean;
  messages?: ReviewMessage[];
  onRemove?: (index: number, key: string) => Promise<void>;
  onDrawing?: (open: boolean) => void;
}) {
  const web = webReview(value);
  if (!web) return null;
  async function save(
    target: WebAnnotationTarget,
    annotation: WebAnnotation | null,
  ) {
    if (onAnnotate) await onAnnotate(target, annotation);
    else if (onChange && web) {
      const next = structuredClone(web);
      const capture =
        target.kind === "after"
          ? next.after[target.index]
          : target.index
            ? next.additional![target.index - 1]
            : next.before;
      if (annotation) capture!.annotation = annotation;
      else delete capture!.annotation;
      onChange(next);
    }
  }
  const drawing = editable && (onChange || onAnnotate);
  return (
    <div className="my-3 grid gap-3">
      {[web.before, ...(web.additional || [])].map((capture, i) => (
        <Capture
          key={`selection-${i}`}
          capture={capture}
          onAnnotate={
            drawing
              ? (annotation) =>
                  save(
                    {
                      kind: "selection",
                      index: i,
                      key: webSelectionKey(capture),
                      expected: capture.annotation?.image || "",
                    },
                    annotation,
                  )
              : undefined
          }
          onDrawing={onDrawing}
          onRemove={
            editable && onRemove
              ? () => onRemove(i, webSelectionKey(capture))
              : undefined
          }
          label={`Selection ${i + 1}`}
        />
      ))}
      {web.after.map((capture, i) => (
        <Capture
          key={`after-${i}`}
          capture={capture}
          onAnnotate={
            drawing
              ? (annotation) =>
                  save(
                    {
                      kind: "after",
                      index: i,
                      key: webSelectionKey(capture),
                      expected: capture.annotation?.image || "",
                    },
                    annotation,
                  )
              : undefined
          }
          onDrawing={onDrawing}
          label={`After ${i + 1}`}
        />
      ))}
      <CaptureComparison web={web} messages={messages} />
    </div>
  );
}

function CaptureComparison({
  web,
  messages,
}: {
  web: WebReview;
  messages: ReviewMessage[];
}) {
  const sources = captureComparisons(web, messages);
  const [before, setBefore] = useState(0);
  const [after, setAfter] = useState(0);
  const [wipe, setWipe] = useState(false);
  const [position, setPosition] = useState(50);
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const left = sources.originals[before];
  const right = sources.evidence[after];
  if (!left || !right || !canCompareCaptures(left.capture, right.capture))
    return null;
  const mismatch =
    wipeMismatch(left.capture, right.capture) ||
    (sizes[left.capture.area!] && sizes[right.capture.area!]
      ? wipeImageMismatch(
          sizes[left.capture.area!]!,
          sizes[right.capture.area!]!,
        )
      : "Images are loading.");
  const source = (side: typeof left, className: string) => (
    <img
      src={attachmentSrc(side.capture.area!)}
      alt={side.label}
      className={className}
      onLoad={(event) => {
        const img = event.currentTarget;
        setSizes((current) => ({
          ...current,
          [side.capture.area!]: {
            width: img.naturalWidth,
            height: img.naturalHeight,
          },
        }));
      }}
    />
  );
  return (
    <details className="rounded-lg border p-3 text-xs">
      <summary className="cursor-pointer text-primary">
        Compare original screenshots
      </summary>
      <div className="mt-3 space-y-3">
        <select
          aria-label="Before capture"
          className="w-full rounded border bg-background p-2"
          value={before}
          onChange={(event) => setBefore(+event.target.value)}
        >
          {sources.originals.map((item, i) => (
            <option key={i} value={i}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="After capture"
          className="w-full rounded border bg-background p-2"
          value={after}
          onChange={(event) => setAfter(+event.target.value)}
        >
          {sources.evidence.map((item, i) => (
            <option key={i} value={i}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setWipe(false)}>
            Side by side
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!mismatch}
            onClick={() => setWipe(true)}
          >
            Wipe
          </Button>
        </div>
        {mismatch && <p className="text-muted-foreground">{mismatch}</p>}
        {wipe && !mismatch ? (
          <div>
            <div className="relative">
              {source(left, "w-full")}
              <div
                className="absolute inset-0"
                style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
              >
                {source(right, "w-full")}
              </div>
            </div>
            <input
              aria-label="Comparison wipe"
              className="w-full"
              type="range"
              min="0"
              max="100"
              value={position}
              onChange={(event) => setPosition(+event.target.value)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {source(left, "w-full")}
            {source(right, "w-full")}
          </div>
        )}
      </div>
    </details>
  );
}

export function ConversationBody({
  body,
  file,
  captured,
}: {
  body: string;
  file: string;
  captured?: string;
}) {
  return (
    <>
      {splitWebMessage(body).map((part, i) =>
        "web" in part ? (
          <WebEvidence key={i} value={part.web} />
        ) : (
          <Markdown key={i} body={part.text} file={file} captured={captured} />
        ),
      )}
    </>
  );
}
