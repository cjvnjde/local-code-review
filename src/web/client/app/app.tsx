import { Tabs } from "@base-ui/react/tabs";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { ReviewLayout, useMedia } from "../navigation/review-layout.tsx";
import { FileTree } from "../navigation/file-tree.tsx";
import { NoteMotion, useNoteMotion } from "../notes/note-motion.tsx";
import { NoteState, useReviewState } from "../notes/review-state.tsx";
import { setView } from "../navigation/ui-navigation.ts";
import { plainRefs, refOf } from "../notes/note-ref.ts";
import { noteKey } from "../../../shared/note-id.ts";
import {
  useReadingNavigation,
  NavigationLists,
  type ReviewBookmark,
} from "../navigation/review-navigation.tsx";
import { stepAt } from "../navigation/bookmarks.ts";
import {
  SearchResults,
  SearchSuggestions,
  useSearchResults,
} from "../search/results.tsx";
import type { SearchResult } from "../search/search-model.ts";
import { triageOptions } from "../notes/note-header.tsx";
import { fileHidden } from "../diff/filters.ts";
import { rowKey } from "../diff/model.ts";
import { Eye, EyeOff, ArrowUp, ArrowDown } from "lucide-react";
import { ReviewReferences } from "../notes/references.tsx";
import { useUi } from "./ui-preferences.tsx";
import { useThemes } from "./themes.tsx";
import { ImageScope } from "../components/images.tsx";
import { imageEditorOwner } from "../components/image-preview.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch,
  GitPullRequest,
  Search,
  Settings2,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
  MessageSquare,
  Plus,
  Sun,
  Moon,
  History as HistoryIcon,
  RefreshCw,
  Check,
  FileCode2,
  Circle,
  LoaderCircle,
} from "lucide-react";
import {
  useDiff,
  useReview,
  useAction,
  type DiffResponse,
  type ReviewResponse,
} from "./api.ts";
import { useStored } from "./preferences.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { ActionMenu, ActionMenuItem } from "../components/ui/action-menu.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { Select } from "../components/ui/select.tsx";
import { Dialog, DialogContent } from "../components/ui/dialog.tsx";
import { DiffView, type DiffViewHandle } from "../diff/diff-view.tsx";
import { makeComment, orderFiles } from "../diff/model.ts";
import { NoteCard } from "../notes/note-card.tsx";
import { Composer, draftChanged, type Draft } from "../notes/composer.tsx";
import { AgentActivity } from "./agent-activity.tsx";
import { ReviewTools } from "./review-tools.tsx";
import type { RoundNoteReference } from "../../../shared/review-rounds.ts";
import { toast } from "sonner";
import { useReplyNotifications } from "./notifications.tsx";
import { Settings, AgentPanel } from "./settings.tsx";
import { History, useHistoryCapture } from "../history/history.tsx";
import { EmbeddedReview, embedToken } from "../web-review/embedded.tsx";
import { VERSION } from "../../../version.ts";

export function App() {
  const diff = useDiff();
  const review = useReview();
  if (!diff.data)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-muted-foreground">
        <GitPullRequest className="size-8 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">
          Local code review
        </h1>
        {diff.error ? (
          <>
            <p role="alert">{diff.error.message}</p>
            <Button onClick={() => void diff.refetch()}>Retry</Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Reading Git changes…
          </p>
        )}
      </div>
    );
  if (embedToken)
    return (
      <ImageScope repo={diff.data.repo} read={diff.data.id || diff.data.range}>
        <EmbeddedReview diff={diff.data} review={review.data} />
      </ImageScope>
    );
  return (
    <ImageScope repo={diff.data.repo} read={diff.data.id || diff.data.range}>
      <Workspace
        key={`${diff.data.repo}:${diff.data.id || diff.data.range}`}
        diff={diff.data}
        review={review.data}
        error={diff.error?.message || review.error?.message || ""}
        onRefresh={() => {
          void diff.refetch();
          void review.refetch();
        }}
        refreshing={diff.isFetching || review.isFetching}
      />
    </ImageScope>
  );
}

const reviewFilename = (value: string) =>
  value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1);

function Workspace({
  diff: incomingDiff,
  review,
  error,
  onRefresh,
  refreshing,
}: {
  diff: DiffResponse;
  review?: ReviewResponse;
  error: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { settings, update } = useUi();
  const wideLayout = useMedia("(min-width: 1280px)");
  const notesInline = useMedia("(min-width: 960px)");
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [advancedSearch, setAdvancedSearch] = useState(false);
  const searchContainer = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [overallOpen, setOverallOpen] = useState(false);
  const overallContainer = useRef<HTMLDivElement>(null);
  const overallEditor = useRef<HTMLElement>(null);
  const pickingAttachment = useRef(false);
  const [diff, setDiff] = useState(incomingDiff);
  const diffView = useRef<DiffViewHandle>(null);
  const [roundTarget, setRoundTarget] = useState<RoundNoteReference | null>(
    null,
  );
  const navigation = useRef<HTMLElement>(null);
  const scope = `${diff.repo}:${diff.id ? `#${diff.id}` : diff.range}`;
  const noteState = useReviewState(scope);
  useReplyNotifications(review, scope, (note) => {
    jumpToNote(note);
    if (!notesInline) setNotesOpen(false);
  });
  const [bulkDelete, setBulkDelete] = useState<string[]>([]);
  const [draft, setDraft, storageError] = useStored<Draft | null>(
    `lcr:v2:draft:${scope}`,
    null,
  );
  const [marks, setMarks] = useStored<Record<string, string>>(
    `lcr:v2:viewed:${scope}`,
    {},
  );
  const autoViewed = useRef(new Map<string, string>());
  const { theme, toggleMode } = useThemes();
  const dark = theme.mode === "dark";
  const [navOpen, setNavOpen] = useStored("lcr:v2:sidebar", true);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [notesOpen, setNotesOpen] = useStored(
    "lcr:v2:notes-panel",
    notesInline,
  );
  const fileSidebarVisible = wideLayout ? navOpen : fileDrawerOpen;
  const [rightTab, setRightTab] = useStored<"notes" | "bookmarks">(
    "lcr:v2:right-tab",
    "notes",
    "session",
  );
  const [allNotes, setAllNotes] = useStored("lcr:v2:all-notes", true);
  const [filter, setFilter] = useStored<"all" | "open" | "resolved">(
    "lcr:v2:note-state-filter",
    "open",
  );
  const [triageFilter, setTriageFilter] = useStored(
    "lcr:v2:triage-filter",
    "all",
  );
  const [compactNotes, setCompactNotes] = useStored(
    "lcr:v2:compact-notes",
    true,
  );
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"settings" | "history" | "agent" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const action = useAction();
  const noteMotion = useNoteMotion(
    review,
    scope,
    action.isPending && action.variables?.url === "/api/review",
  );
  useHistoryCapture(diff, review);
  const pendingDiff = incomingDiff.files !== diff.files;
  useEffect(() => {
    if (!draft && !busy) setDiff(incomingDiff);
  }, [incomingDiff, draft, busy]);
  const [visibility, setVisibility] = useStored<Record<string, boolean>>(
    `lcr:v2:visibility:${scope}`,
    {},
  );
  function reveal(path: string, go: () => void) {
    const target = diff.files.find((file) => file.path === path);
    if (!target || !fileHidden(target, settings, visibility)) {
      go();
      return;
    }
    setVisibility((current) => ({ ...current, [path]: false }));
    requestAnimationFrame(() => requestAnimationFrame(go));
  }
  function jumpToFile(path: string) {
    reveal(path, () => diffView.current?.scrollToFile(path));
    setFileDrawerOpen(false);
  }
  function jumpToNote(
    note: import("../../../shared/review-types.ts").ReviewNote,
  ) {
    noteState.read(note);
    setRightTab("notes");
    if (noteState.resolved(note)) setFilter("all");
    if (triageFilter !== "all" && (note.triage || "") !== triageFilter)
      setTriageFilter("all");
    if (
      note.scope !== "global" &&
      !files.some((entry) => entry.path === note.file)
    ) {
      setExpandedNote(note.id);
      setAllNotes(true);
      setFilter("all");
      setNotesOpen(true);
    }
    const reference = refOf(note.id);
    if (reference) {
      followed.current = reference;
      setView("note", reference);
    }
    reveal(note.file, () => diffView.current?.scrollToNote(note));
  }
  useEffect(() => {
    if (
      !roundTarget ||
      !review ||
      reviewFilename(roundTarget.review) !== reviewFilename(review.file)
    )
      return;
    const note = review.notes.find((entry) => entry.id === roundTarget.noteId);
    if (note) jumpToNote(note);
    else
      toast.error("That conversation no longer exists in this saved review.");
    setRoundTarget(null);
  }, [review, roundTarget]);
  useEffect(() => {
    const pane = navigation.current,
      row = pane?.querySelector<HTMLElement>('button[aria-current="true"]');
    if (!pane || !row) return;
    const parent = pane.getBoundingClientRect(),
      rect = row.getBoundingClientRect();
    if (rect.top < parent.top + 16)
      pane.scrollTop += rect.top - parent.top - 16;
    else if (rect.bottom > parent.bottom - 16)
      pane.scrollTop += rect.bottom - parent.bottom + 16;
  }, [selected, navOpen]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (draft && (draftChanged(draft) || busy)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [draft, busy]);
  const files = useMemo(() => orderFiles(diff.files), [diff.files]);
  const visibleFiles = useMemo(
    () => files.filter((file) => !fileHidden(file, settings, visibility)),
    [
      files,
      settings.hide,
      settings.hideEnabled,
      settings.disabledHide,
      settings.hideDeleted,
      visibility,
    ],
  );
  const reading = useReadingNavigation(scope, files);
  const bookmarkAt = useRef(-1);
  const noteAt = useRef(-1);
  function jumpBookmark(bookmark: ReviewBookmark) {
    reveal(bookmark.file, () =>
      diffView.current?.scrollToRow(bookmark.file, bookmark.a),
    );
  }
  function stepBookmark(direction: number) {
    bookmarkAt.current = stepAt(
      reading.ordered.length,
      bookmarkAt.current,
      direction,
    );
    const target = reading.ordered[bookmarkAt.current];
    if (target) jumpBookmark(target.b);
  }
  const file = files.find((f) => f.path === selected) || files[0];
  const notes = review?.notes || [];
  const searchResults = useSearchResults(files, notes, search);
  const suggestions = useMemo(() => searchResults.slice(0, 8), [searchResults]);
  function selectSearchResult(result: SearchResult) {
    setSearchOpen(false);
    const note = notes.find((note) => note.id === result.noteId);
    if (note) {
      jumpToNote(note);
      setAllNotes(true);
      setNotesOpen(true);
      setFilter("all");
    } else if (result.row)
      reveal(result.path, () =>
        diffView.current?.scrollToRow(result.path, result.row!),
      );
    else jumpToFile(result.path);
  }
  function openAdvancedSearch() {
    setAdvancedSearch(true);
    setSearchOpen(true);
  }
  const overallDraft =
    draft?.host === "panel" &&
    draft.kind === "note" &&
    draft.comment.scope === "global" &&
    !draft.editing;
  useEffect(() => {
    if (!overallDraft || !overallOpen) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      const owner = target instanceof Element ? imageEditorOwner(target) : null;
      if (
        target instanceof Node &&
        !overallContainer.current?.contains(target) &&
        !(owner && overallEditor.current?.contains(owner)) &&
        !(
          target instanceof Element &&
          target.closest("[role=listbox], [role=tooltip], [role=menu]")
        )
      )
        setOverallOpen(false);
    };
    const blur = () => {
      // Native file dialogs do not expose a DOM focus target.
      if (!pickingAttachment.current) setOverallOpen(false);
    };
    const focus = () => {
      pickingAttachment.current = false;
    };
    const pickerDone = (event: Event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "file" &&
        overallEditor.current?.contains(event.target)
      )
        pickingAttachment.current = false;
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("change", pickerDone, true);
    document.addEventListener("cancel", pickerDone, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("change", pickerDone, true);
      document.removeEventListener("cancel", pickerDone, true);
    };
  }, [overallDraft, overallOpen]);
  const activeDraft =
    draft && (draft.kind === "note" ? draft.comment.id : draft.id);
  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          activeDraft === note.id ||
          ((triageFilter === "all" || (note.triage || "") === triageFilter) &&
            (!noteState.resolved(note) || filter !== "open")),
      ),
    [notes, noteState, filter, activeDraft, triageFilter],
  );
  const followed = useRef("");
  useEffect(() => {
    const follow = () => {
      const ref = new URLSearchParams(location.hash.slice(1)).get("note");
      if (!ref) {
        followed.current = "";
        return;
      }
      if (ref === followed.current) return;
      const matches = notes.filter((note) => note.id.endsWith(`|#${ref}`));
      if (matches.length !== 1) return;
      followed.current = ref;
      jumpToNote(matches[0]!);
      setAllNotes(true);
      setNotesOpen(true);
      setFilter("all");
      setSearch("");
      requestAnimationFrame(() =>
        document
          .getElementById(`note-${ref}`)
          ?.scrollIntoView({ block: "center" }),
      );
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [review?.notes]);

  const agent = { ...incomingDiff, ...review };
  const fileOrder = new Map(files.map((f, i) => [f.path, i]));
  const fileNotes = notes.filter((note) => note.file === file?.path);
  const scopedNotes = allNotes ? notes : fileNotes;
  const resolvedCount = scopedNotes.filter(noteState.resolved).length;
  const listed = notes
    .filter(
      (note) =>
        (draft?.host === "panel" &&
          (draft.kind === "note" ? draft.comment.id : draft.id) === note.id) ||
        ((allNotes || note.file === file?.path) &&
          (triageFilter === "all" || (note.triage || "") === triageFilter) &&
          (filter === "all" ||
            (filter === "resolved") === noteState.resolved(note))),
    )
    .sort(
      (a, b) =>
        (a.scope === "global" ? -1 : (fileOrder.get(a.file) ?? 1e9)) -
          (b.scope === "global" ? -1 : (fileOrder.get(b.file) ?? 1e9)) ||
        (a.scope === "file" ? -1 : a.start) -
          (b.scope === "file" ? -1 : b.start),
    );
  const viewed = files.filter((f) => marks[f.path] === f.hash).length;
  const progress = files.length ? Math.round((viewed / files.length) * 100) : 0;
  const open = notes.filter((note) => !noteState.resolved(note)).length;
  function stepNote(direction: number) {
    const targets = allNotes ? listed : notes;
    noteAt.current = stepAt(targets.length, noteAt.current, direction);
    const target = targets[noteAt.current];
    if (!target) return;
    setNotesOpen(true);
    setAllNotes(true);
    setFilter("all");
    setSearch("");
    jumpToNote(target);
    requestAnimationFrame(() =>
      document
        .getElementById(`note-${target.id.split("|#").at(-1)}`)
        ?.scrollIntoView({ block: "center" }),
    );
  }
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
        event.preventDefault();
        setSearchOpen(true);
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }
      if (typing || document.querySelector("dialog[open],[role=dialog]"))
        return;
      if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        stepBookmark(event.key === "ArrowUp" ? -1 : 1);
      }
      if ((event.altKey || allNotes) && ["KeyJ", "KeyK"].includes(event.code)) {
        event.preventDefault();
        stepNote(event.code === "KeyJ" ? 1 : -1);
      }
      if (event.altKey && event.code === "KeyC") {
        event.preventDefault();
        setAllNotes((current) => !current);
        setNotesOpen(true);
        setRightTab("notes");
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  function focusEditor() {
    setSearchOpen(false);
    if (draft?.host === "panel" && !overallDraft) {
      setRightTab("notes");
      setNotesOpen(true);
    }
    if (overallDraft) {
      requestAnimationFrame(() => {
        if (overallOpen)
          overallEditor.current
            ?.querySelector<HTMLTextAreaElement>("textarea")
            ?.focus({ preventScroll: true });
        else overallContainer.current?.querySelector("button")?.focus();
      });
    } else if (draft?.host === "panel") {
      const editor = document.querySelector<HTMLElement>(
        "[data-review-editor]",
      );
      editor?.scrollIntoView({ block: "nearest" });
      editor
        ?.querySelector<HTMLTextAreaElement>("textarea")
        ?.focus({ preventScroll: true });
    } else diffView.current?.focusEditor();
  }
  const compose = (next: Draft) => {
    if (busy) {
      focusEditor();
      return false;
    }
    if (draft) {
      const same =
        draft.kind === next.kind &&
        (draft.kind === "note"
          ? draft.comment.id ===
            (next as Extract<Draft, { kind: "note" }>).comment.id
          : draft.id === (next as Extract<Draft, { kind: "reply" }>).id &&
            draft.at === (next as Extract<Draft, { kind: "reply" }>).at);
      if (same) {
        if (draft.kind === "reply" && next.kind === "reply" && next.web)
          setDraft({ ...draft, web: next.web, webDraftId: next.webDraftId });
        focusEditor();
        return true;
      }
      const reaim =
        draft.kind === "note" &&
        next.kind === "note" &&
        !draft.editing &&
        !draft.comment.scope &&
        !next.comment.scope &&
        draft.comment.file === next.comment.file &&
        next.comment.start <= draft.comment.end &&
        next.comment.end >= draft.comment.start;
      if (reaim) {
        setDraft({
          ...next,
          host: draft.host,
          original: "",
          editing: false,
          comment: {
            ...next.comment,
            body: draft.comment.body,
            triage: draft.comment.triage,
          },
        });
        return true;
      }
      if (draftChanged(draft)) {
        focusEditor();
        return false;
      }
    }
    const known =
      next.kind === "note"
        ? notes.find((note) => note.id === next.comment.id)
        : notes.find((note) => note.id === next.id);
    const original =
      next.kind === "note"
        ? known?.body || ""
        : next.at
          ? known?.messages.find((message) => message.at === next.at)?.body ||
            ""
          : "";
    setSearchOpen(false);
    setDraft({
      ...next,
      host: next.host || "diff",
      original,
      originalTriage: known?.triage,
      editing: next.kind === "note" && !!known,
    });
    if (
      next.host === "panel" &&
      !(next.kind === "note" && next.comment.scope === "global" && !known)
    ) {
      setRightTab("notes");
      setNotesOpen(true);
    } else if (!notesInline) setNotesOpen(false);
    return true;
  };
  const closeDraft = () => {
    if (!busy) setDraft(null);
  };
  async function changeReview(name?: string, target?: RoundNoteReference) {
    if (busy || action.isPending || !review || (draft && draftChanged(draft))) {
      setDialog(null);
      focusEditor();
      return;
    }
    try {
      await action.mutateAsync({
        url: "/api/review",
        method: name ? "PUT" : "DELETE",
        ...(name ? { body: { file: name } } : {}),
      });
      setDraft(null);
      if (target) setRoundTarget(target);
      if (!name) {
        setMarks({});
        reading.reset();
      }
      setDialog(null);
    } catch {
      /* Show the server error without discarding the draft. */
    }
  }
  const icon = (label: string, content: React.ReactNode, click: () => void) => (
    <Tooltip label={label}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={click}>
        {content}
      </Button>
    </Tooltip>
  );
  return (
    <Autocomplete.Root
      items={suggestions}
      filteredItems={suggestions}
      itemToStringValue={(result) => result.text}
      value={search}
      onValueChange={(value, details) => {
        if (details.reason !== "item-press") setSearch(value);
      }}
      open={searchOpen && !!search.trim() && !advancedSearch}
      onOpenChange={(open) => {
        if (!advancedSearch) setSearchOpen(open);
      }}
      openOnInputClick
      autoHighlight="always"
    >
      <NoteMotion value={noteMotion}>
        <NoteState value={noteState}>
          <ReviewReferences
            notes={notes}
            files={files}
            followFile={jumpToFile}
            follow={(note) => {
              jumpToNote(note);
              setAllNotes(true);
              setNotesOpen(true);
            }}
          >
            <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
              <header className="relative z-30 flex h-12 shrink-0 items-center gap-1 border-b bg-card px-2 sm:gap-2 sm:px-3">
                {icon(
                  fileSidebarVisible
                    ? "Hide file sidebar"
                    : "Show file sidebar",
                  fileSidebarVisible ? <PanelLeftClose /> : <PanelLeft />,
                  () =>
                    wideLayout
                      ? setNavOpen(!navOpen)
                      : setFileDrawerOpen(!fileDrawerOpen),
                )}
                <div className="hidden size-7 items-center justify-center text-primary sm:flex">
                  <GitPullRequest className="size-4" />
                </div>
                <div className="mr-2 hidden shrink-0 xl:block">
                  <h1 className="text-sm font-semibold tracking-tight">
                    Local code review{" "}
                    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      v2
                    </span>
                  </h1>
                  <p className="text-[10px] text-muted-foreground">{VERSION}</p>
                </div>
                <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground 2xl:flex">
                  <GitBranch className="size-3.5" />
                  <span className="max-w-36 truncate">{diff.branch}</span>
                  <span className="opacity-40">/</span>
                  <span
                    className="max-w-48 truncate font-mono"
                    title={diff.range}
                  >
                    {diff.id || diff.range}
                  </span>
                </div>
                <Select
                  label="Select file"
                  className="h-8 w-9 shrink-0 gap-0 px-2 [&>span:first-child]:hidden xl:hidden"
                  value={file?.path || ""}
                  onValueChange={jumpToFile}
                  options={files.map((f) => ({ value: f.path, label: f.path }))}
                />
                <div
                  ref={searchContainer}
                  className="relative mx-auto min-w-0 max-w-xl flex-1"
                >
                  <label className="flex h-8 min-w-0 items-center gap-2 rounded-md border bg-background px-2 sm:px-3">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <Autocomplete.Input
                      ref={searchInput}
                      aria-label="Search review"
                      onFocus={() => {
                        if (!searchOpen) setAdvancedSearch(false);
                        setSearchOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) {
                          event.preventBaseUIHandler();
                          return;
                        }
                        if (event.key === "Enter") {
                          event.preventBaseUIHandler();
                          event.preventDefault();
                          event.stopPropagation();
                          openAdvancedSearch();
                        } else if (event.key === "Escape") {
                          event.preventBaseUIHandler();
                          event.preventDefault();
                          event.stopPropagation();
                          setSearchOpen(false);
                        }
                      }}
                      placeholder="Search review…"
                      className="h-full w-full min-w-0 bg-transparent text-xs outline-none"
                    />
                    <kbd className="hidden shrink-0 text-[10px] text-muted-foreground lg:inline">
                      ⌘/Ctrl K
                    </kbd>
                  </label>
                  <SearchSuggestions
                    results={searchResults}
                    query={search}
                    anchor={searchContainer}
                    onSelect={selectSearchResult}
                    onAdvanced={openAdvancedSearch}
                  />
                </div>
                <ReviewTools
                  hasWeb={!!diff.web}
                  onOpenNote={(note) => {
                    const name = reviewFilename(note.review);
                    if (name === reviewFilename(review?.file ?? ""))
                      setRoundTarget(note);
                    else void changeReview(name, note);
                  }}
                />
                <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                  {diff.web && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label="Open page"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          url: "/api/web",
                          method: "POST",
                          body: {},
                        })
                      }
                    >
                      <FileCode2 />
                      <span className="hidden sm:inline">Open page</span>
                    </Button>
                  )}
                  <div ref={overallContainer} className="relative">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!review || busy}
                      aria-label="Overall note"
                      aria-expanded={!!overallDraft && overallOpen}
                      onClick={() => {
                        if (overallDraft) {
                          if (overallOpen) setOverallOpen(false);
                          else {
                            setOverallOpen(true);
                            requestAnimationFrame(() =>
                              overallEditor.current
                                ?.querySelector<HTMLTextAreaElement>("textarea")
                                ?.focus({ preventScroll: true }),
                            );
                          }
                        } else if (
                          compose({
                            kind: "note",
                            host: "panel",
                            comment: makeComment(),
                          })
                        )
                          setOverallOpen(true);
                      }}
                    >
                      <Plus />
                      <span className="hidden sm:inline">Overall note</span>
                    </Button>
                    {overallDraft && draft && (
                      <section
                        ref={overallEditor}
                        hidden={!overallOpen}
                        onClickCapture={(event) => {
                          const target = event.target as Element;
                          pickingAttachment.current = !!target.closest(
                            '[aria-label="Attach file"], input[type=file]',
                          );
                        }}
                        aria-label="Overall note editor"
                        className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100dvh-112px)] w-[min(40rem,calc(100vw-24px))] overflow-auto rounded-xl shadow-xl max-sm:fixed max-sm:inset-x-3 max-sm:top-12 max-sm:mt-2 max-sm:w-auto"
                      >
                        <Composer
                          draft={draft}
                          draftStorageError={storageError}
                          onChange={setDraft}
                          onClose={closeDraft}
                          onSaved={() => setDraft(null)}
                          agent={!!agent.agent}
                          onBusy={setBusy}
                        />
                      </section>
                    )}
                  </div>
                  <div className="hidden sm:contents">
                    {icon("Review history", <HistoryIcon />, () =>
                      setDialog("history"),
                    )}
                    {icon(
                      dark ? "Light theme" : "Dark theme",
                      dark ? <Sun /> : <Moon />,
                      toggleMode,
                    )}
                    {icon("Settings", <Settings2 />, () =>
                      setDialog("settings"),
                    )}
                  </div>
                  <details
                    className="relative sm:hidden"
                    onClick={(event) => {
                      if ((event.target as Element).closest("button"))
                        event.currentTarget.open = false;
                    }}
                  >
                    <summary
                      aria-label="Review actions"
                      className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent [&::-webkit-details-marker]:hidden"
                    >
                      <Settings2 className="size-4" />
                    </summary>
                    <div className="absolute right-0 top-full z-40 mt-2 flex w-44 flex-col rounded-md border bg-card p-1 shadow-xl">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="justify-start"
                        onClick={() => setDialog("history")}
                      >
                        <HistoryIcon /> Review history
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="justify-start"
                        onClick={toggleMode}
                      >
                        {dark ? <Sun /> : <Moon />}
                        {dark ? "Light theme" : "Dark theme"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="justify-start"
                        onClick={() => setDialog("settings")}
                      >
                        <Settings2 /> Settings
                      </Button>
                    </div>
                  </details>
                  {icon(
                    notesOpen ? "Hide notes panel" : "Show notes panel",
                    notesOpen ? <PanelRightClose /> : <PanelRight />,
                    () => {
                      if (notesOpen && draft?.host === "panel" && !overallDraft)
                        focusEditor();
                      else setNotesOpen(!notesOpen);
                    },
                  )}
                </div>
              </header>
              {(error || storageError || action.error) && (
                <div
                  role="alert"
                  className="flex shrink-0 items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-xs text-destructive"
                >
                  <span className="flex-1">
                    {error || storageError || action.error?.message}
                  </span>
                  <Button size="sm" variant="ghost" onClick={onRefresh}>
                    Retry
                  </Button>
                </div>
              )}
              {pendingDiff && (
                <div
                  role="status"
                  className="border-b bg-primary/10 px-5 py-2 text-xs text-primary"
                >
                  Diff update waiting for the open editor to close.
                </div>
              )}
              <ReviewLayout
                navOpen={navOpen}
                fileDrawerOpen={fileDrawerOpen}
                notesOpen={notesOpen}
                files={
                  <aside
                    className="flex h-full min-w-0 flex-col bg-card max-xl:fixed max-xl:inset-y-12 max-xl:left-0 max-xl:z-40 max-xl:h-auto max-xl:w-72 max-xl:max-w-[calc(100vw-24px)] max-xl:border-r max-xl:shadow-xl"
                    aria-label="Changed files"
                  >
                    <div className="flex items-center justify-between border-b px-3 py-2 xl:hidden">
                      <span className="text-sm font-medium">Changed files</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setFileDrawerOpen(false)}
                      >
                        Close files
                      </Button>
                    </div>
                    <nav
                      ref={navigation}
                      className="min-h-0 flex-1 overflow-auto px-2 py-3"
                    >
                      <FileTree
                        files={files}
                        selected={file?.path || ""}
                        scope={scope}
                        marks={marks}
                        visibility={visibility}
                        onJump={jumpToFile}
                        onHide={(paths, hidden) => {
                          if (
                            draft &&
                            paths.includes(
                              draft.kind === "note"
                                ? draft.comment.file
                                : draft.file,
                            )
                          ) {
                            focusEditor();
                            return;
                          }
                          setVisibility((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              paths.map((path) => [path, hidden]),
                            ),
                          }));
                        }}
                        onViewed={(paths, viewed) =>
                          setMarks((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              paths.map((path) => [
                                path,
                                viewed
                                  ? files.find((file) => file.path === path)!
                                      .hash
                                  : "",
                              ]),
                            ),
                          }))
                        }
                      />
                      {!files.length && (
                        <p className="p-3 text-xs text-muted-foreground">
                          No matching files.
                        </p>
                      )}
                    </nav>
                    <Tooltip
                      label={`${progress}% viewed · ${reading.reading?.path || "No reading position yet"}`}
                    >
                      <button
                        type="button"
                        aria-label="Resume reading"
                        disabled={!reading.reading}
                        className="shrink-0 border-t p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                        onClick={() => {
                          const place = reading.reading;
                          if (place)
                            reveal(place.path, () =>
                              diffView.current?.resumeReading(place),
                            );
                        }}
                      >
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <p className="mt-2 truncate text-[10px] text-muted-foreground">
                          {reading.reading?.path || "No reading position yet"}
                        </p>
                      </button>
                    </Tooltip>
                  </aside>
                }
                notes={
                  <aside
                    className="flex h-full min-w-0 flex-col bg-muted/15 max-[960px]:fixed max-[960px]:inset-x-0 max-[960px]:top-12 max-[960px]:bottom-10 max-[960px]:z-20 max-[960px]:h-auto max-[960px]:w-full max-[960px]:bg-background"
                    aria-label="Review notes"
                  >
                    <Tabs.Root
                      value={rightTab}
                      onValueChange={(value) => {
                        if (value === "notes" || value === "bookmarks")
                          setRightTab(value);
                      }}
                      className="flex min-h-0 flex-1 flex-col"
                    >
                      <div className="flex shrink-0 items-center border-b px-3">
                        <Tabs.List
                          aria-label="Review sidebar"
                          className="flex flex-1 gap-4"
                        >
                          <Tabs.Tab
                            value="notes"
                            className="border-b-2 border-transparent py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-active:border-primary data-active:text-foreground"
                          >
                            Notes
                          </Tabs.Tab>
                          <Tabs.Tab
                            value="bookmarks"
                            className="border-b-2 border-transparent py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-active:border-primary data-active:text-foreground"
                          >
                            Bookmarks · {reading.ordered.length}
                          </Tabs.Tab>
                        </Tabs.List>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-[960px]:hidden"
                          onClick={() => {
                            if (draft?.host === "panel") focusEditor();
                            else setNotesOpen(false);
                          }}
                        >
                          Close
                        </Button>
                      </div>
                      <Tabs.Panel
                        value="notes"
                        keepMounted
                        className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
                      >
                        <div className="space-y-2 border-b px-3 py-3">
                          <h2 className="sr-only">Conversation</h2>
                          <div
                            className="flex items-center gap-1"
                            role="group"
                            aria-label="Note scope"
                          >
                            <Button
                              size="sm"
                              variant={allNotes ? "outline" : "ghost"}
                              aria-pressed={allNotes}
                              onClick={() => setAllNotes(true)}
                            >
                              All notes ({notes.length})
                            </Button>
                            <Button
                              size="sm"
                              variant={!allNotes ? "outline" : "ghost"}
                              aria-pressed={!allNotes}
                              disabled={!file}
                              onClick={() => setAllNotes(false)}
                            >
                              This file ({fileNotes.length})
                            </Button>
                            <div className="ml-auto flex">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Previous note"
                                disabled={!listed.length}
                                onClick={() => stepNote(-1)}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Next note"
                                disabled={!listed.length}
                                onClick={() => stepNote(1)}
                              >
                                <ArrowDown />
                              </Button>
                            </div>
                          </div>
                          {!allNotes && file && (
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={file.path}
                            >
                              {file.path}
                            </p>
                          )}
                          <div className="flex items-center gap-1">
                            <div
                              className="flex flex-1 gap-1"
                              role="group"
                              aria-label="Note state"
                            >
                              {(["all", "open", "resolved"] as const).map(
                                (kind) => (
                                  <Button
                                    key={kind}
                                    size="sm"
                                    variant={
                                      filter === kind ? "outline" : "ghost"
                                    }
                                    aria-pressed={filter === kind}
                                    onClick={() => {
                                      setFilter(kind);
                                    }}
                                  >
                                    {kind === "all"
                                      ? "All"
                                      : kind === "open"
                                        ? "Open"
                                        : "Resolved"}
                                    <span className="text-muted-foreground">
                                      {kind === "all"
                                        ? scopedNotes.length
                                        : kind === "open"
                                          ? scopedNotes.length - resolvedCount
                                          : resolvedCount}
                                    </span>
                                  </Button>
                                ),
                              )}
                            </div>
                            <ActionMenu
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Note view and actions"
                                >
                                  View
                                </Button>
                              }
                            >
                              <ActionMenuItem
                                onClick={() => setCompactNotes(true)}
                                disabled={draft?.host === "panel"}
                              >
                                Compact list{compactNotes && <Check />}
                              </ActionMenuItem>
                              <ActionMenuItem
                                onClick={() => setCompactNotes(false)}
                                disabled={draft?.host === "panel"}
                              >
                                Full conversations{!compactNotes && <Check />}
                              </ActionMenuItem>
                              <ActionMenuItem
                                disabled={
                                  !!draft ||
                                  !notes.some(
                                    (note) => note.status === "applied",
                                  )
                                }
                                onClick={() =>
                                  setBulkDelete(
                                    notes
                                      .filter(
                                        (note) => note.status === "applied",
                                      )
                                      .map((note) => note.id),
                                  )
                                }
                              >
                                Remove applied notes
                              </ActionMenuItem>
                              <ActionMenuItem
                                className="text-destructive"
                                disabled={!!draft || !notes.length}
                                onClick={() =>
                                  setBulkDelete(notes.map((note) => note.id))
                                }
                              >
                                Clear notes
                              </ActionMenuItem>
                            </ActionMenu>
                          </div>
                          <Select
                            label="Filter notes by triage"
                            value={triageFilter}
                            onValueChange={setTriageFilter}
                            options={[
                              { value: "all", label: "All labels" },
                              ...triageOptions,
                            ]}
                          />
                        </div>
                        {bulkDelete.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 border-b p-3 text-xs">
                            <span>
                              Delete {bulkDelete.length} notes from this review?
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setBulkDelete([])}
                            >
                              Keep notes
                            </Button>
                            <Button
                              size="sm"
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate(
                                  {
                                    url: `/api/note?${new URLSearchParams(bulkDelete.map((id) => ["id", id]))}`,
                                    method: "DELETE",
                                  },
                                  { onSuccess: () => setBulkDelete([]) },
                                )
                              }
                            >
                              Delete notes
                            </Button>
                          </div>
                        )}
                        <div
                          className={cn(
                            "min-h-0 flex-1 overflow-auto p-3",
                            compactNotes ? "space-y-2" : "space-y-4",
                          )}
                          role={compactNotes ? "list" : undefined}
                          aria-label={
                            compactNotes
                              ? "Compact conversation notes"
                              : undefined
                          }
                        >
                          {listed.map((note) => {
                            const noteFile = files.find(
                              (file) => file.path === note.file,
                            );
                            const inDiff =
                              note.scope === "global" || !!noteFile;
                            const label = noteKey(note);
                            return (
                              <div
                                key={note.id}
                                role={compactNotes ? "listitem" : undefined}
                              >
                                {compactNotes &&
                                expandedNote !== note.id &&
                                !(
                                  draft?.host === "panel" &&
                                  activeDraft === note.id
                                ) ? (
                                  <button
                                    type="button"
                                    className="w-full min-w-0 rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    id={`note-${note.id.split("|#").at(-1)}`}
                                    data-note-id={note.id}
                                    aria-label={
                                      inDiff
                                        ? `In diff: ${label}`
                                        : `Open conversation: ${label}`
                                    }
                                    onClick={() => {
                                      if (inDiff) {
                                        jumpToNote(note);
                                        if (!notesInline) setNotesOpen(false);
                                      } else {
                                        noteState.read(note);
                                        setExpandedNote(note.id);
                                        requestAnimationFrame(() =>
                                          document
                                            .getElementById(
                                              `note-${note.id.split("|#").at(-1)}`,
                                            )
                                            ?.scrollIntoView({
                                              block: "center",
                                            }),
                                        );
                                      }
                                    }}
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span
                                        className="min-w-0 flex-1 truncate text-xs font-medium"
                                        title={label}
                                      >
                                        {label}
                                      </span>
                                      {note.triage && (
                                        <span className="shrink-0 rounded border px-1 text-xs">
                                          {note.triage}
                                        </span>
                                      )}
                                      {noteState.unread(note) > 0 && (
                                        <span className="shrink-0 text-xs text-primary">
                                          {noteState.unread(note)} new
                                        </span>
                                      )}
                                      <span className="shrink-0 text-xs text-muted-foreground">
                                        {noteState.resolved(note)
                                          ? "Resolved"
                                          : "Open"}
                                      </span>
                                    </span>
                                    <span className="mt-1 line-clamp-2 whitespace-normal break-words text-xs text-muted-foreground">
                                      {plainRefs(note.body).replace(
                                        /[*_`#>]/g,
                                        "",
                                      ) ||
                                        (note.web
                                          ? "Captured page feedback"
                                          : "No written feedback")}
                                    </span>
                                    {note.messages.length > 0 && (
                                      <span className="mt-2 block text-xs text-muted-foreground">
                                        {note.messages.length}{" "}
                                        {note.messages.length === 1
                                          ? "reply"
                                          : "replies"}
                                      </span>
                                    )}
                                    {!inDiff && (
                                      <span className="mt-1 block text-xs text-muted-foreground">
                                        {note.scope === "global"
                                          ? "Open conversation"
                                          : "File no longer in diff · Open conversation"}
                                      </span>
                                    )}
                                  </button>
                                ) : (
                                  <div className="space-y-2">
                                    {compactNotes &&
                                      expandedNote === note.id && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          disabled={draft?.host === "panel"}
                                          onClick={() => setExpandedNote(null)}
                                        >
                                          Back to note list
                                        </Button>
                                      )}
                                    <NoteCard
                                      note={note}
                                      file={noteFile}
                                      agent={!!agent.agent}
                                      editorDraft={draft ?? undefined}
                                      onCompose={(next) =>
                                        compose({ ...next, host: "panel" })
                                      }
                                      editor={
                                        draft?.host === "panel" &&
                                        (draft.kind === "note"
                                          ? draft.comment.id
                                          : draft.id) === note.id ? (
                                          <Composer
                                            draft={draft}
                                            draftStorageError={storageError}
                                            onChange={setDraft}
                                            onClose={closeDraft}
                                            onSaved={() => setDraft(null)}
                                            agent={!!agent.agent}
                                            onBusy={setBusy}
                                          />
                                        ) : undefined
                                      }
                                      onJump={
                                        inDiff
                                          ? () => {
                                              jumpToNote(note);
                                              if (!notesInline)
                                                setNotesOpen(false);
                                            }
                                          : undefined
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {!listed.length && (
                            <div className="px-4 py-12 text-center">
                              <MessageSquare className="mx-auto mb-4 size-6 text-muted-foreground/50" />
                              <p className="text-sm font-medium">
                                {!notes.length
                                  ? "Start your review"
                                  : !allNotes && !fileNotes.length
                                    ? "No notes for this file"
                                    : filter === "resolved"
                                      ? "No resolved notes"
                                      : filter === "open"
                                        ? "No open notes"
                                        : "No matching notes"}
                              </p>
                              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {!notes.length
                                  ? "Comment on a code line or add an overall note. Your review is saved to Markdown."
                                  : !allNotes
                                    ? `${notes.length} ${notes.length === 1 ? "note is" : "notes are"} available across this review.`
                                    : filter === "resolved"
                                      ? "Resolve a conversation when you have finished reviewing it. Resolution is saved in this browser."
                                      : "Change the state filter to see your other conversations."}
                              </p>
                              {notes.length > 0 && !allNotes && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="mt-4"
                                  onClick={() => setAllNotes(true)}
                                >
                                  Show all notes
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </Tabs.Panel>
                      <Tabs.Panel
                        value="bookmarks"
                        keepMounted
                        className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
                      >
                        <NavigationLists
                          navigation={reading}
                          onJump={jumpBookmark}
                          onStep={stepBookmark}
                        />
                      </Tabs.Panel>
                    </Tabs.Root>
                  </aside>
                }
              >
                <main className="relative flex h-full min-w-0 flex-col">
                  <SearchResults
                    query={search}
                    open={searchOpen && advancedSearch}
                    results={searchResults}
                    onClose={() => setSearchOpen(false)}
                    onSelect={selectSearchResult}
                  />
                  <DiffView
                    ref={diffView}
                    files={visibleFiles}
                    bookmarks={reading.bookmarks.map(
                      (bookmark) => bookmark.key,
                    )}
                    onBookmark={reading.toggle}
                    onReading={reading.setReading}
                    onAutoViewed={(paths, back) =>
                      setMarks((current) => {
                        const next = { ...current };
                        let changed = false;
                        for (const path of paths) {
                          const hash = files.find(
                            (file) => file.path === path,
                          )?.hash;
                          if (hash && next[path] !== hash) {
                            next[path] = hash;
                            autoViewed.current.set(path, hash);
                            changed = true;
                          }
                        }
                        if (
                          back &&
                          autoViewed.current.has(back) &&
                          next[back] === autoViewed.current.get(back)
                        ) {
                          next[back] = "";
                          autoViewed.current.delete(back);
                          changed = true;
                        }
                        return changed ? next : current;
                      })
                    }
                    context={diff.context}
                    notes={visibleNotes}
                    marks={marks}
                    onViewed={(path) => {
                      autoViewed.current.delete(path);
                      setMarks((current) => ({
                        ...current,
                        [path]:
                          current[path] ===
                          files.find((file) => file.path === path)?.hash
                            ? ""
                            : files.find((file) => file.path === path)!.hash,
                      }));
                    }}
                    onActiveChange={setSelected}
                    onComment={(comment) => compose({ kind: "note", comment })}
                    onCompose={(next) => compose({ ...next, host: "diff" })}
                    agent={!!agent.agent}
                    draft={draft}
                    draftStorageError={storageError}
                    onChangeDraft={setDraft}
                    onCloseDraft={closeDraft}
                    onSavedDraft={() => setDraft(null)}
                    onBusy={setBusy}
                  />
                </main>
              </ReviewLayout>
              <footer className="flex h-10 shrink-0 items-center gap-3 overflow-hidden border-t bg-card px-3 text-[11px] text-muted-foreground">
                <span className="flex shrink-0 items-center gap-2">
                  <Circle
                    aria-label="Local review"
                    className="size-2 fill-success text-success"
                  />
                  {files.length}{" "}
                  <span className="hidden sm:inline">changed</span> files
                </span>
                <span className="shrink-0 text-diff-add-foreground">
                  +{files.reduce((sum, f) => sum + f.added, 0)}
                </span>
                <span className="shrink-0 text-diff-del-foreground">
                  −{files.reduce((sum, f) => sum + f.removed, 0)}
                </span>
                <span className="hidden sm:inline">
                  {open} open · {notes.length - open} resolved ·{" "}
                  {notes.reduce(
                    (count, note) => count + noteState.unread(note),
                    0,
                  )}{" "}
                  unread
                </span>
                <span
                  className="ml-auto min-w-0 max-w-[30vw] truncate font-mono"
                  title={review?.file}
                >
                  {review?.file || "First save creates a Markdown review"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setDialog("agent")}
                >
                  {agent.agent ? (
                    <AgentActivity agent={agent} />
                  ) : (
                    "Set up agent"
                  )}
                </Button>
                <Tooltip label="Refresh review">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label="Refresh review"
                    disabled={refreshing}
                    onClick={onRefresh}
                  >
                    <RefreshCw
                      className={
                        refreshing ? "size-3.5 animate-spin" : "size-3.5"
                      }
                    />
                  </Button>
                </Tooltip>
              </footer>
              <Dialog
                open={dialog !== null}
                onOpenChange={(isOpen) => {
                  if (!isOpen) setDialog(null);
                }}
              >
                <DialogContent
                  title={
                    dialog === "settings"
                      ? "Settings"
                      : dialog === "history"
                        ? "Review history"
                        : agent.agent
                          ? "Agent queue"
                          : "Agent setup"
                  }
                  description={
                    dialog === "history"
                      ? "States observed in this browser"
                      : "Configure this review"
                  }
                >
                  {dialog === "settings" && (
                    <Settings
                      agent={agent}
                      onNewReview={() => void changeReview()}
                      onOpenReview={(name) => void changeReview(name)}
                    />
                  )}
                  {dialog === "history" && <History diff={diff} />}
                  {dialog === "agent" && <AgentPanel agent={agent} />}
                </DialogContent>
              </Dialog>
            </div>
          </ReviewReferences>
        </NoteState>
      </NoteMotion>
    </Autocomplete.Root>
  );
}
