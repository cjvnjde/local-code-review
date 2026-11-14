import { ReviewLayout } from "../navigation/review-layout.tsx";
import { FileTree } from "../navigation/file-tree.tsx";
import { NoteState, useReviewState } from "../notes/review-state.tsx";
import { setView } from "../navigation/ui-navigation.ts";
import { refOf } from "../notes/note-ref.ts";
import {
  useReadingNavigation,
  NavigationLists,
  type ReviewBookmark,
} from "../navigation/review-navigation.tsx";
import { stepAt } from "../navigation/bookmarks.ts";
import { SearchResults, type SearchResultsHandle } from "../search/results.tsx";
import { fileHidden } from "../diff/filters.ts";
import { rowKey } from "../diff/model.ts";
import { Eye, EyeOff, ArrowUp, ArrowDown } from "lucide-react";
import { ReviewReferences } from "../notes/references.tsx";
import { UiPreferences, useUi } from "./ui-preferences.tsx";
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
  useLive,
  useAction,
  type DiffResponse,
  type ReviewResponse,
} from "./api.ts";
import { useStored } from "./preferences.ts";
import { Button, cn } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { Select } from "../components/ui/select.tsx";
import { Dialog, DialogContent } from "../components/ui/dialog.tsx";
import { DiffView, type DiffViewHandle } from "../diff/diff-view.tsx";
import { makeComment, orderFiles } from "../diff/model.ts";
import { NoteCard } from "../notes/note-card.tsx";
import { Composer, draftBody, type Draft } from "../notes/composer.tsx";
import { AgentActivity } from "./agent-activity.tsx";
import { Settings, AgentPanel } from "./settings.tsx";
import { History, useHistoryCapture } from "../history/history.tsx";
import { EmbeddedReview, embedToken } from "../web-review/embedded.tsx";
import { VERSION } from "../../../version.ts";

export function App() {
  const diff = useDiff();
  const review = useReview();
  useLive();
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
      <UiPreferences>
        <ImageScope
          repo={diff.data.repo}
          read={diff.data.id || diff.data.range}
        >
          <EmbeddedReview diff={diff.data} review={review.data} />
        </ImageScope>
      </UiPreferences>
    );
  return (
    <UiPreferences>
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
    </UiPreferences>
  );
}

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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchResults = useRef<SearchResultsHandle>(null);
  const [overallOpen, setOverallOpen] = useState(true);
  const overallContainer = useRef<HTMLDivElement>(null);
  const overallEditor = useRef<HTMLElement>(null);
  const pickingAttachment = useRef(false);
  const [diff, setDiff] = useState(incomingDiff);
  const diffView = useRef<DiffViewHandle>(null);
  const navigation = useRef<HTMLElement>(null);
  const scope = `${diff.repo}:${diff.id ? `#${diff.id}` : diff.range}`;
  const noteState = useReviewState(scope);
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
  const [dark, setDark] = useStored("lcr:v2:dark", true);
  const [navOpen, setNavOpen] = useStored("lcr:v2:sidebar", true);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [notesOpen, setNotesOpen] = useState(true);
  const [allNotes, setAllNotes] = useState(false);
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState<"settings" | "history" | "agent" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const action = useAction();
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
  }
  function jumpToNote(
    note: import("../../../shared/review-types.ts").ReviewNote,
  ) {
    noteState.read(note);
    if (noteState.resolved(note)) noteState.setShowResolved(true);
    const reference = refOf(note.id);
    if (reference) {
      followed.current = reference;
      setView("note", reference);
    }
    reveal(note.file, () => diffView.current?.scrollToNote(note));
  }
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
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (draft && (draftBody(draft) !== (draft.original || "") || busy)) {
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
          target.closest("[role=listbox], [role=tooltip]")
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
          !noteState.resolved(note) ||
          noteState.showResolved ||
          activeDraft === note.id,
      ),
    [notes, noteState, activeDraft],
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
  const listed = [...visibleNotes]
    .filter(
      (note) =>
        (draft?.host === "panel" &&
          (draft.kind === "note" ? draft.comment.id : draft.id) === note.id) ||
        ((allNotes || note.file === file?.path || note.scope === "global") &&
          (filter === "all" ||
            (filter === "done") ===
              ["applied", "answered", "skipped"].includes(note.status))),
    )
    .sort(
      (a, b) =>
        (a.scope === "global" ? -1 : (fileOrder.get(a.file) ?? 1e9)) -
          (b.scope === "global" ? -1 : (fileOrder.get(b.file) ?? 1e9)) ||
        (a.scope === "file" ? -1 : a.start) -
          (b.scope === "file" ? -1 : b.start),
    );
  const viewed = files.filter((f) => marks[f.path] === f.hash).length;
  const open = notes.filter(
    (n) => !["applied", "answered", "skipped"].includes(n.status),
  ).length;
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
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  function focusEditor() {
    setSearchOpen(false);
    if (overallDraft) {
      setOverallOpen(true);
      requestAnimationFrame(() =>
        overallEditor.current
          ?.querySelector<HTMLTextAreaElement>("textarea")
          ?.focus({ preventScroll: true }),
      );
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
          comment: { ...next.comment, body: draft.comment.body },
        });
        return true;
      }
      if (draftBody(draft) !== (draft.original || "")) {
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
      editing: next.kind === "note" && !!known,
    });
    if (
      next.host === "panel" &&
      !(next.kind === "note" && next.comment.scope === "global" && !known)
    )
      setNotesOpen(true);
    else if (matchMedia("(max-width: 639px)").matches) setNotesOpen(false);
    return true;
  };
  const closeDraft = () => {
    if (!busy) setDraft(null);
  };
  async function changeReview(name?: string) {
    if (
      busy ||
      action.isPending ||
      !review ||
      (draft && draftBody(draft) !== (draft.original || ""))
    ) {
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
    <NoteState value={noteState}>
      <ReviewReferences
        notes={notes}
        follow={(note) => {
          jumpToNote(note);
          setAllNotes(true);
          setNotesOpen(true);
        }}
      >
        <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
          <header className="relative z-30 flex h-12 shrink-0 items-center gap-1 border-b bg-card px-2 sm:gap-2 sm:px-3">
            {icon(
              navOpen ? "Hide file sidebar" : "Show file sidebar",
              navOpen ? <PanelLeftClose /> : <PanelLeft />,
              () => setNavOpen(!navOpen),
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
              <span className="max-w-48 truncate font-mono" title={diff.range}>
                {diff.id || diff.range}
              </span>
            </div>
            <Select
              label="Select file"
              className="h-8 w-9 shrink-0 gap-0 px-2 [&>span:first-child]:hidden md:hidden"
              value={file?.path || ""}
              onValueChange={jumpToFile}
              options={files.map((f) => ({ value: f.path, label: f.path }))}
            />
            <label className="mx-auto flex h-8 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-md border bg-background px-2 sm:px-3">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchInput}
                type="search"
                aria-label="Search review"
                aria-expanded={searchOpen}
                aria-controls={searchOpen ? "review-search-results" : undefined}
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (searchOpen && searchResults.current?.key(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                  } else if (
                    !searchOpen &&
                    ["ArrowDown", "Enter"].includes(event.key)
                  ) {
                    event.preventDefault();
                    setSearchOpen(true);
                  }
                }}
                placeholder="Search review…"
                className="h-full w-full min-w-0 bg-transparent text-xs outline-none"
              />
              <kbd className="hidden shrink-0 text-[10px] text-muted-foreground lg:inline">
                ⌘/Ctrl K
              </kbd>
            </label>
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              {diff.web && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Open page"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ url: "/api/web", method: "POST", body: {} })
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
                      else focusEditor();
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
                    className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100dvh-112px)] w-[min(40rem,calc(100vw-24px))] overflow-auto border bg-card p-4 shadow-xl max-sm:fixed max-sm:inset-x-3 max-sm:top-12 max-sm:mt-2 max-sm:w-auto"
                  >
                    <Composer
                      draft={draft}
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
                  () => setDark(!dark),
                )}
                {icon("Settings", <Settings2 />, () => setDialog("settings"))}
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
                    onClick={() => setDark(!dark)}
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
            notesOpen={notesOpen}
            files={
              <aside
                className="flex h-full min-w-0 flex-col bg-card/50"
                aria-label="Changed files"
              >
                <div className="flex items-center justify-between px-4 py-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  <span>Changes</span>
                  <span>
                    {viewed}/{files.length} viewed
                  </span>
                </div>
                <nav
                  ref={navigation}
                  className="min-h-0 flex-1 overflow-auto px-2 pb-3"
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
                              ? files.find((file) => file.path === path)!.hash
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
                <NavigationLists
                  navigation={reading}
                  onJump={jumpBookmark}
                  onStep={stepBookmark}
                  onResume={() => {
                    if (reading.reading) {
                      const place = reading.reading;
                      reveal(place.path, () =>
                        diffView.current?.resumeReading(place),
                      );
                    }
                  }}
                />
                <div className="border-t p-3">
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${files.length ? (viewed / files.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Your reading progress stays in this browser.
                  </p>
                </div>
              </aside>
            }
            notes={
              notesOpen && (
                <aside
                  className="flex h-full min-w-0 flex-col bg-muted/15 max-sm:fixed max-sm:inset-x-0 max-sm:top-12 max-sm:bottom-10 max-sm:z-20 max-sm:h-auto max-sm:w-full max-sm:bg-background"
                  aria-label="Review notes"
                >
                  <div className="flex items-center gap-2 border-b px-4 py-3">
                    <h2 className="text-sm font-semibold">Conversation</h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Previous note"
                      onClick={() => stepNote(-1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Next note"
                      onClick={() => stepNote(1)}
                    >
                      <ArrowDown />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {listed.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setAllNotes(!allNotes)}
                    >
                      {allNotes ? "This file" : "All notes"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="sm:hidden"
                      onClick={() => {
                        if (draft?.host === "panel") focusEditor();
                        else setNotesOpen(false);
                      }}
                    >
                      Close
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={noteState.showResolved}
                        onChange={(event) =>
                          noteState.setShowResolved(event.target.checked)
                        }
                      />
                      Show resolved ({notes.filter(noteState.resolved).length})
                    </label>
                    <details className="ml-auto">
                      <summary className="cursor-pointer text-muted-foreground">
                        Manage
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!draft}
                          onClick={() =>
                            setBulkDelete(
                              notes
                                .filter((note) => note.status === "applied")
                                .map((note) => note.id),
                            )
                          }
                        >
                          Remove applied
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!draft}
                          onClick={() =>
                            setBulkDelete(notes.map((note) => note.id))
                          }
                        >
                          Clear notes
                        </Button>
                      </div>
                    </details>
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
                  <div className="flex gap-1 border-b px-3 py-2">
                    {["all", "open", "done"].map((kind) => (
                      <Button
                        key={kind}
                        variant={filter === kind ? "outline" : "ghost"}
                        size="sm"
                        onClick={() => setFilter(kind)}
                        className="capitalize"
                      >
                        {kind}
                      </Button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
                    {listed.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        file={files.find((f) => f.path === note.file)}
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
                              onChange={setDraft}
                              onClose={closeDraft}
                              onSaved={() => setDraft(null)}
                              agent={!!agent.agent}
                              onBusy={setBusy}
                            />
                          ) : undefined
                        }
                        onJump={
                          note.scope === "global" ||
                          files.some((file) => file.path === note.file)
                            ? () => {
                                jumpToNote(note);
                                if (matchMedia("(max-width: 639px)").matches)
                                  setNotesOpen(false);
                              }
                            : undefined
                        }
                      />
                    ))}
                    {!listed.length && (
                      <div className="px-4 py-12 text-center">
                        <MessageSquare className="mx-auto mb-4 size-6 text-muted-foreground/50" />
                        <p className="text-sm font-medium">
                          Room for a conversation
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          Comment on a code line or add an overall note. Notes
                          and replies are saved to Markdown.
                        </p>
                      </div>
                    )}
                  </div>
                </aside>
              )
            }
          >
            <main className="relative flex h-full min-w-0 flex-col">
              <SearchResults
                ref={searchResults}
                query={search}
                open={searchOpen}
                files={files}
                notes={notes}
                onClose={() => setSearchOpen(false)}
                onSelect={(result) => {
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
                }}
              />
              <DiffView
                ref={diffView}
                files={visibleFiles}
                bookmarks={reading.bookmarks.map((bookmark) => bookmark.key)}
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
                className="size-2 fill-emerald-500 text-emerald-500"
              />
              {files.length} <span className="hidden sm:inline">changed</span>{" "}
              files
            </span>
            <span className="shrink-0 text-emerald-500">
              +{files.reduce((sum, f) => sum + f.added, 0)}
            </span>
            <span className="shrink-0 text-rose-500">
              −{files.reduce((sum, f) => sum + f.removed, 0)}
            </span>
            <span className="hidden sm:inline">
              {open} open · {notes.length - open} done ·{" "}
              {notes.reduce((count, note) => count + noteState.unread(note), 0)}{" "}
              unread
            </span>
            <span
              className="ml-auto min-w-0 max-w-[30vw] truncate font-mono"
              title={review?.file}
            >
              {review?.file || "First save creates a Markdown review"}
            </span>
            {agent.agent && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialog("agent")}
              >
                <AgentActivity agent={agent} />
              </Button>
            )}
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
                  className={refreshing ? "size-3.5 animate-spin" : "size-3.5"}
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
                    : "Agent queue"
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
  );
}
