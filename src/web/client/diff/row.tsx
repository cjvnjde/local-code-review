import { ChevronDown, LoaderCircle, Plus } from "lucide-react";
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
}: {
  file: DiffFile;
  index: number;
  selected: boolean;
  expanding: boolean;
  notes: number;
  onSelect: (extend: boolean) => void;
  onExpand: () => void;
  onComment: (comment: ReviewComment) => void;
  onRead: () => void;
}) {
  const row = file.rows[index]!;
  return (
    <div
      className={cn(
        "flex h-[26px] min-w-full w-max items-center font-mono text-xs",
        row.t === "add" && "diff-add",
        row.t === "del" && "diff-del",
        row.t === "hunk" && "bg-muted/50 text-muted-foreground",
        selected && "!bg-primary/15 ring-1 ring-inset ring-primary/40",
      )}
      data-row-key={row.n != null ? `n${row.n}` : `o${row.o}`}
    >
      {row.t === "hunk" ? (
        <button
          className="flex h-full w-full items-center gap-3 px-5 text-left hover:bg-accent"
          disabled={expanding || !gapOf(file, index)}
          onClick={onExpand}
        >
          {expanding ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <ChevronDown className="size-3" />
          )}
          <span>{row.text || "More context"}</span>
          {gapOf(file, index) && (
            <span className="font-sans text-primary">Expand 20 lines</span>
          )}
        </button>
      ) : (
        <>
          <button
            className="flex h-full shrink-0 select-none items-center text-muted-foreground hover:bg-primary/15"
            aria-label={`Select line ${row.n ?? row.o}${row.t === "del" ? " before change" : ""}`}
            onClick={(e) => onSelect(e.shiftKey)}
          >
            <span className="w-12 pr-2 text-right">{row.o}</span>
            <span className="w-12 pr-2 text-right">{row.n}</span>
          </button>
          <button
            aria-label={`Comment on line ${row.n ?? row.o}`}
            className="flex size-6 shrink-0 items-center justify-center text-primary opacity-40 hover:opacity-100 focus:opacity-100"
            onClick={() => onComment(makeComment(file, index))}
          >
            <Plus className="size-3.5" />
          </button>
          <span className="w-5 shrink-0 select-none text-center opacity-60">
            {row.t === "add" ? "+" : row.t === "del" ? "−" : ""}
          </span>
          {notes > 0 && (
            <button
              className="mr-2 rounded bg-primary px-1 font-sans text-[10px] text-primary-foreground"
              aria-label={`Read ${notes} notes on line ${row.n ?? row.o}`}
              onClick={onRead}
            >
              {notes}
            </button>
          )}
          <Code
            value={row.text || " "}
            language={languageFor(file.path)}
            className="pr-6 whitespace-pre"
          />
        </>
      )}
    </div>
  );
}
