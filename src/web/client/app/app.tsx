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
import { SearchResults } from "../search/results.tsx";
import { fileHidden } from "../diff/filters.ts";
import { rowKey } from "../diff/model.ts";
import { Eye, EyeOff, ArrowUp, ArrowDown } from "lucide-react";
import { ReviewReferences } from "../notes/references.tsx";
import { UiPreferences, useUi } from "./ui-preferences.tsx";
import { ImageScope } from "../components/images.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch,
  GitPullRequest,
  Search,
  Settings2,
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  Plus,
  Sun,
  Moon,
  History as HistoryIcon,
  Bot,
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
import { Dialog, DialogContent } from "../components/ui/dialog.tsx";
import { DiffView, type DiffViewHandle } from "../diff/diff-view.tsx";
import { makeComment, orderFiles } from "../diff/model.ts";
import { NoteCard } from "../notes/note-card.tsx";
import { Composer, draftBody, type Draft } from "../notes/composer.tsx";
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
  const shownFiles = useMemo(
    () =>
      files.filter((f) => f.path.toLowerCase().includes(search.toLowerCase())),
    [files, search],
  );
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
              ["applied", "answered", "skipped"].includes(note.status)) &&
          (!search ||
            `${note.file} ${note.body} ${note.messages.map((m) => m.body).join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase()))),
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
        setSearchOpen((open) => !open);
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
    if (draft?.host === "panel") {
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
    setDraft({
      ...next,
      host: next.host || "diff",
      original,
      editing: next.kind === "note" && !!known,
    });
    if (next.host === "panel") setNotesOpen(true);
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
          <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b bg-card px-4 md:px-5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <GitPullRequest className="size-5" />
            </div>
            <div className="mr-2">
              <h1 className="text-sm font-semibold tracking-tight">
                Local code review{" "}
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  v2
                </span>
              </h1>
              <p className="text-[10px] text-muted-foreground">{VERSION}</p>
            </div>
            <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground lg:flex">
              <GitBranch className="size-3.5" />
              <span className="max-w-36 truncate">{diff.branch}</span>
              <span className="opacity-40">/</span>
              <span className="max-w-48 truncate font-mono" title={diff.range}>
                {diff.id || diff.range}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {diff.web && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ url: "/api/web", method: "POST", body: {} })
                  }
                >
                  Open page
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!review || busy}
                onClick={() =>
                  compose({
                    kind: "note",
                    host: "panel",
                    comment: makeComment(),
                  })
                }
              >
                <Plus />
                Overall note
              </Button>
              {icon("Search review (⌘/Ctrl K)", <Search />, () =>
                setSearchOpen(true),
              )}
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
          <div className="flex min-h-11 shrink-0 items-center gap-3 border-b px-4 text-xs text-muted-foreground">
            {icon(
              navOpen ? "Hide file sidebar" : "Show file sidebar",
              navOpen ? <PanelLeftClose /> : <PanelLeft />,
              () => setNavOpen(!navOpen),
            )}
            <span className="hidden sm:inline">
              {files.length} changed files
            </span>
            <span className="text-emerald-500">
              +{files.reduce((sum, f) => sum + f.added, 0)}
            </span>
            <span className="text-rose-500">
              −{files.reduce((sum, f) => sum + f.removed, 0)}
            </span>
            <select
              className="min-w-0 flex-1 bg-transparent md:hidden"
              aria-label="Select file"
              value={file?.path || ""}
              onChange={(e) => jumpToFile(e.target.value)}
            >
              {files.map((f) => (
                <option key={f.path}>{f.path}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2">
              {icon(
                "Refresh review",
                <RefreshCw className={refreshing ? "animate-spin" : ""} />,
                onRefresh,
              )}
              <Button
                size="sm"
                variant={notesOpen ? "outline" : "ghost"}
                onClick={() => {
                  if (notesOpen && draft?.host === "panel") focusEditor();
                  else setNotesOpen(!notesOpen);
                }}
              >
                <MessageSquare />
                {notes.length} notes
              </Button>
            </div>
          </div>
          <ReviewLayout
            navOpen={navOpen}
            notesOpen={notesOpen}
            files={
              <aside
                className="flex h-full min-w-0 flex-col bg-card/50"
                aria-label="Changed files"
              >
                <div className="p-3">
                  <label className="flex items-center gap-2 rounded-lg border bg-background px-3">
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                      aria-label="Filter files and notes"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filter files and notes…"
                      className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between px-4 pb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
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
                    files={shownFiles}
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
                  {!shownFiles.length && (
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
                  className="flex h-full min-w-0 flex-col bg-muted/15 max-sm:fixed max-sm:inset-x-0 max-sm:top-[108px] max-sm:bottom-10 max-sm:z-20 max-sm:h-auto max-sm:w-full max-sm:bg-background"
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
                  {draft?.host === "panel" &&
                    draft.kind === "note" &&
                    draft.comment.scope === "global" &&
                    !draft.editing && (
                      <div className="max-h-[70%] shrink-0 overflow-auto border-t p-3">
                        <Composer
                          draft={draft}
                          onChange={setDraft}
                          onClose={closeDraft}
                          onSaved={() => setDraft(null)}
                          agent={!!agent.agent}
                          onBusy={setBusy}
                        />
                      </div>
                    )}
                </aside>
              )
            }
          >
            <main className="relative flex h-full min-w-0 flex-col">
              {searchOpen && (
                <SearchResults
                  files={files}
                  notes={notes}
                  onClose={() => setSearchOpen(false)}
                  onSelect={(result) => {
                    setSearchOpen(false);
                    const note = notes.find(
                      (note) => note.id === result.noteId,
                    );
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
              )}
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
          <footer className="flex min-h-10 shrink-0 items-center gap-3 border-t bg-card px-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <Circle className="size-2 fill-emerald-500 text-emerald-500" />
              Local review
            </span>
            <span className="hidden sm:inline">
              {open} open · {notes.length - open} done ·{" "}
              {notes.reduce((count, note) => count + noteState.unread(note), 0)}{" "}
              unread
            </span>
            <span
              className="ml-auto max-w-[45vw] truncate font-mono"
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
                <Bot />
                {agent.queue?.paused
                  ? "Queue paused"
                  : agent.connection?.state || "Agent"}
              </Button>
            )}
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
