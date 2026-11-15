import { useRef, useState } from "react";
import type {
  DiffFile,
  ReviewComment,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { regionRect, type ImageRegion } from "../../../shared/image-region.ts";
import { mintNoteId } from "../../../shared/note-id.ts";
import { uploadImage } from "../components/attachments.ts";
import { useDrawing } from "../components/images.tsx";
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
    <div className="grid gap-px border-b md:grid-cols-2">
      {(["old", "new"] as const)
        .filter((side) =>
          side === "old" ? file.status !== "added" : file.status !== "deleted",
        )
        .map((side) => (
          <figure key={side} className="min-w-0">
            <figcaption className="px-3 py-1 text-xs text-muted-foreground">
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
  const draw = useDrawing();
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
  async function capture(r: Rect, edit = false) {
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
      const comment = (capture: string) =>
        onComment({
          id: mintNoteId(file.path, "*", "*"),
          file: file.path,
          scope: "file",
          start: 0,
          end: 0,
          body: "",
          image: { ...r, side, source: file.hash, capture },
        });
      if (edit)
        await draw(`file:${file.hash}:${side}`, ref, async (next) => {
          comment(next);
        });
      else comment(ref);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setRect(null);
    }
  }
  const wholeImage = (): Rect => ({
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    imageWidth: size.width,
    imageHeight: size.height,
  });
  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto max-w-full select-none touch-none"
        style={{
          width: size.width
            ? Math.min(size.width, (384 * size.width) / size.height)
            : undefined,
        }}
        data-image-side={side}
      >
        <button
          type="button"
          className="block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Edit ${side === "old" ? "before" : "after"} image: ${file.path}`}
          disabled={blocked || busy || !size.width}
          onClick={(event) => {
            if (event.detail === 0) void capture(wholeImage(), true);
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              event.altKey ||
              blocked ||
              busy ||
              !size.width
            )
              return;
            event.preventDefault();
            press.current = point(event.clientX, event.clientY);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (press.current)
              setRect(region(point(event.clientX, event.clientY)));
          }}
          onPointerUp={(event) => {
            if (!press.current) return;
            const end = point(event.clientX, event.clientY);
            const clicked =
              Math.hypot(end.x - press.current.x, end.y - press.current.y) < 4;
            const r = clicked ? wholeImage() : region(end);
            press.current = null;
            if (!event.altKey) void capture(r, clicked);
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
            className="block h-auto w-full"
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
        </button>
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
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
