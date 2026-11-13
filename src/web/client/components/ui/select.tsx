import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./button.tsx";

export function Select<Value extends string | number>({
  label,
  value,
  options,
  onValueChange,
  className,
  disabled,
}: {
  label: string;
  value: Value;
  options: { value: Value; label: string }[];
  onValueChange: (value: Value) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <BaseSelect.Root
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-9 min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-xs text-foreground hover:bg-accent disabled:opacity-50",
          className,
        )}
      >
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          sideOffset={4}
          align="start"
          className="z-80"
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="max-h-[min(320px,var(--available-height))] min-w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-xs outline-none data-highlighted:bg-accent"
                >
                  <span className="flex size-3.5 shrink-0 items-center">
                    <BaseSelect.ItemIndicator>
                      <Check className="size-3.5" />
                    </BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText className="truncate">
                    {option.label}
                  </BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
