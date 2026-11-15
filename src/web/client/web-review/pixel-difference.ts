import pixelmatch from "pixelmatch";
import { wipeImageMismatch } from "./capture-comparison.ts";

export const MAX_COMPARISON_PIXELS = 2_000_000;
const MAX_DIMENSION = 8192;
export interface ComparisonPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface DifferenceOptions {
  threshold: number;
  includeAA: boolean;
}
export interface PixelDifference extends ComparisonPixels {
  changed: number;
  percentage: number;
}
export function comparisonSizeError(
  width: number,
  height: number,
): string | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return "Screenshot dimensions are invalid.";
  if (
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_COMPARISON_PIXELS
  )
    return "Pixel comparison is limited to 2,000,000 pixels and 8,192 pixels per side. Use side by side; images are not downscaled.";
  return null;
}

/** Cooperatively scheduled strips retain a two-row halo for pixelmatch's AA detector. */
export async function comparePixels(
  before: ComparisonPixels,
  after: ComparisonPixels,
  options: DifferenceOptions,
  signal?: AbortSignal,
): Promise<PixelDifference> {
  const error =
    wipeImageMismatch(before, after) ||
    comparisonSizeError(before.width, before.height);
  if (error) throw new Error(error);
  if (
    !Number.isFinite(options.threshold) ||
    options.threshold < 0 ||
    options.threshold > 1
  )
    throw new Error("Difference threshold must be between 0 and 1.");
  const { width, height } = before;
  if (
    before.data.length !== width * height * 4 ||
    after.data.length !== width * height * 4
  )
    throw new Error("Screenshot pixel data is incomplete.");
  signal?.throwIfAborted();
  const data = new Uint8ClampedArray(width * height * 4);
  const rows = Math.max(1, Math.floor(32768 / width));
  const scratch = new Uint8ClampedArray(width * Math.min(height, rows + 4) * 4);
  let changed = 0;
  for (let y = 0; y < height; y += rows) {
    // Let input and selection changes cancel work before the next bounded strip.
    const pause = Promise.withResolvers<void>();
    setTimeout(pause.resolve, 0);
    await pause.promise;
    signal?.throwIfAborted();
    const end = Math.min(height, y + rows);
    const top = Math.max(0, y - 2),
      bottom = Math.min(height, end + 2);
    const startByte = top * width * 4,
      endByte = bottom * width * 4;
    const output = scratch.subarray(0, endByte - startByte);
    output.fill(0);
    pixelmatch(
      before.data.subarray(startByte, endByte),
      after.data.subarray(startByte, endByte),
      output,
      width,
      bottom - top,
      { ...options, diffMask: true, checkerboard: false },
    );
    const central = output.subarray(
      (y - top) * width * 4,
      (end - top) * width * 4,
    );
    data.set(central, y * width * 4);
    for (let i = 3; i < central.length; i += 4) if (central[i]) changed++;
  }
  signal?.throwIfAborted();
  return {
    width,
    height,
    data,
    changed,
    percentage: (changed / (width * height)) * 100,
  };
}

/** Retain only the active pair's decoded originals and its latest completed result. */
export class PixelDifferenceCache {
  private decoded = new Map<
    string,
    { promise: Promise<ComparisonPixels>; abort: AbortController }
  >();
  private completed?: { key: string; result: PixelDifference };
  constructor(
    private decode: (
      source: string,
      signal: AbortSignal,
    ) => Promise<ComparisonPixels>,
  ) {}

  dispose() {
    for (const entry of this.decoded.values()) entry.abort.abort();
    this.decoded.clear();
    this.completed = undefined;
  }

  async compare(
    before: string,
    after: string,
    options: DifferenceOptions,
    signal?: AbortSignal,
  ) {
    const key = JSON.stringify([
      before,
      after,
      options.threshold,
      options.includeAA,
    ]);
    signal?.throwIfAborted();
    if (this.completed?.key === key) return this.completed.result;
    for (const [source, entry] of this.decoded)
      if (source !== before && source !== after) {
        entry.abort.abort();
        this.decoded.delete(source);
      }
    const load = (source: string) => {
      let entry = this.decoded.get(source);
      if (!entry) {
        const abort = new AbortController();
        entry = { promise: this.decode(source, abort.signal), abort };
        this.decoded.set(source, entry);
        const pending = entry;
        void pending.promise.catch(() => {
          if (this.decoded.get(source) === pending) this.decoded.delete(source);
        });
      }
      return entry.promise;
    };
    const [left, right] = await Promise.all([load(before), load(after)]);
    signal?.throwIfAborted();
    const result = await comparePixels(left, right, options, signal);
    signal?.throwIfAborted();
    this.completed = { key, result };
    return result;
  }
}

/** Check native dimensions before allocating a canvas or reading any RGBA buffers. */
export function decodeComparisonImage(
  source: string,
  signal: AbortSignal,
): Promise<ComparisonPixels> {
  signal.throwIfAborted();
  const { promise, resolve, reject } =
    Promise.withResolvers<ComparisonPixels>();
  const image = new Image();
  const cleanup = () => {
    clearTimeout(timer);
    image.onload = image.onerror = null;
    signal.removeEventListener("abort", cancel);
  };
  const cancel = () => {
    cleanup();
    image.src = "";
    reject(signal.reason);
  };
  const timer = setTimeout(() => {
    cleanup();
    image.src = "";
    reject(new Error("Screenshot loading timed out. Use side by side."));
  }, 15_000);
  signal.addEventListener("abort", cancel, { once: true });
  image.onerror = () => {
    cleanup();
    reject(
      new Error("An original screenshot could not load. Use side by side."),
    );
  };
  image.onload = () => {
    cleanup();
    const canvas = document.createElement("canvas");
    try {
      signal.throwIfAborted();
      const error = comparisonSizeError(
        image.naturalWidth,
        image.naturalHeight,
      );
      if (error) throw new Error(error);
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
        colorSpace: "srgb",
      });
      if (!context) throw new Error("Canvas pixel access is unavailable.");
      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error("Could not read screenshot pixels."),
      );
    } finally {
      canvas.width = canvas.height = 0;
    }
  };
  image.src = source;
  return promise;
}
