import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./button.tsx";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export function DialogContent({
  children,
  title,
  description,
  className,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Popup>, "title" | "className"> & {
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
      <DialogPrimitive.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-card p-6 shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        <div className="mb-5 pr-8">
          <DialogPrimitive.Title className="text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            className={cn(
              "mt-1 text-sm text-muted-foreground",
              !description && "sr-only",
            )}
          >
            {description || title}
          </DialogPrimitive.Description>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
        <DialogPrimitive.Close
          className="absolute top-4 right-4 rounded-md p-2 text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close dialog"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}
