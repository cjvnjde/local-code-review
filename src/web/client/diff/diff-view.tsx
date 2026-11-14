import { useUi } from "../app/ui-preferences.tsx";
import { bmKey } from "../navigation/bookmarks.ts";
import { rowKey } from "./model.ts";
import { wordDiff } from "./word-diff.ts";
import { useCodeSelection } from "./selection.ts";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual";
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
import { Composer, type Draft } from "../notes/composer.tsx";
import { makeComment, placeNote } from "./model.ts";
import { gapOf, insertContext, markTails, expandRange } from "./gaps.ts";
import { FileHeader } from "./file-header.tsx";
import { FileMedia } from "./media.tsx";
import { CodeRow } from "./row.tsx";
import {
  diffItems,
  itemKey,
  readingAnchor,
  readingIndex,
  type ReadingAnchor,
  type DiffItem,
} from "./reading-model.ts";

export interface DiffViewHandle {
  scrollToFile: (path: string) => void;
  scrollToNote: (note: ReviewNote) => void;
  scrollToRow: (path: string, row: string) => void;
  resumeReading: (place: ReadingAnchor) => void;
  focusEditor: () => void;
}

const isCodeItem = (item: DiffItem) =>
  item.kind === "row" && item.file.rows[item.row]!.t !== "hunk";

/** Include the pinned draft when recording the first unobscured reading position. */
function readingInset(element: HTMLElement) {
  const top = element.getBoundingClientRect().top;
  let inset = 0;
  for (const pinned of element.querySelectorAll<HTMLElement>(
    '[data-sticky="true"], [data-sticky-editor="true"]',
  )) {
    const bounds = pinned.getBoundingClientRect();
    if (bounds.top <= top + inset + 1)
      inset = Math.max(inset, bounds.bottom - top);
  }
  return inset;
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
  bookmarks,
  onBookmark,
  onReading,
  onAutoViewed,
  draft,
  onChangeDraft,
  onCloseDraft,
  onSavedDraft,
  onBusy,
  ref,
}: {
  files: DiffFile[];
  notes: ReviewNote[];
  context: number;
  marks: Record<string, string>;
  onViewed: (path: string) => void;
  onComment: (comment: ReviewComment) => boolean | void;
  onCompose: (draft: Draft) => void;
  onActiveChange: (path: string) => void;
  agent: boolean;
  onAutoViewed: (paths: string[], back?: string) => void;
  bookmarks: string[];
  onBookmark: (file: DiffFile, row: DiffRow) => void;
  onReading: (anchor: ReadingAnchor) => void;
  draft: Draft | null;
  onChangeDraft: (draft: Draft) => void;
  onCloseDraft: () => void;
  onSavedDraft: () => void;
  onBusy: (busy: boolean) => void;
  ref?: Ref<DiffViewHandle>;
}) {
  const { settings } = useUi();
  const manualTop = useRef({ top: 0, at: Date.now() });
  const lastScroll = useRef(0);
  const readStarted = useRef(new Map<string, number>());
  const manualUntil = useRef(0);
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const gutterStyles = useMemo(() => {
    const styles = new Map<string, CSSProperties>();
    for (const file of prepared) {
      let oldMax = 1;
      let newMax = 1;
      for (const row of file.rows) {
        oldMax = Math.max(oldMax, row.o ?? 0);
        newMax = Math.max(newMax, row.n ?? 0);
      }
      styles.set(file.path, {
        "--old-line-width": `calc(${String(oldMax).length}ch + 0.5rem)`,
        "--new-line-width": `calc(${String(newMax).length}ch + 0.5rem)`,
      } as CSSProperties);
    }
    return styles;
  }, [prepared]);
  const [folds, setFolds] = useState<
    Record<string, { hash: string; folded: boolean }>
  >({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const [expanding, setExpanding] = useState("");
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const fileScroll = useRef(new Map<string, FileScroll>());
  const { selection, pressed, select, clearSelection } = useCodeSelection(
    scroll,
    prepared,
    onComment,
  );
  const anchor = useRef<ReadingAnchor | null>(null);
  const pendingJump = useRef<{
    path: string;
    note?: ReviewNote;
    row?: string;
    reading?: ReadingAnchor;
  } | null>(null);
  const [jumpVersion, setJumpVersion] = useState(0);
  const folded = useCallback(
    (file: DiffFile) =>
      draft?.host !== "panel" &&
      (draft?.kind === "note" ? draft.comment.file : draft?.file) === file.path
        ? false
        : folds[file.path]?.hash === file.hash
          ? folds[file.path]!.folded
          : false,
    [
      folds,
      marks,
      draft?.kind,
      draft?.host,
      draft?.kind === "note" ? draft.comment.file : draft?.file,
    ],
  );
  const editorSubject = useMemo(
    () =>
      draft?.kind === "note" && draft.host !== "panel" && !draft.editing
        ? { ...draft.comment, body: "" }
        : undefined,
    [
      draft?.kind,
      draft?.host,
      draft?.editing,
      draft?.kind === "note" ? draft.comment.id : undefined,
    ],
  );
  const items = useMemo(
    () =>
      diffItems(prepared, notes, {
        folded,
        removed: Object.fromEntries(
          prepared.map((file) => [
            file.path,
            removed[file.path] ?? settings.foldDel,
          ]),
        ),
        openRuns,
        editor: editorSubject,
        horizontalScroll: !settings.wrapLines,
      }),
    [
      prepared,
      notes,
      folded,
      removed,
      openRuns,
      editorSubject,
      settings.foldDel,
      settings.wrapLines,
    ],
  );
  const editorIndex = items.findIndex(
    (item) =>
      item.kind === "editor" ||
      (item.kind === "note" &&
        draft?.host !== "panel" &&
        (draft?.kind === "note" ? draft.comment.id : draft?.id) ===
          item.note.id),
  );
  const stickyEditor =
    editorIndex >= 0 &&
    draft?.kind === "note" &&
    draft.host !== "panel" &&
    !draft.editing &&
    draft.comment.scope === "file" &&
    !draft.comment.image;
  const appliedItems = useRef(items);
  const headers = useMemo(
    () =>
      items.flatMap((item, index) => (item.kind === "header" ? [index] : [])),
    [items],
  );
  const headerEnds = useMemo(() => {
    const ends = new Map<number, number>();
    let header = -1;
    for (let index = 0; index < items.length; index++) {
      if (header >= 0 && items[index]!.path !== items[header]!.path) {
        ends.set(header, index);
        header = -1;
      }
      if (items[index]!.kind === "header") header = index;
    }
    if (header >= 0) ends.set(header, items.length);
    return ends;
  }, [items]);
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
        case "scrollbar":
          return fileScroll.current.get(items[index]!.path)?.scrollbar ?? 0;
        case "media":
          return 360;
        case "note":
          return 280;
        case "editor":
          return 360;
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
        return [
          ...new Set([
            ...(found >= 0 ? [found] : []),
            ...(editorIndex >= 0 ? [editorIndex] : []),
            ...(pressed
              ? items.flatMap((item, index) =>
                  item.kind === "row" &&
                  itemKey(item.path, String(item.row)) === pressed
                    ? [index]
                    : [],
                )
              : []),
            ...defaultRangeExtractor(range),
          ]),
        ].sort((a, b) => a - b);
      },
      [headers, editorIndex, pressed, items],
    ),
    onChange: (instance) => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (appliedItems.current !== items || !scroll.current) return;
        const sticky = readingInset(scroll.current);
        const visible = instance.getVirtualItemForOffset(
          scroll.current.scrollTop + sticky + 1,
        );
        const item = visible && items[visible.index];
        if (item)
          anchor.current = readingAnchor(
            item,
            visible!.start - scroll.current.scrollTop,
          );
        if (Date.now() < manualUntil.current && anchor.current && !pressed) {
          if (readingTimer.current) clearTimeout(readingTimer.current);
          const snapshot = { ...anchor.current };
          const top = scroll.current.scrollTop;
          const goingBack = top < lastScroll.current;
          lastScroll.current = top;
          const start = headers.map((index) => ({
            path: items[index]!.path,
            top: instance.measurementsCache[index]?.start || 0,
          }));
          const now = Date.now();
          const bottom = top + scroll.current.clientHeight;
          for (let i = 0; i < start.length; i++)
            if (
              start[i]!.top < bottom &&
              (start[i + 1]?.top ?? instance.getTotalSize()) > top &&
              !readStarted.current.has(start[i]!.path)
            )
              readStarted.current.set(start[i]!.path, now);
          const speed =
            (Math.abs(top - (manualTop.current.top || top)) /
              Math.max(1, Math.min(now - manualTop.current.at, 250))) *
            1000;
          manualTop.current = { top, at: now };
          const done = start
            .filter(
              (entry, i) =>
                readStarted.current.has(entry.path) &&
                (start[i + 1]?.top ?? instance.getTotalSize()) <= bottom + 2,
            )
            .map((entry) => entry.path);
          readingTimer.current = setTimeout(
            () => {
              onReading(snapshot);
              if (
                settings.auto &&
                !draft &&
                (!settings.limit || speed <= settings.limit)
              )
                onAutoViewed(
                  done.filter(
                    (path) =>
                      Date.now() -
                        (readStarted.current.get(path) ?? Date.now()) >
                      400,
                  ),
                  settings.back && goingBack ? snapshot.path : undefined,
                );
            },
            speed > (settings.limit || 1800) ? 2800 : 1300,
          );
        }
      });
    },
  });
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (readingTimer.current) clearTimeout(readingTimer.current);
    },
    [],
  );
  const rendered = virtual.getVirtualItems();
  const top = virtual.scrollOffset ?? 0;
  let activeHeader = -1;
  let lo = 0,
    hi = headers.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const index = headers[mid]!;
    if ((virtual.measurementsCache[index]?.start ?? Infinity) <= top) {
      activeHeader = index;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const active = items[activeHeader]?.path || files[0]?.path || "";
  useEffect(() => {
    if (active) onActiveChange(active);
  }, [active, onActiveChange]);

  function jump(
    path: string,
    note?: ReviewNote,
    row?: string,
    reading?: ReadingAnchor,
  ) {
    manualUntil.current = 0;
    readStarted.current.clear();
    if (readingTimer.current) clearTimeout(readingTimer.current);
    const file = prepared.find((entry) => entry.path === path);
    if (file)
      setFolds((current) => ({
        ...current,
        [path]: { hash: file.hash, folded: false },
      }));
    if (file && row) {
      const at = file.rows.findIndex((entry) => rowKey(entry) === row);
      if (at >= 0 && file.rows[at]!.t === "del") {
        let from = at;
        while (from > 0 && file.rows[from - 1]!.t === "del") from--;
        setOpenRuns(
          (current) =>
            new Set([
              ...current,
              itemKey(path, `removed:${rowKey(file.rows[from]!)}`),
            ]),
        );
      }
    }
    pendingJump.current = { path, note, row, reading };
    setJumpVersion((value) => value + 1);
  }
  useImperativeHandle(ref, () => ({
    scrollToFile: (path) => jump(path),
    scrollToNote: (note) => jump(note.file, note),
    scrollToRow: (path, row) => jump(path, undefined, row),
    resumeReading: (place) => jump(place.path, undefined, undefined, place),
    focusEditor: () => {
      if (editorIndex >= 0) {
        const viewport = scroll.current?.getBoundingClientRect();
        const pinned = scroll.current
          ?.querySelector<HTMLElement>('[data-sticky-editor="true"]')
          ?.getBoundingClientRect();
        const headerHeight =
          virtual.measurementsCache[activeHeader]?.size ?? 58;
        if (
          !stickyEditor ||
          !viewport ||
          !pinned ||
          pinned.top < viewport.top + headerHeight - 1 ||
          pinned.bottom > viewport.bottom
        )
          virtual.scrollToIndex(editorIndex, { align: "auto" });
        requestAnimationFrame(() =>
          scroll.current
            ?.querySelector<HTMLTextAreaElement>(
              "[data-review-editor] textarea",
            )
            ?.focus({ preventScroll: true }),
        );
      }
    },
  }));
  useLayoutEffect(() => {
    const target = pendingJump.current;
    if (target) {
      const resumed = target.reading && readingIndex(items, target.reading);
      const index = resumed
        ? resumed.index
        : indexByKey.get(
            itemKey(
              target.path,
              target.note ? `note:${target.note.id}` : target.row || "header",
            ),
          );
      if (index != null) {
        anchor.current = null;
        const measurement = virtual.measurementsCache[index];
        if (resumed && measurement && scroll.current) {
          const header = readingInset(scroll.current) || 58;
          const offset = Math.max(
            header,
            Math.min(resumed.offset, scroll.current.clientHeight - header),
          );
          virtual.scrollToOffset(Math.max(0, measurement.start - offset));
        } else
          virtual.scrollToIndex(index, {
            align: target.note || target.row ? "center" : "start",
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

  async function expand(file: DiffFile, index: number, direction = "down") {
    const gap = gapOf(file, index);
    if (!gap || expanding) return;
    setExpanding(file.path);
    setError("");
    try {
      const range = expandRange(gap, settings.expand, direction);
      const from = range.from,
        end = range.to ?? from + 99999;
      const result = await request<{ rows: DiffRow[] }>(
        `/api/context?${new URLSearchParams({ path: file.path, start: String(from), end: String(end) })}`,
      );
      const next = structuredClone(file);
      insertContext(next, index, direction, result.rows, end - from + 1);
      setExpanded((current) => ({ ...current, [file.path]: next }));
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
  const previousSubject = useRef("");
  const subject =
    draft?.host !== "panel"
      ? (draft?.kind === "note" ? draft.comment.id : draft?.id) || ""
      : "";
  useLayoutEffect(() => {
    if (!subject && previousSubject.current) clearSelection();
    if (subject && subject !== previousSubject.current && editorIndex >= 0) {
      virtual.scrollToIndex(editorIndex, { align: "auto" });
      requestAnimationFrame(() =>
        scroll.current
          ?.querySelector<HTMLTextAreaElement>("[data-review-editor] textarea")
          ?.focus({ preventScroll: true }),
      );
    }
    previousSubject.current = subject;
  }, [subject, editorIndex, virtual, clearSelection]);
  const editor =
    draft && draft.host !== "panel" ? (
      <Composer
        draft={draft}
        onChange={onChangeDraft}
        onClose={onCloseDraft}
        onSaved={onSavedDraft}
        agent={agent}
        onBusy={onBusy}
      />
    ) : null;
  const wordChanges = useMemo(
    () => new Map(prepared.map((file) => [file.path, wordDiff(file)])),
    [prepared],
  );
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
  const headerByPath = useMemo(
    () => new Map(headers.map((index) => [items[index]!.path, index])),
    [headers, items],
  );
  const codeFiles = new Map<string, VirtualItem[]>();
  for (const item of rendered) {
    const entry = items[item.index]!;
    if (
      entry.kind === "header" &&
      entry.file.rows.length &&
      !folded(entry.file)
    )
      codeFiles.set(entry.path, []);
    if (entry.kind === "row" || entry.kind === "scrollbar") {
      if (!codeFiles.has(entry.path)) codeFiles.set(entry.path, []);
      if (isCodeItem(entry)) codeFiles.get(entry.path)!.push(item);
    }
  }
  const renderItem = (item: VirtualItem, offset = 0) => {
    const entry = items[item.index]!;
    if (entry.kind === "header") {
      const end =
        virtual.measurementsCache[headerEnds.get(item.index)!]?.start ??
        virtual.getTotalSize();
      return (
        <div
          key={item.key}
          className="pointer-events-none absolute left-0 top-0 w-full"
          style={{
            top: item.start,
            height: Math.max(item.size, end - item.start),
          }}
        >
          {/* The file's full virtual extent bounds native sticky positioning. */}
          <div
            ref={virtual.measureElement}
            data-index={item.index}
            data-file-path={entry.path}
            data-diff-kind={entry.kind}
            data-item-key={entry.key}
            data-sticky={item.index === activeHeader || undefined}
            className="pointer-events-auto sticky top-0 z-20 w-full"
          >
            <FileHeader
              file={entry.file}
              folded={folded(entry.file)}
              viewed={marks[entry.path] === entry.file.hash}
              removed={removed[entry.path] ?? settings.foldDel}
              onRemoved={() => {
                setRemoved((current) => ({
                  ...current,
                  [entry.path]: !(current[entry.path] ?? settings.foldDel),
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
              blocked={!!draft}
              onFold={() => toggleFile(entry.file)}
              onViewed={() => mark(entry.file)}
              onComment={() => onComment(makeComment(entry.file))}
            />
          </div>
        </div>
      );
    }
    if (entry.kind === "editor" && stickyEditor) {
      const header = headerByPath.get(entry.path);
      if (header != null) {
        const end =
          virtual.measurementsCache[headerEnds.get(header)!]?.start ??
          virtual.getTotalSize();
        const headerHeight = virtual.measurementsCache[header]?.size ?? 58;
        return (
          <div
            key={item.key}
            className="pointer-events-none absolute left-0 w-full"
            style={{
              top: item.start,
              height: Math.max(item.size, end - item.start),
            }}
          >
            {/* Measure only the single editor, not its file-bounded sticky track. */}
            <div
              ref={virtual.measureElement}
              data-index={item.index}
              data-file-path={entry.path}
              data-diff-kind={entry.kind}
              data-item-key={entry.key}
              data-sticky-editor={header === activeHeader || undefined}
              className="pointer-events-auto sticky z-[15] w-full overflow-y-auto border-y border-primary/25 bg-card px-4 py-3 shadow-sm"
              style={{
                top: headerHeight,
                // Keep code visible while a growing draft scrolls within its own editor.
                maxHeight: Math.max(
                  120,
                  (virtual.scrollRect?.height ?? 800) - headerHeight - 104,
                ),
              }}
            >
              {editor}
            </div>
          </div>
        );
      }
    }
    return (
      <div
        key={item.key}
        ref={entry.kind === "scrollbar" ? undefined : virtual.measureElement}
        data-index={item.index}
        data-file-path={entry.path}
        data-diff-kind={entry.kind}
        data-row-index={entry.kind === "row" ? entry.row : undefined}
        data-item-key={entry.key}
        className={`absolute top-0 left-0 w-full min-w-0 ${isCodeItem(entry) || entry.kind === "scrollbar" ? "" : "z-10"}`}
        style={{
          transform: `translateY(${item.start - offset}px)`,
          ...(entry.kind === "scrollbar"
            ? { height: fileScroll.current.get(entry.path)?.scrollbar ?? 0 }
            : {}),
        }}
      >
        {entry.kind === "media" && (
          <FileMedia
            file={entry.file}
            notes={notes}
            onComment={onComment}
            onRead={(note) => jump(note.file, note)}
            blocked={!!draft}
          />
        )}
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
            {entry.open ? "Hide" : "Show"} {entry.to - entry.from + 1} removed
            lines{entry.hasNotes && " · contains notes"}
          </button>
        )}
        {entry.kind === "editor" && (
          <div className="border-y border-primary/25 bg-card px-4 py-3">
            {editor}
          </div>
        )}
        {entry.kind === "note" && (
          <div className="mx-auto max-w-4xl px-5 py-3">
            <NoteCard
              note={entry.note}
              file={entry.file}
              agent={agent}
              onCompose={onCompose}
              inline
              editorDraft={draft ?? undefined}
              editor={
                (draft?.kind === "note" ? draft.comment.id : draft?.id) ===
                entry.note.id
                  ? editor
                  : undefined
              }
            />
          </div>
        )}
        {entry.kind === "row" && (
          <CodeRow
            file={entry.file}
            index={entry.row}
            gutterStyle={gutterStyles.get(entry.path)!}
            selected={
              !!selection &&
              selection.path === entry.path &&
              selection.hash === entry.file.hash &&
              entry.row >= Math.min(selection.from, selection.to) &&
              entry.row <= Math.max(selection.from, selection.to)
            }
            expanding={expanding === entry.path}
            notes={
              notesAt.get(itemKey(entry.path, String(entry.row)))?.length || 0
            }
            noteCharacters={notesAt
              .get(itemKey(entry.path, String(entry.row)))
              ?.flatMap((note) => {
                if (note.ca == null || note.cb == null || !note.snippet)
                  return [];
                const text = entry.file.rows[entry.row]!.text;
                if (text.slice(note.ca, note.cb) === note.snippet)
                  return [{ ca: note.ca, cb: note.cb }];
                const at = text.indexOf(note.snippet);
                return at >= 0 && text.indexOf(note.snippet, at + 1) < 0
                  ? [{ ca: at, cb: at + note.snippet.length }]
                  : [];
              })}
            characters={
              selection?.path === entry.path &&
              selection.from === entry.row &&
              selection.to === entry.row &&
              selection.ca != null
                ? { ca: selection.ca, cb: selection.cb! }
                : undefined
            }
            pressing={pressed === itemKey(entry.path, String(entry.row))}
            onSelect={(extend) => select(entry.file, entry.row, extend)}
            bookmarked={bookmarks.includes(
              bmKey(entry.path, rowKey(entry.file.rows[entry.row]!)),
            )}
            onBookmark={() =>
              onBookmark(entry.file, entry.file.rows[entry.row]!)
            }
            changes={wordChanges.get(entry.path)?.get(entry.row)}
            onExpand={(direction) =>
              void expand(entry.file, entry.row, direction)
            }
            onRead={() =>
              jump(
                entry.path,
                notesAt.get(itemKey(entry.path, String(entry.row)))?.[0],
              )
            }
          />
        )}
      </div>
    );
  };
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
        className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [overflow-anchor:none]"
        tabIndex={0}
        role="region"
        aria-label="Code diff"
        onWheel={() => {
          manualUntil.current = Date.now() + 500;
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget)
            manualUntil.current = Date.now() + 30000;
        }}
        onPointerUp={() => {
          if (manualUntil.current > Date.now())
            manualUntil.current = Date.now() + 500;
        }}
        onTouchMove={() => {
          manualUntil.current = Date.now() + 500;
        }}
        onKeyDown={(event) => {
          if (
            [
              "PageDown",
              "PageUp",
              "Home",
              "End",
              "ArrowDown",
              "ArrowUp",
              " ",
            ].includes(event.key) &&
            event.target === event.currentTarget
          )
            manualUntil.current = Date.now() + 500;
        }}
      >
        <div
          className="relative w-full min-w-0"
          style={{ height: virtual.getTotalSize() }}
        >
          {rendered
            .filter((item) => !isCodeItem(items[item.index]!))
            .map((item) => renderItem(item))}
          {[...codeFiles].map(([path, code]) => {
            const header = headerByPath.get(path)!;
            const file = items[header]!;
            if (file.kind !== "header") return null;
            const start = virtual.measurementsCache[header]!.end;
            const end =
              virtual.measurementsCache[headerEnds.get(header)!]?.start ??
              virtual.getTotalSize();
            let memory = fileScroll.current.get(path);
            if (!memory || memory.hash !== file.file.hash) {
              memory = {
                hash: file.file.hash,
                width: 0,
                left: 0,
                scrollbar: 0,
              };
              fileScroll.current.set(path, memory);
            }
            return (
              <FileCodeViewport
                key={path}
                path={path}
                start={start}
                end={end}
                wrap={settings.wrapLines}
                memory={memory}
                onScrollbar={(size) => {
                  const index = indexByKey.get(itemKey(path, "scrollbar"));
                  if (index != null) virtual.resizeItem(index, size);
                }}
              >
                {code.map((item) => renderItem(item, start))}
              </FileCodeViewport>
            );
          })}
        </div>
      </div>
    </>
  );
}

interface FileScroll {
  hash: string;
  width: number;
  left: number;
  scrollbar: number;
}

/** Only code participates in horizontal scrolling; the review owns all vertical scrolling. */
function FileCodeViewport({
  path,
  start,
  end,
  wrap,
  memory,
  onScrollbar,
  children,
}: {
  path: string;
  start: number;
  end: number;
  wrap: boolean;
  memory: FileScroll;
  onScrollbar: (size: number) => void;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current!;
    element.scrollLeft = wrap ? 0 : memory.left;
  }, [memory, wrap]);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const inner = content.current!;
    const measure = () => {
      if (!wrap) {
        // Retain real DOM widths when their rows leave the virtual window.
        // This keeps the file's native scroll range stable without guessing text widths.
        for (const row of inner.children) {
          const code = row.firstElementChild as HTMLElement | null;
          if (code)
            memory.width = Math.max(
              memory.width,
              code.scrollWidth,
              code.offsetWidth,
            );
        }
        inner.style.minWidth = `${memory.width}px`;
      }
      const size = wrap ? 0 : element.offsetHeight - element.clientHeight;
      if (size !== memory.scrollbar) {
        memory.scrollbar = size;
        onScrollbar(size);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const row of inner.children)
      if (row.firstElementChild) observer.observe(row.firstElementChild);
    return () => observer.disconnect();
  });
  return (
    <div
      ref={viewport}
      role="region"
      aria-label={`Code for ${path}`}
      data-file-code-scroll={path}
      className="absolute left-0 w-full min-w-0"
      style={{
        top: start,
        height: Math.max(0, end - start),
        overflowX: wrap ? "hidden" : "auto",
        overflowY: "hidden",
      }}
      tabIndex={wrap ? undefined : 0}
      onScroll={(event) => {
        if (!wrap) memory.left = event.currentTarget.scrollLeft;
      }}
    >
      <div
        ref={content}
        className="relative w-full"
        style={{
          height: Math.max(0, end - start - (wrap ? 0 : memory.scrollbar)),
          minWidth: wrap ? undefined : memory.width,
        }}
      >
        {children}
      </div>
    </div>
  );
}
