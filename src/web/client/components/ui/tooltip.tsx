import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[60] rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-popover" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
