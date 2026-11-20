import { useUi } from "../app/ui-preferences.tsx";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  MessageSquarePlus,
  ListMinus,
  MoreHorizontal,
} from "lucide-react";
import type { DiffFile } from "../../../shared/review-types.ts";
import { Button } from "../components/ui/button.tsx";
import { ActionMenu, ActionMenuItem } from "../components/ui/action-menu.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { useAction } from "../app/api.ts";
import { RelatedReviews } from "../notes/related-reviews.tsx";

const graphemes = new Intl.Segmenter();

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
  preview,
  onPreview,
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
  preview: boolean;
  onPreview?: () => void;
}) {
  const action = useAction();
  const { settings } = useUi();
  const center = graphemes
    .segment(file.path)
    .containing(Math.ceil(file.path.length / 2) - 1);
  const midpoint = center ? center.index + center.segment.length : 0;
  const openInEditor = () =>
    action.mutate({
      url: "/api/open-file",
      method: "POST",
      body: { path: file.path, editor: settings.editor },
    });
  return (
    <div className="relative min-w-0 max-w-full border-y bg-card [overflow-wrap:anywhere]">
      <div className="flex min-h-10 min-w-0 items-center gap-1 px-2 py-1">
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
        <h2
          className="flex min-w-0 flex-1 whitespace-nowrap font-mono text-sm [white-space-collapse:preserve-spaces]"
          dir="ltr"
          aria-label={file.path}
          title={file.from ? `${file.from} → ${file.path}` : file.path}
        >
          {/* Only the prefix paints an ellipsis; the suffix keeps its right edge. */}
          <span className="min-w-[min(1ch,100%)] overflow-hidden text-ellipsis">
            {file.path.slice(0, midpoint)}
          </span>
          <span className="flex min-w-0 justify-end overflow-hidden">
            <span className="shrink-0">{file.path.slice(midpoint)}</span>
          </span>
        </h2>
        <span className="shrink-0 text-xs text-diff-add-foreground">
          +{file.added}
        </span>
        <span className="shrink-0 text-xs text-diff-del-foreground">
          −{file.removed}
        </span>
        {onPreview && (
          <Tooltip
            label={
              preview ? "Show Markdown source" : "Preview formatted Markdown"
            }
          >
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              aria-label={`Preview Markdown for ${file.path}`}
              aria-pressed={preview}
              onClick={onPreview}
            >
              <Eye />
              <span className="hidden @[30rem]:inline">Preview</span>
            </Button>
          </Tooltip>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={`size-8 px-0 ${viewed ? "text-success" : "text-muted-foreground"}`}
          title={viewed ? "Mark unviewed" : "Mark viewed"}
          onClick={onViewed}
          aria-pressed={viewed}
          aria-label={`${viewed ? "Mark unviewed" : "Mark viewed"}: ${file.path}`}
        >
          <Check />
        </Button>
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
        {file.removed > 0 ? (
          <ActionMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`File actions for ${file.path}`}
              >
                <MoreHorizontal />
              </Button>
            }
          >
            <ActionMenuItem onClick={onRemoved}>
              <ListMinus />
              {removed ? "Show removed lines" : "Fold removed lines"}
            </ActionMenuItem>
            <ActionMenuItem disabled={action.isPending} onClick={openInEditor}>
              <ExternalLink />
              Open in editor
            </ActionMenuItem>
          </ActionMenu>
        ) : (
          <Tooltip label="Open in editor">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Open ${file.path} in editor`}
              disabled={action.isPending}
              onClick={openInEditor}
            >
              <ExternalLink />
            </Button>
          </Tooltip>
        )}
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
