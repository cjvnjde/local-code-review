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
    <details className="w-full rounded-lg border bg-card p-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {notes.length} notes from other reviews
      </summary>
      <div className="mt-3 space-y-3">
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
