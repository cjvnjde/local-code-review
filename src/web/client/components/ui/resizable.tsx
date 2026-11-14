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
        "group relative z-20 flex w-3 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:transition-colors hover:after:bg-primary/60 focus-visible:after:bg-primary data-[separator=active]:after:bg-primary motion-reduce:after:transition-none",
        className,
      )}
      {...props}
    >
      <span
        className="relative z-10 flex h-7 w-3 shrink-0 items-center justify-center rounded-sm border bg-card text-muted-foreground opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[separator=active]:opacity-100 motion-reduce:transition-none"
        aria-hidden="true"
      >
        <GripVertical className="size-3" />
      </span>
    </Separator>
  );
}
