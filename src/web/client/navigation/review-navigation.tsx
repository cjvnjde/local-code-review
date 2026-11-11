import { useMemo } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import type { DiffFile, DiffRow } from "../../../shared/review-types.ts";
import { bookmarkOf, orderBookmarks, stepAt } from "./bookmarks.ts";
import { rowKey } from "../diff/model.ts";
import { useStored } from "../app/preferences.ts";
import { useUi } from "../app/ui-preferences.tsx";
import { Button } from "../components/ui/button.tsx";
import type { ReadingAnchor } from "../diff/reading-model.ts";

export type ReviewBookmark = ReturnType<typeof bookmarkOf>;
export function useReadingNavigation(scope: string, files: DiffFile[]) {
  const [record, setRecord] = useStored<{
    scope: string;
    list: ReviewBookmark[];
  }>("lcr:v2:bookmarks", { scope, list: [] }, "session");
  const bookmarks = record.scope === scope ? record.list : [];
  const [reading, setReading] = useStored<ReadingAnchor | null>(
    `lcr:v2:reading:${scope}`,
    null,
  );
  const ordered = useMemo(
    () =>
      orderBookmarks(bookmarks, (bookmark) => {
        const fi = files.findIndex((file) => file.path === bookmark.file);
        const file = files[fi];
        return {
          fi,
          i:
            file?.rows.findIndex(
              (row) =>
                row.t !== "hunk" &&
                rowKey(row) === bookmark.a &&
                row.text.trim().startsWith(bookmark.text.slice(0, 60)),
            ) ?? -1,
        };
      }),
    [bookmarks, files],
  );
  function toggle(file: DiffFile, row: DiffRow) {
    const bookmark = bookmarkOf(file.path, row);
    setRecord((current) => ({
      scope,
      list: (current.scope === scope ? current.list : []).some(
        (item) => item.key === bookmark.key,
      )
        ? current.list.filter((item) => item.key !== bookmark.key)
        : [...(current.scope === scope ? current.list : []), bookmark],
    }));
  }
  return {
    bookmarks,
    ordered,
    toggle,
    reading,
    setReading,
    remove: (key: string) =>
      setRecord({ scope, list: bookmarks.filter((item) => item.key !== key) }),
    reset: () => {
      setRecord({ scope, list: [] });
      setReading(null);
    },
  };
}
export function NavigationLists({
  navigation,
  onJump,
  onResume,
  onStep,
}: {
  navigation: ReturnType<typeof useReadingNavigation>;
  onJump: (bookmark: ReviewBookmark) => void;
  onResume: () => void;
  onStep: (direction: number) => void;
}) {
  const { settings, update } = useUi();
  return (
    <div className="shrink-0 border-t text-xs">
      {navigation.reading && (
        <div className="border-b p-3">
          <Button size="sm" variant="ghost" onClick={onResume}>
            Resume reading
          </Button>
          <p className="truncate px-2 text-[10px] text-muted-foreground">
            {navigation.reading.path}
          </p>
        </div>
      )}
      {navigation.ordered.length > 0 && (
        <>
          <div className="flex items-center gap-1 p-2">
            <button
              className="flex flex-1 items-center gap-2 px-2 py-1 text-left"
              aria-expanded={!settings.bmFold}
              onClick={() => update({ bmFold: !settings.bmFold })}
            >
              {settings.bmFold ? (
                <ChevronRight className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              Bookmarks · {navigation.ordered.length}
            </button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Previous bookmark"
              onClick={() => onStep(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Next bookmark"
              onClick={() => onStep(1)}
            >
              <ArrowDown />
            </Button>
          </div>
          {!settings.bmFold && (
            <div className="max-h-48 overflow-auto px-2 pb-2">
              {navigation.ordered.map(({ b, gone }) => (
                <div key={b.key} className="flex items-center gap-1">
                  <button
                    className="min-w-0 flex-1 truncate rounded px-2 py-2 text-left hover:bg-accent"
                    title={b.text}
                    onClick={() => onJump(b)}
                  >
                    <Bookmark className="mr-2 inline size-3" />
                    {b.file.split("/").pop()}:{b.line}
                    {gone ? " · outdated" : ""}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove bookmark"
                    onClick={() => navigation.remove(b.key)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
