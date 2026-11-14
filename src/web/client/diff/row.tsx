import { useUi } from "../app/ui-preferences.tsx";
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { highlightCharacters } from "./selection.ts";
import { Bookmark, BookmarkCheck, MessageSquare } from "lucide-react";
import type { DiffFile } from "../../../shared/review-types.ts";
import { Code, languageFor } from "../components/code.tsx";
import { cn } from "../components/ui/button.tsx";
import { gapOf } from "./gaps.ts";

export function CodeRow({
  file,
  index,
  gutterStyle,
  selected,
  expanding,
  notes,
  onSelect,
  onExpand,
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
  gutterStyle: CSSProperties;
  selected: boolean;
  expanding: boolean;
  notes: number;
  onSelect: (extend: boolean) => void;
  onExpand: (direction: string) => void;
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
    const element = cell.current;
    if (!element || !changes) return;
    const group = row.t === "del" ? "lcr-word-del" : "lcr-word-add";
    const paint = (from?: number, to?: number) => {
      highlightCharacters(element, from, to, group);
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        const highlight = CSS.highlights.get(group);
        if (highlight) highlight.priority = -1;
      }
    };
    paint(changes[0], changes[1]);
    return () => paint();
  }, [changes?.[0], changes?.[1], row.t, row.text]);
  useLayoutEffect(() => {
    if (cell.current && !pressing)
      highlightCharacters(cell.current, characters?.ca, characters?.cb);
  }, [characters?.ca, characters?.cb, pressing, row.text]);
  useLayoutEffect(() => {
    if (cell.current)
      highlightCharacters(
        cell.current,
        undefined,
        undefined,
        "lcr-notes",
        noteCharacters,
      );
  }, [noteCharacters, row.text]);
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
        "group relative flex min-h-[26px] items-start font-mono text-xs",
        settings.wrapLines || row.t === "hunk"
          ? "w-full min-w-0"
          : "min-w-full w-max",
        row.t === "add" && "diff-add",
        row.t === "del" && "diff-del",
        row.t === "hunk" && "bg-muted/50 text-muted-foreground",
        selected && !characters && "!bg-primary/15",
      )}
      data-row-key={row.n != null ? `n${row.n}` : `o${row.o}`}
    >
      {row.t === "hunk" ? (
        <div className="flex min-h-[26px] w-full min-w-0 items-center gap-3 px-5">
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
          <div
            style={gutterStyle}
            className={cn(
              "flex shrink-0 self-stretch items-start",
              !settings.lineNumbers &&
                "sticky right-0 z-10 order-last -ml-16 w-16 rounded bg-popover shadow-sm opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            <button
              data-row-action={!settings.lineNumbers || undefined}
              className={cn(
                "flex h-[26px] shrink-0 select-none items-center text-muted-foreground hover:bg-primary/15 hover:text-primary",
                !settings.lineNumbers && "w-6 justify-center",
              )}
              aria-label={`Comment on line ${row.n ?? row.o}${row.t === "del" ? " before change" : ""}`}
              title="Comment on line (Shift to extend selection)"
              onClick={(e) => {
                if ((!settings.lineNumbers || e.detail === 0) && !e.altKey)
                  onSelect(e.shiftKey);
              }}
            >
              {settings.lineNumbers ? (
                <>
                  <span className="w-[var(--old-line-width)] shrink-0 pr-1 text-right">
                    {row.o}
                  </span>
                  <span className="w-[var(--new-line-width)] shrink-0 pr-1 text-right">
                    {row.n}
                  </span>
                </>
              ) : (
                <MessageSquare className="size-3.5" />
              )}
            </button>
            <button
              data-row-action
              aria-label={`Bookmark line ${row.n ?? row.o}`}
              aria-pressed={bookmarked}
              title={`${bookmarked ? "Remove bookmark from" : "Bookmark"} line ${row.n ?? row.o}`}
              className="flex h-[26px] w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-primary"
              onClick={onBookmark}
            >
              {bookmarked ? (
                <BookmarkCheck className="size-3.5 text-primary" />
              ) : (
                <Bookmark className="size-3 opacity-35" />
              )}
            </button>
            <span className="flex h-[26px] w-5 shrink-0 items-center justify-center">
              {notes > 0 && (
                <button
                  data-row-action
                  className="flex size-5 items-center justify-center text-primary"
                  aria-label={`Read ${notes} notes on line ${row.n ?? row.o}`}
                  title={`Read ${notes} notes`}
                  onClick={onRead}
                >
                  <MessageSquare className="size-3.5" />
                </button>
              )}
            </span>
          </div>
          <span
            aria-hidden="true"
            className="w-4 shrink-0 select-none text-center leading-[26px] opacity-60"
          >
            {row.t === "add" ? "+" : row.t === "del" ? "−" : ""}
          </span>
          <span
            ref={cell}
            data-code-cell
            className={cn(
              "min-h-[26px] flex-1 self-stretch pr-6 leading-[26px]",
              settings.wrapLines ? "min-w-0" : "min-w-4",
            )}
          >
            <Code
              value={row.text}
              language={languageFor(file.path)}
              className={
                settings.wrapLines
                  ? "whitespace-break-spaces [overflow-wrap:anywhere]"
                  : "whitespace-pre"
              }
            />
          </span>
        </>
      )}
    </div>
  );
}
