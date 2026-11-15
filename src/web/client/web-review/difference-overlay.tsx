import { useEffect, useRef, useState } from "react";
import {
  PixelDifferenceCache,
  decodeComparisonImage,
  type PixelDifference,
} from "./pixel-difference.ts";

export function DifferenceOverlay({
  before,
  after,
  active,
}: {
  before: string;
  after: string;
  active: boolean;
}) {
  const [threshold, setThreshold] = useState(0.1);
  const [includeAA, setIncludeAA] = useState(false);
  const [opacity, setOpacity] = useState(0.65);
  const [state, setState] = useState<{
    key: string;
    result?: PixelDifference;
    error?: string;
  }>();
  const cache = useRef<PixelDifferenceCache | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([before, after, threshold, includeAA]);
  const current = state?.key === key ? state : undefined;
  useEffect(() => () => cache.current?.dispose(), []);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    cache.current ??= new PixelDifferenceCache(decodeComparisonImage);
    void cache.current
      .compare(before, after, { threshold, includeAA }, abort.signal)
      .then(
        (result) => {
          if (!abort.signal.aborted) setState({ key, result });
        },
        (error: unknown) => {
          if (!abort.signal.aborted)
            setState({
              key,
              error:
                error instanceof Error
                  ? error.message
                  : "Pixel comparison failed.",
            });
        },
      );
    return () => abort.abort();
  }, [active, before, after, threshold, includeAA, key]);
  useEffect(() => {
    if (!active || !current?.result || !canvas.current) return;
    try {
      const context = canvas.current.getContext("2d");
      if (!context)
        throw new Error("Difference overlay canvas is unavailable.");
      const { data, width, height } = current.result;
      const pixels = context.createImageData(width, height);
      pixels.data.set(data);
      context.putImageData(pixels, 0, 0);
    } catch (error) {
      setState({
        key,
        error:
          error instanceof Error
            ? error.message
            : "Could not draw the difference overlay.",
      });
    }
  }, [active, current, key]);
  if (!active) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Difference threshold (0–1; lower is more sensitive)
          <input
            aria-label="Pixel difference threshold"
            className="ml-2 w-20 rounded border bg-background p-1"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={threshold}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value) && value >= 0 && value <= 1)
                setThreshold(value);
            }}
          />
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeAA}
            onChange={(event) => setIncludeAA(event.target.checked)}
          />
          Count anti-aliased edge pixels (off: ignore detected anti-aliasing)
        </label>
        <label>
          Overlay opacity
          <input
            aria-label="Difference overlay opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => setOpacity(+event.target.value)}
          />
        </label>
      </div>
      <p className="text-muted-foreground">
        Red marks changed pixels over the after original. Pixelmatch compares
        browser-decoded sRGB pixels; transparent pixels are composited on white.
        Drawings are proposals and are never compared.
      </p>
      {current?.error ? (
        <p role="alert">{current.error}</p>
      ) : current?.result ? (
        <>
          <p role="status">
            {current.result.changed.toLocaleString()} /{" "}
            {(current.result.width * current.result.height).toLocaleString()}{" "}
            changed pixels ({current.result.percentage.toFixed(3)}%).
          </p>
          <div className="relative">
            <img
              src={after}
              alt="After original screenshot"
              className="block w-full"
            />
            <canvas
              ref={canvas}
              width={current.result.width}
              height={current.result.height}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ opacity }}
              aria-label="Changed pixels highlighted in red"
              role="img"
            />
          </div>
        </>
      ) : (
        <p role="status">Comparing original screenshot pixels…</p>
      )}
    </div>
  );
}
