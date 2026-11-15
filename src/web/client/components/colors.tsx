import { useMemo, useState } from "react";
import {
  findColors,
  parseColor,
  colorPreview,
  colorWithAlpha,
  replaceColor,
  type ColorLiteral,
} from "./color-literals.ts";
import { useStored } from "../app/preferences.ts";
import { Button } from "./ui/button.tsx";

/** Color tools edit explicit literals; no repository or Markdown text becomes arbitrary CSS. */
export function ColorTools({
  body,
  onChange,
}: {
  body: string;
  onChange?: (body: string) => void;
}) {
  const colors = useMemo(() => findColors(body), [body]);
  const [saved, setSaved] = useStored<string[]>("lcr:v2:colors", []);
  if (!colors.length) return null;
  return (
    <details className="rounded-lg border p-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Colors · {colors.length}
        <span className="ml-2 inline-flex gap-1" aria-hidden="true">
          {colors.slice(0, 8).map((color, i) => (
            <span
              key={i}
              className="inline-block size-3 rounded-sm border"
              style={{ backgroundColor: color.css }}
            />
          ))}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {colors.map((color) => (
          <ColorEditor
            key={`${color.from}:${color.value}`}
            color={color}
            saved={saved}
            onSave={(value) =>
              setSaved((current) =>
                [...new Set([...current, value])].slice(-24),
              )
            }
            onApply={
              onChange
                ? (value) => {
                    const next = replaceColor(body, color, value);
                    if (next) onChange(next.value);
                  }
                : undefined
            }
          />
        ))}
      </div>
    </details>
  );
}
function ColorEditor({
  color,
  saved,
  onSave,
  onApply,
}: {
  color: ColorLiteral;
  saved: string[];
  onSave: (color: string) => void;
  onApply?: (value: string) => void;
}) {
  const [value, setValue] = useState(color.value);
  const preview = colorPreview(value);
  const hex = preview?.hex;
  const alpha = hex?.length === 9 ? parseInt(hex.slice(7), 16) : 255;
  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="size-5 shrink-0 rounded border"
          style={{ backgroundColor: preview?.css || color.css }}
        />
        <code>{color.value}</code>
        <input
          type="color"
          aria-label={`Choose sRGB replacement for ${color.value}`}
          title="Choosing here replaces the literal with an sRGB hex color"
          value={(hex || color.hex).slice(0, 7)}
          onChange={(event) =>
            setValue(
              event.target.value +
                (alpha < 255 ? alpha.toString(16).padStart(2, "0") : ""),
            )
          }
        />
        <input
          aria-label={`Color value ${color.value}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-36 rounded border bg-background p-2 font-mono"
        />
        <label>
          Opacity
          <input
            type="range"
            aria-label={`Color opacity ${color.value}`}
            min="0"
            max="255"
            value={alpha}
            onChange={(event) =>
              setValue(
                colorWithAlpha(value, +event.target.value / 255) || value,
              )
            }
          />
        </label>
        <Button
          size="sm"
          variant="ghost"
          disabled={!hex}
          onClick={() => void navigator.clipboard.writeText(value)}
        >
          Copy color
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!hex}
          onClick={() => onSave(value)}
        >
          Save color
        </Button>
        {onApply && (
          <Button
            size="sm"
            variant="outline"
            disabled={!hex}
            onClick={() => onApply(value)}
          >
            Apply color
          </Button>
        )}
      </div>
      {preview?.modern && (
        <p className="text-muted-foreground">
          Original color space preserved. Native picker: sRGB preview
          {preview.outOfGamut ? " (clipped; original is outside sRGB)" : ""}.
          Choosing in the native picker converts to sRGB; Apply and Save
          otherwise retain the literal.
        </p>
      )}
      {!preview && (
        <p role="status">
          Enter a CSS color literal: hex, rgb, hsl, hwb, lab, lch, oklab, oklch
          or color(display-p3 …).
        </p>
      )}
      <div className="flex gap-2">
        {saved
          .filter((value) => parseColor(value))
          .map((value) => (
            <button
              key={value}
              aria-label={`Use saved color ${value}`}
              className="size-5 rounded border"
              style={{ backgroundColor: value }}
              onClick={() => setValue(value)}
            />
          ))}
      </div>
    </div>
  );
}
