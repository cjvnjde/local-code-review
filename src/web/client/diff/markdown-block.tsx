import { memo } from "react";
import { RepositoryMarkdown } from "../components/markdown.tsx";
import type { MarkdownBlock } from "./markdown-preview.ts";
import { cn } from "../components/ui/button.tsx";

export const MarkdownPreviewBlock = memo(function MarkdownPreviewBlock({
  block,
}: {
  block: MarkdownBlock;
}) {
  const { node, change } = block;
  return (
    <div
      className={cn(
        "flex min-w-0 gap-2 px-3 py-1.5",
        change === "add" && "diff-add",
        change === "del" && "diff-del",
      )}
    >
      <span className="w-3 shrink-0 select-none font-mono text-xs leading-6 text-muted-foreground">
        <span aria-hidden="true">
          {change === "add" ? "+" : change === "del" ? "−" : ""}
        </span>
        {change !== "ctx" && (
          <span className="sr-only">
            {change === "add" ? "Added" : "Removed"}
          </span>
        )}
      </span>
      <RepositoryMarkdown block={node} />
    </div>
  );
});
