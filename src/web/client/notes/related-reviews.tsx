import { History } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import { request, useAction } from "../app/api.ts";
import { useUi } from "../app/ui-preferences.tsx";
import { placeNote, makeComment } from "../diff/model.ts";
import { Markdown } from "../components/markdown.tsx";
import { Button } from "../components/ui/button.tsx";

export function RelatedReviews({
  file,
  blocked,
}: {
  file: DiffFile;
  blocked: boolean;
}) {
  const { settings } = useUi();
  const client = useQueryClient();
  const action = useAction();
  const saved = useQuery({
    queryKey: ["ghosts"],
    queryFn: () =>
      request<{
        ghosts: { file: string; range: string; notes: ReviewNote[] }[];
      }>("/api/ghosts"),
    enabled: settings.ghosts,
  });
  if (!settings.ghosts) return null;
  const notes =
    saved.data?.ghosts.flatMap((group) =>
      group.notes.flatMap((note) => {
        const place = placeNote(file, note);
        return place ? [{ note, place, source: group.file }] : [];
      }),
    ) || [];
  if (!notes.length) return null;
  return (
    <details className="shrink-0">
      <summary
        aria-label={`${notes.length} notes from other reviews`}
        title="Notes from other reviews"
        className="flex h-8 cursor-pointer list-none items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <History className="size-3.5" />
        <span>{notes.length}</span>
      </summary>
      <div className="absolute right-2 top-full z-30 mt-1 max-h-[min(32rem,70dvh)] w-112 max-w-[calc(100%_-_1rem)] space-y-3 overflow-auto rounded-md border bg-card p-3 shadow-xl">
        {notes.map(({ note, place, source }) => (
          <div key={`${source}:${note.id}`} className="space-y-3 border-t pt-3">
            <p className="text-[10px] text-muted-foreground">
              {source} · {note.label} · {note.status}
            </p>
            <Markdown body={note.body} file={file.path} captured={note.code} />
            {note.messages.map((message, i) => (
              <div key={i} className="border-l pl-3">
                <b className="text-[10px]">{message.role}</b>
                <Markdown
                  body={message.body}
                  file={file.path}
                  captured={note.code}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={blocked || action.isPending}
              onClick={() =>
                action.mutate(
                  {
                    url: "/api/import",
                    method: "POST",
                    body: {
                      from: { file: source, id: note.id },
                      comment: {
                        ...makeComment(file, place.from, place.to),
                        body: note.body,
                      },
                    },
                  },
                  {
                    onSuccess: () =>
                      void client.invalidateQueries({ queryKey: ["ghosts"] }),
                  },
                )
              }
            >
              Continue in this review
            </Button>
          </div>
        ))}
        {action.error && (
          <p role="alert" className="text-destructive">
            {action.error.message}
          </p>
        )}
      </div>
    </details>
  );
}
