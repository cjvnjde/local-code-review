import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import { decodeImageDrawing } from "../../../shared/image-drawing.ts";
import type { WebAnnotation } from "../../../shared/web-annotation.ts";
import { openAnnotation } from "./annotation-editor.ts";
import { imageEditorOwner, openImagePreview } from "./image-preview.ts";
import { attachmentSrc, imageTokens } from "./attachments.ts";

const DrawingScope = createContext({ repo: "", read: "" });
export function ImageScope({
  repo,
  read,
  children,
}: {
  repo: string;
  read: string;
  children: ReactNode;
}) {
  return <DrawingScope value={{ repo, read }}>{children}</DrawingScope>;
}
export function AttachmentImage({
  source,
  label,
  onDraw,
  thumbnail = false,
  size,
}: {
  source: string;
  label: string;
  onDraw?: () => void;
  thumbnail?: boolean;
  size?: { width: number; height: number };
}) {
  const src = attachmentSrc(source);
  if (!src) return null;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`${onDraw ? "Annotate" : "Preview"} ${label}`}
      className="block min-w-0 max-w-full"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        if (onDraw) onDraw();
        else
          openImagePreview(
            source,
            label,
            undefined,
            imageEditorOwner(event.currentTarget),
          );
      }}
    >
      <img
        src={src}
        alt={label}
        width={size?.width}
        height={size?.height}
        style={
          thumbnail && size
            ? { width: Math.min(size.width, (224 * size.width) / size.height) }
            : undefined
        }
        loading="lazy"
        className={
          thumbnail
            ? "h-auto max-h-56 w-auto max-w-full rounded object-contain"
            : "h-auto max-h-80 max-w-full object-contain"
        }
      />
    </a>
  );
}
export function useAnnotator() {
  const scope = useContext(DrawingScope);
  return (
    route: string,
    source: string,
    annotation: WebAnnotation | undefined,
    width: number | undefined,
    apply: (next: WebAnnotation | null) => Promise<void>,
    applyLabel: "Use drawing" | "Save drawing" = "Use drawing",
  ) =>
    openAnnotation(
      route,
      { image: source, annotation, cssWidth: width, applyLabel },
      apply,
      scope,
      imageEditorOwner(document.activeElement),
    );
}
export function useDrawing() {
  const scope = useContext(DrawingScope);
  return async (
    route: string,
    source: string,
    apply: (ref: string) => Promise<void>,
    annotation?: WebAnnotation,
    cssWidth?: number,
  ) => {
    const owner = imageEditorOwner(document.activeElement);
    const response = await fetch(attachmentSrc(source));
    if (!response.ok)
      throw new Error("Could not load this attachment for editing.");
    const drawing = annotation
      ? null
      : decodeImageDrawing(
          new Uint8Array(await response.arrayBuffer()),
          source,
        );
    const original = drawing?.source || source;
    await openAnnotation(
      route,
      {
        image: original,
        annotation: annotation || drawing?.annotation,
        cssWidth,
      },
      async (next) => apply(next?.image || original),
      scope,
      owner,
    );
  };
}
export function ComposerImages({
  body,
  subject,
  onReplace,
  onBusy,
}: {
  body: string;
  subject: string;
  onReplace: (from: number, to: number, expected: string, ref: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const draw = useDrawing();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tokens = imageTokens(body);
  const restoreImage = useEffectEvent((index: number) => {
    const token = tokens[index];
    if (token) void edit(token, index);
  });
  useEffect(() => {
    const restore = (event: Event) => {
      const route = (event as CustomEvent).detail?.route;
      if (typeof route !== "string" || !route.startsWith(`image:${subject}:`))
        return;
      const index = Number(route.slice(`image:${subject}:`.length));
      restoreImage(index);
    };
    document.addEventListener("lcr:annotation-restore", restore);
    return () =>
      document.removeEventListener("lcr:annotation-restore", restore);
  }, [subject]);
  async function edit(token: (typeof tokens)[number], index: number) {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await draw(`image:${subject}:${index}`, token.ref, async (ref) =>
        onReplace(token.from, token.to, token.ref, ref),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <>
      {tokens.length > 0 && (
        <section
          aria-label="Attached images"
          className="grid gap-3 sm:grid-cols-2"
        >
          {tokens.map((token, index) => (
            <div key={`${token.ref}:${index}`} aria-busy={busy}>
              <AttachmentImage
                source={token.ref}
                label={token.label}
                onDraw={() => void edit(token, index)}
              />
            </div>
          ))}
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
