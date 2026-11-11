import { useUi } from "../app/ui-preferences.tsx";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  MessageSquarePlus,
} from "lucide-react";
import type { DiffFile } from "../../../shared/review-types.ts";
import { Button } from "../components/ui/button.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { useAction } from "../app/api.ts";

export function FileHeader({
  file,
  viewed,
  folded,
  onFold,
  onViewed,
  onComment,
}: {
  file: DiffFile;
  viewed: boolean;
  folded: boolean;
  onFold: () => void;
  onViewed: () => void;
  onComment: () => void;
}) {
  const action = useAction();
  const { settings } = useUi();
  return (
    <div className="border-y bg-card">
      <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2">
        <Tooltip label={folded ? "Expand file" : "Collapse file"}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${folded ? "Expand" : "Collapse"} ${file.path}`}
            aria-expanded={!folded}
            onClick={onFold}
          >
            {folded ? <ChevronRight /> : <ChevronDown />}
          </Button>
        </Tooltip>
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <h2
          className="min-w-0 flex-1 truncate font-mono text-sm"
          title={file.path}
        >
          {file.path}
        </h2>
        <span className="text-xs text-emerald-500">+{file.added}</span>
        <span className="text-xs text-rose-500">−{file.removed}</span>
        <Button
          size="sm"
          variant={viewed ? "default" : "outline"}
          onClick={onViewed}
          aria-pressed={viewed}
          aria-label={`${viewed ? "Mark unviewed" : "Mark viewed"}: ${file.path}`}
        >
          <Check />
          <span className="hidden lg:inline">Viewed</span>
        </Button>
        <Tooltip label="Comment on file">
          <Button
            variant="ghost"
            size="icon"
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
      </div>
      {action.error && (
        <p role="alert" className="px-4 pb-2 text-sm text-destructive">
          {action.error.message}
        </p>
      )}
    </div>
  );
}
