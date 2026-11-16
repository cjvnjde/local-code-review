import { useUi } from "../app/ui-preferences.tsx";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
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
          className="min-w-0 flex-1 truncate font-mono text-sm"
          aria-label={file.path}
          title={file.from ? `${file.from} → ${file.path}` : file.path}
        >
          {file.path.split("/").at(-1)}
        </h2>
        <span className="shrink-0 text-xs text-diff-add-foreground">
          +{file.added}
        </span>
        <span className="shrink-0 text-xs text-diff-del-foreground">
          −{file.removed}
        </span>
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
