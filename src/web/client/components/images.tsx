import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pencil, ZoomIn } from "lucide-react";
import { decodeImageDrawing } from "../../../shared/image-drawing.ts";
import type { WebAnnotation } from "../../../shared/web-annotation.ts";
import { openAnnotation } from "./annotation-editor.ts";
import { imageEditorOwner, openImagePreview } from "./image-preview.ts";
import { attachmentSrc, imageTokens } from "./attachments.ts";
import { Button } from "./ui/button.tsx";

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
}: {
  source: string;
  label: string;
  onDraw?: () => void;
}) {
  const src = attachmentSrc(source);
  if (!src) return null;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Preview ${label}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        openImagePreview(
          source,
          label,
          onDraw,
          imageEditorOwner(event.currentTarget),
        );
      }}
    >
      <img
        src={src}
        alt={label}
        loading="lazy"
        className="max-h-80 max-w-full rounded-lg border object-contain"
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
  ) =>
    openAnnotation(
      route,
      { image: source, annotation, cssWidth: width },
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
  const latest = useRef(tokens);
  latest.current = tokens;
  useEffect(() => {
    const restore = (event: Event) => {
      const route = (event as CustomEvent).detail?.route;
      if (typeof route !== "string" || !route.startsWith(`image:${subject}:`))
        return;
      const index = Number(route.slice(`image:${subject}:`.length));
      const token = latest.current[index];
      if (token) void edit(token, index);
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
            <div
              key={`${token.ref}:${index}`}
              className="rounded-lg border bg-muted/20 p-3"
            >
              <AttachmentImage
                source={token.ref}
                label={token.label}
                onDraw={() => void edit(token, index)}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) =>
                    openImagePreview(
                      token.ref,
                      token.label,
                      () => void edit(token, index),
                      imageEditorOwner(event.currentTarget),
                    )
                  }
                >
                  <ZoomIn />
                  Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void edit(token, index)}
                >
                  <Pencil />
                  Draw / edit
                </Button>
              </div>
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
