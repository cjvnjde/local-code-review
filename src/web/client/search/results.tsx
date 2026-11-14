import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
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
  ref,
  onSelect,
  onClose,
}: {
  files: DiffFile[];
  notes: ReviewNote[];
  query: string;
  open: boolean;
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
        (result) => kind === "all" || result.kind === kind,
      ),
    [documents, query, kind],
  );
  useEffect(() => {
    setLimit(100);
    setSelected(0);
  }, [query, kind]);
  useEffect(() => {
    if (open) active.current?.scrollIntoView({ block: "nearest" });
  }, [open, selected, query, kind]);
  useImperativeHandle(ref, () => ({
    key(key) {
      if (key === "Escape") {
        onClose();
        return true;
      }
      if (key === "Enter" && results[selected]) {
        onSelect(results[selected]);
        return true;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        const next = results.length
          ? (selected + (key === "ArrowDown" ? 1 : -1) + results.length) %
            results.length
          : 0;
        setSelected(next);
        setLimit((current) => Math.max(current, next + 1));
        return true;
      }
      return false;
    },
  }));
  // Stay mounted so dismissing results never rebuilds the document index.
  if (!open) return null;
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
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <h2 className="text-sm font-medium">Search this review</h2>
        <Button variant="ghost" onClick={onClose}>
          Close search
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-b p-3">
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
            <span className="block text-xs text-primary">
              {result.path || "Overall"} · {result.label}
              {result.location && ` · ${result.location}`}
            </span>
            <span className="block whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {searchExcerpt(result.text, query, 240, result.ranges)}
            </span>
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
