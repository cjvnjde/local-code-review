import { useMemo, useState } from "react";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import {
  searchDocuments,
  searchReview,
  searchExcerpt,
  type SearchResult,
} from "./search-model.ts";
import { Button } from "../components/ui/button.tsx";

export function SearchResults({
  files,
  notes,
  onSelect,
  onClose,
}: {
  files: DiffFile[];
  notes: ReviewNote[];
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [limit, setLimit] = useState(100);
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
  return (
    <section
      aria-label="Search this review"
      className="absolute inset-0 z-30 flex flex-col bg-background"
    >
      <div className="flex items-center gap-3 border-b p-4">
        <input
          autoFocus
          aria-label="Search review"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(100);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && results[0]) onSelect(results[0]);
          }}
          placeholder="Search code, files, notes and replies…"
          className="h-10 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm"
        />
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
            className="block w-full space-y-2 rounded-lg border bg-card p-4 text-left hover:border-primary/50"
            onClick={() => onSelect(result)}
          >
            <span className="block text-xs text-primary">
              {result.path || "Overall"} · {result.label}
              {result.location && ` · ${result.location}`}
            </span>
            <span className="block whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {searchExcerpt(result.text, query, 240)}
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
      </div>
    </section>
  );
}
