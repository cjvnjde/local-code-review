import { useRef, useState } from "react";
import type {
  DiffFile,
  ReviewComment,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { regionRect, type ImageRegion } from "../../../shared/image-region.ts";
import { mintNoteId } from "../../../shared/note-id.ts";
import { uploadImage } from "../components/attachments.ts";
import { Button } from "../components/ui/button.tsx";
import { isImage } from "./reading-model.ts";

type Rect = Pick<
  ImageRegion,
  "x" | "y" | "width" | "height" | "imageWidth" | "imageHeight"
>;
export function FileMedia({
  file,
  notes,
  onComment,
  onRead,
  blocked,
}: {
  file: DiffFile;
  notes: ReviewNote[];
  onComment: (comment: ReviewComment) => void;
  onRead: (note: ReviewNote) => void;
  blocked: boolean;
}) {
  const audio = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|aiff?|weba)$/i.test(
    file.path,
  );
  if (!isImage(file.path) && !audio)
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Binary file changed. Add a file comment to leave feedback.
      </div>
    );
  return (
    <div className="grid gap-4 border-b p-5 md:grid-cols-2">
      {(["old", "new"] as const)
        .filter((side) =>
          side === "old" ? file.status !== "added" : file.status !== "deleted",
        )
        .map((side) => (
          <figure
            key={side}
            className="min-w-0 rounded-lg border bg-muted/20 p-3"
          >
            <figcaption className="mb-3 text-xs text-muted-foreground">
              {side === "old" ? "Before" : "After"}
            </figcaption>
            {audio ? (
              <audio
                controls
                preload="metadata"
                aria-label={`${side === "old" ? "Before" : "After"}: ${file.path}`}
                src={`/api/blob?${new URLSearchParams({ side, path: file.path })}`}
                className="w-full"
              />
            ) : (
              <ImageRegions
                file={file}
                side={side}
                notes={notes}
                onComment={onComment}
                onRead={onRead}
                blocked={blocked}
              />
            )}
          </figure>
        ))}
    </div>
  );
}
function ImageRegions({
  file,
  side,
  notes,
  onComment,
  onRead,
  blocked,
}: {
  file: DiffFile;
  side: "old" | "new";
  notes: ReviewNote[];
  onComment: (comment: ReviewComment) => void;
  onRead: (note: ReviewNote) => void;
  blocked: boolean;
}) {
  const img = useRef<HTMLImageElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const position = (r: Rect) => ({
    left: `${(r.x / r.imageWidth) * 100}%`,
    top: `${(r.y / r.imageHeight) * 100}%`,
    width: `${(r.width / r.imageWidth) * 100}%`,
    height: `${(r.height / r.imageHeight) * 100}%`,
  });
  function point(x: number, y: number) {
    const box = img.current!.getBoundingClientRect();
    return { x: x - box.left, y: y - box.top };
  }
  function region(b: { x: number; y: number }): Rect {
    const box = img.current!.getBoundingClientRect();
    return {
      ...regionRect(press.current!, b, box, size),
      imageWidth: size.width,
      imageHeight: size.height,
    };
  }
  async function capture(r: Rect) {
    if (blocked || busy || !img.current) return;
    setBusy(true);
    setError("");
    try {
      const scale = Math.min(
        1,
        2048 / Math.max(r.width, r.height),
        Math.sqrt(2_000_000 / (r.width * r.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(r.width * scale));
      canvas.height = Math.max(1, Math.round(r.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image capture is unavailable.");
      const sx = canvas.width / r.width,
        sy = canvas.height / r.height;
      context.drawImage(
        img.current,
        -r.x * sx,
        -r.y * sy,
        r.imageWidth * sx,
        r.imageHeight * sy,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Could not capture this image.")),
          "image/png",
        ),
      );
      const ref = await uploadImage(blob);
      const image: ImageRegion = {
        ...r,
        side,
        source: file.hash,
        capture: ref,
      };
      onComment({
        id: mintNoteId(file.path, "*", "*"),
        file: file.path,
        scope: "file",
        start: 0,
        end: 0,
        body: "",
        image,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setRect(null);
    }
  }
  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto w-fit max-w-full select-none touch-none"
        data-image-side={side}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            event.altKey ||
            blocked ||
            busy ||
            !size.width ||
            (event.target as Element).closest("button")
          )
            return;
          event.preventDefault();
          press.current = point(event.clientX, event.clientY);
          setRect(region(press.current));
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (press.current)
            setRect(region(point(event.clientX, event.clientY)));
        }}
        onPointerUp={(event) => {
          if (!press.current) return;
          const r = region(point(event.clientX, event.clientY));
          press.current = null;
          if (!event.altKey) void capture(r);
          else setRect(null);
        }}
        onPointerCancel={() => {
          press.current = null;
          setRect(null);
        }}
        onLostPointerCapture={() => {
          press.current = null;
        }}
      >
        <img
          ref={img}
          className="max-h-96 max-w-full object-contain"
          src={`/api/blob?${new URLSearchParams({ side, path: file.path })}`}
          alt={`${side === "old" ? "Before" : "After"}: ${file.path}`}
          draggable={false}
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
        {notes
          .filter(
            (note) =>
              note.file === file.path &&
              note.image?.side === side &&
              note.image.source === file.hash &&
              note.image.imageWidth === size.width &&
              note.image.imageHeight === size.height,
          )
          .map((note) => (
            <div
              key={note.id}
              className="pointer-events-none absolute border-2 border-primary"
              style={position(note.image!)}
            >
              <button
                className="pointer-events-auto bg-primary px-1 text-[10px] text-primary-foreground"
                onClick={() => onRead(note)}
                aria-label="Read screenshot comment"
              >
                #{note.id.split("|#").at(-1)?.slice(-8)}
              </button>
            </div>
          ))}
        {rect && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/15"
            style={position(rect)}
          />
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={blocked || busy || !size.width}
        onClick={() => {
          const box = img.current!.getBoundingClientRect();
          press.current = { x: box.width / 2, y: box.height / 2 };
          const r = region(press.current);
          press.current = null;
          void capture(r);
        }}
      >
        {busy ? "Capturing…" : "Comment on image region"}
      </Button>
      <p className="text-[10px] text-muted-foreground">
        Click or drag on the image to capture a region.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
