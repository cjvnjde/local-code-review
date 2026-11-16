import { Autocomplete } from "@base-ui/react/autocomplete";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import {
  searchDocuments,
  searchReview,
  searchExcerpt,
  matchesCodeFacet,
  type CodeFacet,
  type SearchResult,
} from "./search-model.ts";
import { Button } from "../components/ui/button.tsx";

/** Shared immutable index for the header suggestions and advanced results. */
export function useSearchResults(
  files: DiffFile[],
  notes: ReviewNote[],
  query: string,
) {
  const deferredQuery = useDeferredValue(query);
  const active = !!deferredQuery.trim();
  // Code only changes with the diff. A new note must not rebuild tens of
  // thousands of code documents, especially while search is unused.
  const codeDocuments = useMemo(
    () => (active ? searchDocuments(files, [], new Map(), new Map()) : []),
    [files, active],
  );
  const noteDocuments = useMemo(
    () =>
      active
        ? searchDocuments(
            [],
            notes,
            new Map(notes.map((note) => [note.id, note.messages])),
            new Map(
              notes.map((note) => [
                note.id,
                { status: note.status, detail: note.detail },
              ]),
            ),
          )
        : [],
    [notes, active],
  );
  const documents = useMemo(
    () => [...codeDocuments, ...noteDocuments],
    [codeDocuments, noteDocuments],
  );
  return useMemo(
    () => searchReview(documents, deferredQuery),
    [documents, deferredQuery],
  );
}

function ResultContent({
  result,
  query,
  advanced = false,
}: {
  result: SearchResult;
  query: string;
  advanced?: boolean;
}) {
  return (
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
}

/** A header-local portal preserves placement; Base UI owns list focus and navigation. */
export function SearchSuggestions({
  results,
  query,
  anchor,
  onSelect,
  onAdvanced,
}: {
  results: SearchResult[];
  query: string;
  anchor: RefObject<HTMLDivElement | null>;
  onSelect: (result: SearchResult) => void;
  onAdvanced: () => void;
}) {
  return (
    <Autocomplete.Portal container={anchor}>
      <Autocomplete.Positioner
        anchor={anchor}
        align="center"
        sideOffset={8}
        className="z-40 w-[var(--anchor-width)]"
      >
        <Autocomplete.Popup
          initialFocus={false}
          finalFocus={false}
          className="overflow-hidden rounded-lg border bg-popover shadow-xl"
        >
          <Autocomplete.List
            aria-label="Search suggestions"
            className="max-h-[min(60vh,32rem)] overflow-auto p-1"
          >
            {results.slice(0, 8).map((result, index) => (
              <Autocomplete.Item
                key={`${result.kind}:${index}`}
                value={result}
                index={index}
                className="block w-full cursor-pointer space-y-1 rounded-md p-3 text-left outline-none hover:bg-accent data-highlighted:bg-accent"
                onClick={() => onSelect(result)}
              >
                <ResultContent result={result} query={query} />
              </Autocomplete.Item>
            ))}
          </Autocomplete.List>
          <Autocomplete.Status className="px-3 py-2 text-xs text-muted-foreground">
            {!query.trim()
              ? "Search files, code, notes, and replies."
              : !results.length
                ? "No matching results."
                : `${results.length} results`}
          </Autocomplete.Status>
          <Button
            variant="ghost"
            className="w-full justify-between rounded-none border-t px-3 text-xs"
            onClick={onAdvanced}
          >
            Advanced search <kbd>Enter ↵</kbd>
          </Button>
        </Autocomplete.Popup>
      </Autocomplete.Positioner>
    </Autocomplete.Portal>
  );
}

export function SearchResults({
  results: allResults,
  query,
  open,
  onSelect,
  onClose,
}: {
  results: SearchResult[];
  query: string;
  open: boolean;
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState("all");
  const [facet, setFacet] = useState<CodeFacet>("all");
  const [limit, setLimit] = useState(100);
  const results = useMemo(
    () =>
      allResults.filter(
        (result) =>
          (kind === "all" || result.kind === kind) &&
          matchesCodeFacet(result, facet),
      ),
    [allResults, kind, facet],
  );
  useEffect(() => {
    setLimit(100);
  }, [query, kind, facet]);
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
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div
          role="group"
          aria-label="Result kind"
          className="flex flex-wrap gap-1"
        >
          {["all", "file", "code", "note", "reply"].map((item) => (
            <Button
              key={item}
              size="sm"
              aria-pressed={kind === item}
              variant={kind === item ? "outline" : "ghost"}
              onClick={() => setKind(item)}
            >
              {item}
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Code changes"
          className="flex flex-wrap gap-1"
        >
          {(["all", "added", "removed", "context"] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              aria-pressed={facet === item}
              variant={facet === item ? "outline" : "ghost"}
              onClick={() => setFacet(item)}
            >
              {item === "all" ? "All code" : item}
            </Button>
          ))}
        </div>
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
        {results.slice(0, limit).map((result, index) => (
          <button
            key={`${result.kind}:${index}`}
            className="block w-full space-y-2 rounded-lg border bg-card p-4 text-left hover:border-primary/50 focus-visible:border-primary"
            onClick={() => onSelect(result)}
          >
            <ResultContent result={result} query={query} advanced />
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
