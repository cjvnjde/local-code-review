import { useUi } from "../app/ui-preferences.tsx";
import { useEffect, useLayoutEffect, useRef } from "react";
import { highlightCharacters } from "./selection.ts";
import {
  ChevronDown,
  LoaderCircle,
  Plus,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";
import type { DiffFile, ReviewComment } from "../../../shared/review-types.ts";
import { Code, languageFor } from "../components/code.tsx";
import { cn } from "../components/ui/button.tsx";
import { makeComment } from "./model.ts";
import { gapOf } from "./gaps.ts";

export function CodeRow({
  file,
  index,
  selected,
  expanding,
  notes,
  onSelect,
  onExpand,
  onComment,
  onRead,
  bookmarked,
  onBookmark,
  changes,
  noteCharacters,
  characters,
  pressing,
}: {
  file: DiffFile;
  index: number;
  selected: boolean;
  expanding: boolean;
  notes: number;
  onSelect: (extend: boolean) => void;
  onExpand: (direction: string) => void;
  onComment: (comment: ReviewComment) => void;
  onRead: () => void;
  bookmarked?: boolean;
  onBookmark?: () => void;
  changes?: [number, number];
  noteCharacters?: { ca: number; cb: number }[];
  characters?: { ca: number; cb: number };
  pressing?: boolean;
}) {
  const row = file.rows[index]!;
  const { settings } = useUi();
  const cell = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (cell.current && !pressing)
      highlightCharacters(cell.current, characters?.ca, characters?.cb);
  }, [characters?.ca, characters?.cb, pressing]);
  useLayoutEffect(() => {
    if (cell.current)
      highlightCharacters(
        cell.current,
        undefined,
        undefined,
        "lcr-notes",
        noteCharacters,
      );
  }, [noteCharacters]);
  useEffect(() => {
    const element = cell.current;
    return () => {
      if (element) {
        highlightCharacters(element);
        highlightCharacters(element, undefined, undefined, "lcr-notes");
      }
    };
  }, []);
  return (
    <div
      className={cn(
        "flex h-[26px] min-w-full w-max items-center font-mono text-xs",
        row.t === "add" && "diff-add",
        row.t === "del" && "diff-del",
        row.t === "hunk" && "bg-muted/50 text-muted-foreground",
        selected &&
          !characters &&
          "!bg-primary/15 ring-1 ring-inset ring-primary/40",
      )}
      data-row-key={row.n != null ? `n${row.n}` : `o${row.o}`}
    >
      {row.t === "hunk" ? (
        <div className="flex h-full w-full items-center gap-3 px-5">
          <span className="truncate">{row.text || "More context"}</span>
          {gapOf(file, index) && (
            <div className="ml-auto flex shrink-0 gap-3 font-sans text-primary">
              {!(row as typeof row & { tail?: boolean }).tail && (
                <button disabled={expanding} onClick={() => onExpand("up")}>
                  ↑ {settings.expand}
                </button>
              )}
              <button disabled={expanding} onClick={() => onExpand("down")}>
                {expanding ? "Loading…" : `Expand ${settings.expand} lines`}
              </button>
              <button disabled={expanding} onClick={() => onExpand("all")}>
                All
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <button
            className="flex h-full shrink-0 select-none items-center text-muted-foreground hover:bg-primary/15"
            aria-label={`Select line ${row.n ?? row.o}${row.t === "del" ? " before change" : ""}`}
            onClick={(e) => {
              if (e.detail === 0 && !e.altKey) onSelect(e.shiftKey);
            }}
          >
            <span className="w-12 pr-2 text-right">{row.o}</span>
            <span className="w-12 pr-2 text-right">{row.n}</span>
          </button>
          <button
            data-row-action
            aria-label={`Comment on line ${row.n ?? row.o}`}
            className="flex size-6 shrink-0 items-center justify-center text-primary opacity-40 hover:opacity-100 focus:opacity-100"
            onClick={() => onComment(makeComment(file, index))}
          >
            <Plus className="size-3.5" />
          </button>
          <button
            data-row-action
            aria-label={`Bookmark line ${row.n ?? row.o}`}
            aria-pressed={bookmarked}
            className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-primary"
            onClick={onBookmark}
          >
            {bookmarked ? (
              <BookmarkCheck className="size-3.5 text-primary" />
            ) : (
              <Bookmark className="size-3 opacity-35" />
            )}
          </button>
          <span className="w-5 shrink-0 select-none text-center opacity-60">
            {row.t === "add" ? "+" : row.t === "del" ? "−" : ""}
          </span>
          {notes > 0 && (
            <button
              data-row-action
              className="mr-2 rounded bg-primary px-1 font-sans text-[10px] text-primary-foreground"
              aria-label={`Read ${notes} notes on line ${row.n ?? row.o}`}
              onClick={onRead}
            >
              {notes}
            </button>
          )}
          <span
            ref={cell}
            data-code-cell
            style={
              changes
                ? {
                    backgroundImage: `linear-gradient(to right, transparent ${changes[0]}ch, ${row.t === "del" ? "#f43f5e33" : "#22c55e33"} ${changes[0]}ch, ${row.t === "del" ? "#f43f5e33" : "#22c55e33"} ${changes[1]}ch, transparent ${changes[1]}ch)`,
                  }
                : undefined
            }
            className="inline-block min-w-4 flex-1 self-stretch pr-6 leading-[26px]"
          >
            <Code
              value={row.text || " "}
              language={languageFor(file.path)}
              className="whitespace-pre"
            />
          </span>
        </>
      )}
    </div>
  );
}
