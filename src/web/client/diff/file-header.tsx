import { useUi } from "../app/ui-preferences.tsx";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  MessageSquarePlus,
  ListMinus,
} from "lucide-react";
import type { DiffFile } from "../../../shared/review-types.ts";
import { Button } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { useAction } from "../app/api.ts";
import { RelatedReviews } from "../notes/related-reviews.tsx";

export function FileHeader({
  file,
  viewed,
  folded,
  onFold,
  onViewed,
  onComment,
  removed,
  onRemoved,
  blocked,
}: {
  file: DiffFile;
  viewed: boolean;
  folded: boolean;
  onFold: () => void;
  onViewed: () => void;
  onComment: () => void;
  removed: boolean;
  onRemoved: () => void;
  blocked: boolean;
}) {
  const action = useAction();
  const { settings } = useUi();
  return (
    <div className="relative min-w-0 max-w-full border-y bg-card [overflow-wrap:anywhere]">
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1">
        <Tooltip label={folded ? "Expand file" : "Collapse file"}>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`${folded ? "Expand" : "Collapse"} ${file.path}`}
            aria-expanded={!folded}
            onClick={onFold}
          >
            {folded ? <ChevronRight /> : <ChevronDown />}
          </Button>
        </Tooltip>
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <h2
          className="min-w-0 flex-[1_1_8rem] truncate font-mono text-sm"
          title={file.from ? `${file.from} → ${file.path}` : file.path}
        >
          {file.path}
        </h2>
        <span className="shrink-0 text-xs text-emerald-500">+{file.added}</span>
        <span className="shrink-0 text-xs text-rose-500">−{file.removed}</span>
        <Button
          size="sm"
          variant={viewed ? "default" : "outline"}
          className="px-2"
          onClick={onViewed}
          aria-pressed={viewed}
          aria-label={`${viewed ? "Mark unviewed" : "Mark viewed"}: ${file.path}`}
        >
          <Check />
          <span className="hidden lg:inline">Viewed</span>
        </Button>
        {file.removed > 0 && (
          <Tooltip label="Fold removed lines">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Fold removed lines"
              aria-pressed={removed}
              onClick={onRemoved}
            >
              <ListMinus className={removed ? "text-primary" : ""} />
            </Button>
          </Tooltip>
        )}
        <Tooltip label="Comment on file">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Comment on file ${file.path}`}
            onClick={onComment}
          >
            <MessageSquarePlus />
          </Button>
        </Tooltip>
        <Tooltip label="Open in editor">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Open ${file.path} in editor`}
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                url: "/api/open-file",
                method: "POST",
                body: { path: file.path, editor: settings.editor },
              })
            }
          >
            <ExternalLink />
          </Button>
        </Tooltip>
        <RelatedReviews file={file} blocked={blocked} />
      </div>
      {action.error && (
        <p role="alert" className="px-4 pb-2 text-sm text-destructive">
          {action.error.message}
        </p>
      )}
    </div>
  );
}
