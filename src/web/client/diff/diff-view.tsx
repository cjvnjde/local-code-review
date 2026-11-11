import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type {
  DiffFile,
  DiffRow,
  ReviewComment,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { Button } from "../components/ui/button.tsx";
import { request } from "../app/api.ts";
import { NoteCard } from "../notes/note-card.tsx";
import type { Draft } from "../notes/composer.tsx";
import { makeComment, placeNote } from "./model.ts";
import { gapOf, insertContext, markTails } from "./gaps.ts";
import { FileHeader } from "./file-header.tsx";
import { FileMedia } from "./media.tsx";
import { CodeRow } from "./row.tsx";
import {
  diffItems,
  itemKey,
  readingAnchor,
  readingIndex,
  type ReadingAnchor,
} from "./reading-model.ts";

export interface DiffViewHandle {
  scrollToFile: (path: string) => void;
  scrollToNote: (note: ReviewNote) => void;
}

export function DiffView({
  files,
  notes,
  context,
  marks,
  onViewed,
  onComment,
  onCompose,
  onActiveChange,
  agent,
  ref,
}: {
  files: DiffFile[];
  notes: ReviewNote[];
  context: number;
  marks: Record<string, string>;
  onViewed: (path: string) => void;
  onComment: (comment: ReviewComment) => void;
  onCompose: (draft: Draft) => void;
  onActiveChange: (path: string) => void;
  agent: boolean;
  ref?: Ref<DiffViewHandle>;
}) {
  const sources = useMemo(
    () =>
      files.map((initial) => {
        const f = structuredClone(initial);
        markTails([f], context);
        return f;
      }),
    [files, context],
  );
  const [expanded, setExpanded] = useState<Record<string, DiffFile>>({});
  const prepared = useMemo(
    () =>
      sources.map((file) =>
        expanded[file.path]?.hash === file.hash ? expanded[file.path]! : file,
      ),
    [sources, expanded],
  );
  const [folds, setFolds] = useState<
    Record<string, { hash: string; folded: boolean }>
  >({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<{
    path: string;
    hash: string;
    from: number;
    to: number;
  } | null>(null);
  const [expanding, setExpanding] = useState("");
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<ReadingAnchor | null>(null);
  const activeHeader = useRef(-1);
  const pendingJump = useRef<{ path: string; note?: ReviewNote } | null>(null);
  const [jumpVersion, setJumpVersion] = useState(0);
  const folded = useCallback(
    (file: DiffFile) =>
      folds[file.path]?.hash === file.hash
        ? folds[file.path]!.folded
        : marks[file.path] === file.hash,
    [folds, marks],
  );
  const items = useMemo(
    () => diffItems(prepared, notes, { folded, removed, openRuns }),
    [prepared, notes, folded, removed, openRuns],
  );
  const appliedItems = useRef(items);
  const headers = useMemo(
    () =>
      items.flatMap((item, index) => (item.kind === "header" ? [index] : [])),
    [items],
  );
  const indexByKey = useMemo(
    () => new Map(items.map((item, i) => [item.key, i])),
    [items],
  );
  const frame = useRef(0);
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    getItemKey: useCallback((index: number) => items[index]!.key, [items]),
    estimateSize: (index) => {
      switch (items[index]!.kind) {
        case "header":
          return 58;
        case "tools":
          return 42;
        case "media":
          return 360;
        case "note":
          return 280;
        case "empty":
          return 100;
        default:
          return 26;
      }
    },
    overscan: 12,
    rangeExtractor: useCallback(
      (range) => {
        let lo = 0,
          hi = headers.length - 1,
          found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (headers[mid]! <= range.startIndex) {
            found = headers[mid]!;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        activeHeader.current = found;
        return [
          ...new Set([
            ...(found >= 0 ? [found] : []),
            ...defaultRangeExtractor(range),
          ]),
        ].sort((a, b) => a - b);
      },
      [headers],
    ),
    onChange: (instance) => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (appliedItems.current !== items || !scroll.current) return;
        const sticky =
          scroll.current.querySelector<HTMLElement>('[data-sticky="true"]')
            ?.offsetHeight || 0;
        const visible = instance.getVirtualItemForOffset(
          scroll.current.scrollTop + sticky + 1,
        );
        const item = visible && items[visible.index];
        if (item)
          anchor.current = readingAnchor(
            item,
            visible!.start - scroll.current.scrollTop,
          );
      });
    },
  });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const rendered = virtual.getVirtualItems();
  const active = items[activeHeader.current]?.path || files[0]?.path || "";
  useEffect(() => {
    if (active) onActiveChange(active);
  }, [active, onActiveChange]);

  function jump(path: string, note?: ReviewNote) {
    const file = prepared.find((entry) => entry.path === path);
    if (file)
      setFolds((current) => ({
        ...current,
        [path]: { hash: file.hash, folded: false },
      }));
    pendingJump.current = { path, note };
    setJumpVersion((value) => value + 1);
  }
  useImperativeHandle(ref, () => ({
    scrollToFile: (path) => jump(path),
    scrollToNote: (note) => jump(note.file, note),
  }));
  useLayoutEffect(() => {
    const target = pendingJump.current;
    if (target) {
      const index = indexByKey.get(
        itemKey(target.path, target.note ? `note:${target.note.id}` : "header"),
      );
      if (index != null) {
        anchor.current = null;
        virtual.scrollToIndex(index, {
          align: target.note ? "center" : "start",
        });
      }
      pendingJump.current = null;
    } else if (appliedItems.current !== items && anchor.current) {
      const keep = readingIndex(items, anchor.current);
      if (keep) {
        const item = virtual.measurementsCache[keep.index];
        if (item) virtual.scrollToOffset(Math.max(0, item.start - keep.offset));
      }
    }
    appliedItems.current = items;
  }, [items, jumpVersion, virtual, indexByKey]);

  async function expand(file: DiffFile, index: number) {
    const gap = gapOf(file, index);
    if (!gap || expanding) return;
    setExpanding(file.path);
    setError("");
    try {
      const end =
        gap.to == null ? gap.from + 19 : Math.min(gap.to, gap.from + 19);
      const result = await request<{ rows: DiffRow[] }>(
        `/api/context?${new URLSearchParams({ path: file.path, start: String(gap.from), end: String(end) })}`,
      );
      const next = structuredClone(file);
      insertContext(next, index, "down", result.rows, end - gap.from + 1);
      setExpanded((current) => ({ ...current, [file.path]: next }));
      setSelection(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExpanding("");
    }
  }
  function toggleFile(file: DiffFile) {
    setFolds((current) => ({
      ...current,
      [file.path]: { hash: file.hash, folded: !folded(file) },
    }));
  }
  function mark(file: DiffFile) {
    const value = marks[file.path] !== file.hash;
    setFolds((current) => ({
      ...current,
      [file.path]: { hash: file.hash, folded: value },
    }));
    onViewed(file.path);
  }
  const notesAt = useMemo(() => {
    const map = new Map<string, ReviewNote[]>();
    for (const file of prepared)
      for (const note of notes.filter((n) => n.file === file.path)) {
        const place = placeNote(file, note);
        if (place) {
          const key = itemKey(file.path, String(place.to));
          map.set(key, [...(map.get(key) || []), note]);
        }
      }
    return map;
  }, [prepared, notes]);
  return (
    <>
      {error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!files.length && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Working tree is clean. You can still leave an overall note.
        </div>
      )}
      <div
        ref={scroll}
        className="relative min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
        tabIndex={0}
        role="region"
        aria-label="Code diff"
      >
        <div
          className="relative min-w-full"
          style={{ height: virtual.getTotalSize() }}
        >
          {rendered.map((item) => {
            const entry = items[item.index]!;
            const sticky =
              entry.kind === "header" && item.index === activeHeader.current;
            return (
              <div
                key={item.key}
                ref={virtual.measureElement}
                data-index={item.index}
                data-file-path={entry.path}
                data-diff-kind={entry.kind}
                data-item-key={entry.key}
                data-sticky={sticky || undefined}
                className={
                  sticky
                    ? "sticky top-0 left-0 z-20 w-full"
                    : "absolute top-0 left-0 min-w-full"
                }
                style={
                  sticky
                    ? undefined
                    : {
                        transform: `translateY(${item.start}px)`,
                        ...(entry.kind !== "row" ? { width: "100%" } : {}),
                      }
                }
              >
                {entry.kind === "header" && (
                  <FileHeader
                    file={entry.file}
                    folded={folded(entry.file)}
                    viewed={marks[entry.path] === entry.file.hash}
                    onFold={() => toggleFile(entry.file)}
                    onViewed={() => mark(entry.file)}
                    onComment={() => onComment(makeComment(entry.file))}
                  />
                )}
                {entry.kind === "tools" && (
                  <div className="flex min-h-10 flex-wrap items-center gap-3 border-b bg-muted/20 px-5 text-xs text-muted-foreground">
                    {entry.file.from && (
                      <span className="truncate">
                        Renamed from {entry.file.from}
                      </span>
                    )}
                    {selection?.path === entry.path &&
                    selection.hash === entry.file.hash ? (
                      <>
                        <span>
                          Lines{" "}
                          {entry.file.rows[
                            Math.min(selection.from, selection.to)
                          ]?.n ??
                            entry.file.rows[
                              Math.min(selection.from, selection.to)
                            ]?.o}
                          –
                          {entry.file.rows[
                            Math.max(selection.from, selection.to)
                          ]?.n ??
                            entry.file.rows[
                              Math.max(selection.from, selection.to)
                            ]?.o}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            onComment(
                              makeComment(
                                entry.file,
                                selection.from,
                                selection.to,
                              ),
                            )
                          }
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
                        checked={removed[entry.path] || false}
                        onChange={(e) => {
                          setRemoved((current) => ({
                            ...current,
                            [entry.path]: e.target.checked,
                          }));
                          setOpenRuns(
                            (current) =>
                              new Set(
                                [...current].filter(
                                  (key) => JSON.parse(key)[0] !== entry.path,
                                ),
                              ),
                          );
                        }}
                      />
                      Fold removed lines
                    </label>
                  </div>
                )}
                {entry.kind === "media" && <FileMedia file={entry.file} />}
                {entry.kind === "empty" && (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    No text changes in this file.
                  </p>
                )}
                {entry.kind === "removed" && (
                  <button
                    className="flex h-[26px] w-full items-center gap-2 bg-muted/30 px-5 text-left text-xs text-muted-foreground hover:bg-accent"
                    disabled={entry.hasNotes}
                    onClick={() =>
                      setOpenRuns((current) => {
                        const next = new Set(current);
                        next.has(entry.key)
                          ? next.delete(entry.key)
                          : next.add(entry.key);
                        return next;
                      })
                    }
                  >
                    {entry.open ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {entry.open ? "Hide" : "Show"} {entry.to - entry.from + 1}{" "}
                    removed lines{entry.hasNotes && " · contains notes"}
                  </button>
                )}
                {entry.kind === "note" && (
                  <div className="mx-auto max-w-4xl px-5 py-3">
                    <NoteCard
                      note={entry.note}
                      file={entry.file}
                      agent={agent}
                      onCompose={onCompose}
                      inline
                    />
                  </div>
                )}
                {entry.kind === "row" && (
                  <CodeRow
                    file={entry.file}
                    index={entry.row}
                    selected={
                      !!selection &&
                      selection.path === entry.path &&
                      selection.hash === entry.file.hash &&
                      entry.row >= Math.min(selection.from, selection.to) &&
                      entry.row <= Math.max(selection.from, selection.to)
                    }
                    expanding={expanding === entry.path}
                    notes={
                      notesAt.get(itemKey(entry.path, String(entry.row)))
                        ?.length || 0
                    }
                    onSelect={(extend) =>
                      setSelection((current) => ({
                        path: entry.path,
                        hash: entry.file.hash,
                        from:
                          extend &&
                          current?.path === entry.path &&
                          current.hash === entry.file.hash
                            ? current.from
                            : entry.row,
                        to: entry.row,
                      }))
                    }
                    onExpand={() => void expand(entry.file, entry.row)}
                    onComment={onComment}
                    onRead={() =>
                      jump(
                        entry.path,
                        notesAt.get(
                          itemKey(entry.path, String(entry.row)),
                        )?.[0],
                      )
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
