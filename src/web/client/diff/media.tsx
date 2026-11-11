import type { DiffFile } from "../../../shared/review-types.ts";
import { isImage } from "./reading-model.ts";

export function FileMedia({ file }: { file: DiffFile }) {
  if (!isImage(file.path))
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
          <figure key={side} className="rounded-lg border bg-muted/20 p-3">
            <figcaption className="mb-3 text-xs text-muted-foreground">
              {side === "old" ? "Before" : "After"}
            </figcaption>
            <img
              className="mx-auto max-h-80 object-contain"
              src={`/api/blob?${new URLSearchParams({ side, path: file.path })}`}
              alt={`${side === "old" ? "Before" : "After"}: ${file.path}`}
            />
          </figure>
        ))}
    </div>
  );
}
