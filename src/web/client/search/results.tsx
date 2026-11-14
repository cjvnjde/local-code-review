import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import {
  searchDocuments,
  searchReview,
  searchExcerpt,
  type SearchResult,
} from "./search-model.ts";
import { Button } from "../components/ui/button.tsx";

export type SearchResultsHandle = {
  key: (key: string) => boolean;
};

export function SearchResults({
  files,
  notes,
  query,
  open,
  advanced,
  anchor,
  onAdvanced,
  onActiveChange,
  ref,
  onSelect,
  onClose,
}: {
  files: DiffFile[];
  notes: ReviewNote[];
  query: string;
  open: boolean;
  advanced: boolean;
  anchor: RefObject<HTMLDivElement | null>;
  onAdvanced: () => void;
  onActiveChange: (id: string | undefined) => void;
  ref?: Ref<SearchResultsHandle>;
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState("all");
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState(0);
  const active = useRef<HTMLButtonElement>(null);
  const documents = useMemo(
    () =>
      searchDocuments(
        files,
        notes,
        new Map(notes.map((note) => [note.id, note.messages])),
        new Map(
          notes.map((note) => [
            note.id,
            { status: note.status, detail: note.detail },
          ]),
        ),
      ),
    [files, notes],
  );
  const results = useMemo(
    () =>
      searchReview(documents, query).filter(
        (result) => !advanced || kind === "all" || result.kind === kind,
      ),
    [documents, query, kind, advanced],
  );
  useEffect(() => {
    setLimit(100);
    setSelected(0);
  }, [query, kind, advanced]);
  useEffect(() => {
    onActiveChange(
      open && !advanced && results[selected]
        ? `review-search-option-${selected}`
        : undefined,
    );
    if (open) active.current?.scrollIntoView({ block: "nearest" });
  }, [open, advanced, selected, query, kind, results, onActiveChange]);
  useImperativeHandle(ref, () => ({
    key(key) {
      if (key === "Escape") {
        onClose();
        return true;
      }
      if (key === "Enter") {
        onAdvanced();
        return true;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        const count = Math.min(results.length, advanced ? limit : 8);
        const next = count
          ? (selected + (key === "ArrowDown" ? 1 : -1) + count) % count
          : 0;
        setSelected(next);
        return true;
      }
      return false;
    },
  }));
  // Stay mounted so dismissing results never rebuilds the document index.
  if (!open) return null;
  const resultContent = (result: SearchResult) => (
    <>
      <span className="block text-xs text-primary">
        {result.path || "Overall"} · {result.label}
        {result.location && ` · ${result.location}`}
      </span>
      <span className="block whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
        {searchExcerpt(result.text, query, advanced ? 240 : 140, result.ranges)}
      </span>
    </>
  );
  if (!advanced) {
    if (!anchor.current) return null;
    return createPortal(
      <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-lg border bg-popover shadow-xl">
        <div
          id="review-search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          className="max-h-[min(60vh,32rem)] overflow-auto p-1"
        >
          {results.slice(0, 8).map((result, i) => (
            <button
              key={`${result.kind}:${i}`}
              id={`review-search-option-${i}`}
              role="option"
              aria-selected={selected === i}
              ref={i === selected ? active : undefined}
              className={`block w-full space-y-1 rounded-md p-3 text-left hover:bg-accent ${i === selected ? "bg-accent" : ""}`}
              onFocus={() => setSelected(i)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(result)}
            >
              {resultContent(result)}
            </button>
          ))}
          <p
            role="presentation"
            className="px-3 py-2 text-xs text-muted-foreground"
          >
            {!query.trim()
              ? "Search files, code, notes, and replies."
              : !results.length
                ? "No matching results."
                : `${results.length} results`}
          </p>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-between rounded-none border-t px-3 text-xs"
          onClick={onAdvanced}
        >
          Advanced search <kbd>Enter ↵</kbd>
        </Button>
      </div>,
      anchor.current,
    );
  }
  return (
    <section
      id="review-search-results"
      aria-label="Search this review"
      className="absolute inset-0 z-30 flex flex-col bg-background"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {["all", "file", "code", "note", "reply"].map((item) => (
          <Button
            key={item}
            size="sm"
            variant={kind === item ? "outline" : "ghost"}
            onClick={() => setKind(item)}
          >
            {item}
          </Button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {results.length} results
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close search"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
        {results.slice(0, limit).map((result, i) => (
          <button
            key={`${result.kind}:${i}`}
            ref={i === selected ? active : undefined}
            aria-current={i === selected ? "true" : undefined}
            className={`block w-full space-y-2 rounded-lg border bg-card p-4 text-left hover:border-primary/50 ${i === selected ? "border-primary" : ""}`}
            onFocus={() => setSelected(i)}
            onClick={() => onSelect(result)}
          >
            {resultContent(result)}
          </button>
        ))}
        {results.length > limit && (
          <Button variant="outline" onClick={() => setLimit(limit + 100)}>
            Show more
          </Button>
        )}
        {!query && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Search includes hidden files, unmounted code, captured code,
            statuses, and the entire conversation.
          </p>
        )}
        {query.trim() && !results.length && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No matching results.
          </p>
        )}
      </div>
    </section>
  );
}
