import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { useAnnotator } from "../components/images.tsx";
import { Button } from "../components/ui/button.tsx";
import { DifferenceOverlay } from "./difference-overlay.tsx";
import { Select } from "../components/ui/select.tsx";
import {
  captureComparisons,
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
import { ContextReference } from "../components/context.tsx";

function captureName(capture: WebCapture): string {
  if (capture.selections && capture.selections.length > 1)
    return `${capture.selections.length} elements`;
  const element = capture.element;
  const name =
    element?.attributes["aria-label"] ||
    element?.attributes.alt ||
    element?.attributes.title ||
    element?.text.split("\n").find((line) => line.trim()) ||
    capture.selector ||
    capture.title;
  const subject = name.replace(/\s+/g, " ").trim();
  return capture.mode === "area"
    ? `Area · ${subject || "Page"}`
    : subject || (capture.mode === "point" ? "Point" : "Element");
}

function Capture({
  capture,
  label,
  onAnnotate,
  onRemove,
  onDrawing,
  saved,
}: {
  capture: WebCapture;
  label: string;
  onAnnotate?: (annotation: WebAnnotation | null) => Promise<void>;
  onRemove?: () => Promise<void>;
  onDrawing?: (open: boolean) => void;
  saved: boolean;
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
        saved ? "Save drawing" : "Use drawing",
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
    setError("");
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
    <figure className="min-w-0 space-y-2 rounded-md bg-muted/30 p-2">
      <figcaption className="flex min-w-0 items-center gap-2" title={label}>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {label}
        </span>
        {onRemove && (
          <Tooltip label="Remove capture">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Remove capture: ${label}`}
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 />
            </Button>
          </Tooltip>
        )}
      </figcaption>
      {src && (
        <AttachmentImage
          source={image!}
          label={label}
          thumbnail
          onDraw={onAnnotate && capture.area ? () => void draw() : undefined}
          size={
            capture.annotation
              ? {
                  width:
                    capture.annotation.width + 2 * capture.annotation.padding,
                  height:
                    capture.annotation.height + 2 * capture.annotation.padding,
                }
              : image === capture.area
                ? capture.rect
                : undefined
          }
        />
      )}
      {!src && (
        <p className="text-xs text-muted-foreground">Point · no screenshot</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Capture details</summary>
        <div className="mt-2 space-y-2 break-words">
          <p>{new Date(capture.at).toLocaleString()}</p>
          <p>{capture.url}</p>
          {capture.annotation && capture.area && (
            <details>
              <summary className="cursor-pointer">Original screenshot</summary>
              <AttachmentImage
                source={capture.area}
                label="Original screenshot"
              />
            </details>
          )}
          {(capture.selections || [capture]).map((selection, i) => (
            <details key={i}>
              <summary
                className="cursor-pointer truncate"
                title={selection.selector}
              >
                {selection.selector || `Selection ${i + 1}`}
              </summary>
              <div className="mt-2 space-y-2">
                {selection.element?.text && (
                  <details>
                    <summary className="cursor-pointer">Text</summary>
                    <p className="whitespace-pre-wrap break-words">
                      {selection.element.text}
                    </p>
                  </details>
                )}
                {selection.components.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">Components</summary>
                    <p>{selection.components.map((c) => c.name).join(" → ")}</p>
                  </details>
                )}
                {selection.element?.styles && (
                  <details>
                    <summary className="cursor-pointer">Styles</summary>
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(selection.element.styles, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          ))}
          {capture.context && (
            <ContextReference
              source={capture.context.id}
              label={`Additional context: ${capture.context.label}`}
            />
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
  saved = false,
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
  saved?: boolean;
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
  const captures = [web.before, ...(web.additional || [])];
  return (
    <div className="grid gap-3">
      {captures.map((capture, i) => (
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
          label={`${captures.length > 1 ? `${i + 1}. ` : ""}${captureName(capture)}`}
          saved={saved}
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
          label={`After ${i + 1} · ${captureName(capture)}`}
          saved={saved}
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
  const [mode, setMode] = useState<"side" | "wipe" | "difference">("side");
  const [position, setPosition] = useState(50);
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const left = sources.originals[before];
  const right = sources.evidence[after];
  if (!left || !right || !left.capture.area || !right.capture.area) return null;
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
      onError={() =>
        setSizes((current) => ({
          ...current,
          [side.capture.area!]: { width: 0, height: 0 },
        }))
      }
    />
  );
  return (
    <details className="rounded-lg border p-3 text-xs">
      <summary className="cursor-pointer text-primary">
        Compare original screenshots
      </summary>
      <div className="mt-3 space-y-3">
        <Select
          label="Before capture"
          className="w-full"
          value={before}
          onValueChange={setBefore}
          options={sources.originals.map((item, value) => ({
            value,
            label: item.label,
          }))}
        />
        <Select
          label="After capture"
          className="w-full"
          value={after}
          onValueChange={setAfter}
          options={sources.evidence.map((item, value) => ({
            value,
            label: item.label,
          }))}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-pressed={mode === "side"}
            onClick={() => setMode("side")}
          >
            Side by side
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!mismatch}
            aria-pressed={mode === "wipe"}
            onClick={() => setMode("wipe")}
          >
            Wipe
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!mismatch}
            aria-pressed={mode === "difference"}
            onClick={() => setMode("difference")}
          >
            Pixel difference
          </Button>
        </div>
        {mismatch && <p className="text-muted-foreground">{mismatch}</p>}
        <DifferenceOverlay
          before={attachmentSrc(left.capture.area)}
          after={attachmentSrc(right.capture.area)}
          active={mode === "difference" && !mismatch}
        />
        {mode === "difference" && !mismatch ? null : mode === "wipe" &&
          !mismatch ? (
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
