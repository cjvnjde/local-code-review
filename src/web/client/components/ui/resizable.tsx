import { Group, Panel, Separator } from "react-resizable-panels";
import { GripVertical } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./button.tsx";

export const ResizablePanel = Panel;
export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return <Group className={cn("min-h-0 min-w-0", className)} {...props} />;
}
export function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "group relative z-20 flex w-1 shrink-0 items-center justify-center bg-border outline-none transition-colors hover:bg-primary/60 focus-visible:bg-primary data-[separator=active]:bg-primary",
        className,
      )}
      {...props}
    >
      <span
        className="flex h-7 w-3 items-center justify-center rounded-sm border bg-card text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[separator=active]:opacity-100"
        aria-hidden="true"
      >
        <GripVertical className="size-3" />
      </span>
    </Separator>
  );
}
