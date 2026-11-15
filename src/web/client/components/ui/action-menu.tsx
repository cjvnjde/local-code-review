import { Menu } from "@base-ui/react/menu";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "./button.tsx";

export function ActionMenu({
  trigger,
  children,
  align = "end",
  finalFocus,
}: {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "end";
  finalFocus?: ComponentProps<typeof Menu.Popup>["finalFocus"];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner align={align} sideOffset={6} className="z-[80]">
          <Menu.Popup
            finalFocus={finalFocus}
            className="min-w-44 max-w-[calc(100vw-24px)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function ActionMenuItem({
  className,
  ...props
}: Omit<ComponentProps<typeof Menu.Item>, "className"> & {
  className?: string;
}) {
  return (
    <Menu.Item
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}
