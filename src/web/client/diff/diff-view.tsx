import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronDown,
  FileCode2,
  MessageSquarePlus,
  Plus,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import type {
  DiffFile,
  DiffRow,
  ReviewComment,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { Code, languageFor } from "../components/code.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { makeComment, placeNote } from "./model.ts";
import { request, useAction } from "../app/api.ts";
import { gapOf, insertContext, markTails } from "./gaps.ts";

export function DiffView({
  file: initial,
  notes,
  context,
  viewed,
  onViewed,
  onComment,
}: {
  file: DiffFile;
  notes: ReviewNote[];
  context: number;
  viewed: boolean;
  onViewed: () => void;
  onComment: (comment: ReviewComment) => void;
}) {
  const [file, setFile] = useState(() => {
    const f = structuredClone(initial);
    markTails([f], context);
    return f;
  });
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [foldRemoved, setFoldRemoved] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const action = useAction();
  const language = languageFor(file.path);
  const rows = useMemo(
    () =>
      file.rows.flatMap((row, index) =>
        foldRemoved && row.t === "del" ? [] : [{ row, index }],
      ),
    [file, foldRemoved],
  );
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 26,
    overscan: 18,
  });
  const markers = useMemo(() => {
    const map = new Map<number, number>();
    for (const note of notes) {
      const at = placeNote(file, note);
      if (at) map.set(at.to, (map.get(at.to) || 0) + 1);
    }
    return map;
  }, [file, notes]);
  async function expand(index: number) {
    const gap = gapOf(file, index);
    if (!gap || expanding) return;
    setExpanding(true);
    setError("");
    try {
      const end =
        gap.to == null ? gap.from + 19 : Math.min(gap.to, gap.from + 19);
      const result = await request<{ rows: DiffRow[] }>(
        `/api/context?${new URLSearchParams({ path: file.path, start: String(gap.from), end: String(end) })}`,
      );
      const next = structuredClone(file);
      insertContext(next, index, "down", result.rows, end - gap.from + 1);
      setFile(next);
      setSelection(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExpanding(false);
    }
  }
  const image = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|apng)$/i.test(
    file.path,
  );
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={`Diff for ${file.path}`}
    >
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b px-5 py-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <h2
          className="min-w-0 flex-1 truncate font-mono text-sm"
          title={file.path}
        >
          {file.path}
        </h2>
        <span className="text-xs text-emerald-500">+{file.added}</span>
        <span className="text-xs text-rose-500">−{file.removed}</span>
        <Button
          size="sm"
          variant={viewed ? "default" : "outline"}
          onClick={onViewed}
          aria-pressed={viewed}
        >
          <Check />
          Viewed
        </Button>
        <Tooltip label="Comment on file">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Comment on file"
            onClick={() => onComment(makeComment(file))}
          >
            <MessageSquarePlus />
          </Button>
        </Tooltip>
        <Tooltip label="Open in editor">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open in editor"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                url: "/api/open-file",
                method: "POST",
                body: { path: file.path },
              })
            }
          >
            <ExternalLink />
          </Button>
        </Tooltip>
      </div>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-b bg-muted/20 px-5 text-xs text-muted-foreground">
        {file.from && (
          <span className="truncate">Renamed from {file.from}</span>
        )}
        {selection ? (
          <>
            <span>
              Lines{" "}
              {Math.min(
                ...selection.map(
                  (i) => file.rows[i]?.n ?? file.rows[i]?.o ?? 0,
                ),
              )}
              –
              {Math.max(
                ...selection.map(
                  (i) => file.rows[i]?.n ?? file.rows[i]?.o ?? 0,
                ),
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onComment(makeComment(file, ...selection))}
            >
              <Plus />
              Comment on selection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelection(null)}
            >
              Clear
            </Button>
          </>
        ) : (
          <span>Select a line; Shift-click to select a range.</span>
        )}
        <label className="ml-auto flex items-center gap-2 py-2">
          <input
            type="checkbox"
            checked={foldRemoved}
            onChange={(e) => setFoldRemoved(e.target.checked)}
          />
          Hide removed lines
        </label>
      </div>
      {(error || action.error) && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error || action.error?.message}
        </p>
      )}
      <div
        ref={scroll}
        className="relative min-h-0 flex-1 overflow-auto"
        tabIndex={0}
        aria-label="Code diff"
      >
        {image && (
          <div className="grid gap-4 border-b p-5 md:grid-cols-2">
            {(["old", "new"] as const)
              .filter((side) =>
                side === "old"
                  ? file.status !== "added"
                  : file.status !== "deleted",
              )
              .map((side) => (
                <figure
                  key={side}
                  className="rounded-lg border bg-muted/20 p-3"
                >
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
        )}
        {file.binary && !image && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Binary file changed. Add a file comment to leave feedback.
          </div>
        )}
        {!file.binary && !rows.length && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No text changes in this file.
          </div>
        )}
        <div
          className="relative min-w-full w-max font-mono text-xs"
          style={{ height: virtual.getTotalSize() }}
        >
          {virtual.getVirtualItems().map((item) => {
            const { row, index } = rows[item.index]!;
            const selected =
              selection &&
              index >= Math.min(...selection) &&
              index <= Math.max(...selection);
            return (
              <div
                key={item.key}
                data-index={item.index}
                className={cn(
                  "absolute top-0 left-0 flex h-[26px] min-w-full items-center",
                  row.t === "add" && "diff-add",
                  row.t === "del" && "diff-del",
                  row.t === "hunk" && "bg-muted/50 text-muted-foreground",
                  selected &&
                    "!bg-primary/15 ring-1 ring-inset ring-primary/40",
                )}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.t === "hunk" ? (
                  <button
                    className="flex h-full w-full items-center gap-3 px-5 text-left hover:bg-accent"
                    disabled={expanding || !gapOf(file, index)}
                    onClick={() => void expand(index)}
                  >
                    {expanding ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    <span>{row.text || "More context"}</span>
                    {gapOf(file, index) && (
                      <span className="font-sans text-primary">
                        Expand 20 lines
                      </span>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      className="flex h-full shrink-0 select-none items-center text-muted-foreground hover:bg-primary/15"
                      aria-label={`Select line ${row.n ?? row.o}${row.t === "del" ? " before change" : ""}`}
                      onClick={(e) =>
                        setSelection((previous) => [
                          e.shiftKey && previous ? previous[0] : index,
                          index,
                        ])
                      }
                    >
                      <span className="w-12 pr-2 text-right">{row.o}</span>
                      <span className="w-12 pr-2 text-right">{row.n}</span>
                    </button>
                    <button
                      aria-label={`Comment on line ${row.n ?? row.o}`}
                      className="flex size-6 shrink-0 items-center justify-center text-primary opacity-40 hover:opacity-100 focus:opacity-100"
                      onClick={() => onComment(makeComment(file, index))}
                    >
                      {markers.has(index) ? (
                        <span className="rounded bg-primary px-1 font-sans text-[10px] text-primary-foreground">
                          {markers.get(index)}
                        </span>
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                    </button>
                    <span className="w-5 shrink-0 select-none text-center opacity-60">
                      {row.t === "add" ? "+" : row.t === "del" ? "−" : ""}
                    </span>
                    <Code
                      value={row.text || " "}
                      language={language}
                      className="pr-6 whitespace-pre"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
