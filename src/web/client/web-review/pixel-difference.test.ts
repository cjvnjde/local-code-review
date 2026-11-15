import { describe, expect, test } from "bun:test";
import pixelmatch from "pixelmatch";
import {
  comparePixels,
  comparisonSizeError,
  PixelDifferenceCache,
  type ComparisonPixels,
} from "./pixel-difference.ts";

function image(width: number, height: number, shade = 255): ComparisonPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = shade;
    data[i + 3] = 255;
  }
  return { width, height, data };
}
const options = { threshold: 0.1, includeAA: false };

describe("original screenshot pixel differences", () => {
  test("counts changed pixels, percentage and a transparent red mask", async () => {
    const before = image(2, 2),
      after = image(2, 2);
    after.data.set([0, 0, 0, 255], 0);
    const result = await comparePixels(before, after, options);
    expect(result.changed).toBe(1);
    expect(result.percentage).toBe(25);
    expect([...result.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...result.data.slice(4)]).toEqual(Array(12).fill(0));
    expect((await comparePixels(before, before, options)).changed).toBe(0);
  });

  test("threshold is real and transparency is compared on white", async () => {
    expect(
      (
        await comparePixels(image(2, 2, 100), image(2, 2, 101), {
          ...options,
          threshold: 0,
        })
      ).changed,
    ).toBe(4);
    expect(
      (
        await comparePixels(image(2, 2, 100), image(2, 2, 101), {
          ...options,
          threshold: 1,
        })
      ).changed,
    ).toBe(0);
    const transparent = image(2, 2, 0);
    for (let i = 3; i < transparent.data.length; i += 4)
      transparent.data[i] = 0;
    expect(
      (await comparePixels(transparent, image(2, 2), options)).changed,
    ).toBe(0);
  });

  test("strips match pixelmatch across AA boundaries, with AA included or ignored", async () => {
    const before = image(300, 230),
      after = image(300, 230);
    for (let y = 0; y < 230; y++) {
      for (let x = 0; x < 300; x++) {
        const i = (y * 300 + x) * 4;
        const a = x < y ? 0 : x === y ? 100 : 255;
        const b = x < y ? 0 : x === y ? 140 : 255;
        before.data[i] = before.data[i + 1] = before.data[i + 2] = a;
        after.data[i] = after.data[i + 1] = after.data[i + 2] = b;
      }
    }
    const counts: number[] = [];
    for (const includeAA of [false, true]) {
      const settings = { threshold: 0, includeAA };
      const fullMask = new Uint8ClampedArray(before.data.length);
      const fullCount = pixelmatch(
        before.data,
        after.data,
        fullMask,
        300,
        230,
        { ...settings, diffMask: true, checkerboard: false },
      );
      const result = await comparePixels(before, after, settings);
      expect(result.changed).toBe(fullCount);
      expect(result.data).toEqual(fullMask);
      counts.push(result.changed);
    }
    expect(counts[1]!).toBeGreaterThan(counts[0]!);
  });

  test("mismatched, oversized, malformed and canceled work never produces a result", async () => {
    expect(comparisonSizeError(2000, 1000)).toBeNull();
    for (const [width, height] of [
      [2001, 1000],
      [9000, 1],
      [0, 10],
      [Infinity, 2],
      [1.5, 2],
    ])
      expect(comparisonSizeError(width!, height!)).not.toBeNull();
    await expect(
      comparePixels(image(1, 2), image(2, 1), options),
    ).rejects.toThrow("dimensions");
    await expect(
      comparePixels(
        { width: 2001, height: 1000, data: new Uint8ClampedArray() },
        { width: 2001, height: 1000, data: new Uint8ClampedArray() },
        options,
      ),
    ).rejects.toThrow("limited");
    await expect(
      comparePixels(
        { ...image(2, 2), data: new Uint8ClampedArray(1) },
        image(2, 2),
        options,
      ),
    ).rejects.toThrow("incomplete");
    await expect(
      comparePixels(image(1, 1), image(1, 1), { ...options, threshold: NaN }),
    ).rejects.toThrow("threshold");
    const abort = new AbortController();
    const pending = comparePixels(
      image(300, 230),
      image(300, 230, 0),
      options,
      abort.signal,
    );
    abort.abort();
    await expect(pending).rejects.toThrow();
  });

  test("cached originals avoid decoding again; completed results are reused only for exact inputs", async () => {
    const calls: string[] = [];
    const cache = new PixelDifferenceCache(async (source) => {
      calls.push(source);
      return image(2, 2, source === "before" ? 255 : 0);
    });
    const first = await cache.compare("before", "after", options);
    expect(await cache.compare("before", "after", options)).toBe(first);
    expect(calls).toEqual(["before", "after"]);
    const changedThreshold = await cache.compare("before", "after", {
      ...options,
      threshold: 1,
    });
    expect(changedThreshold).not.toBe(first);
    expect(calls).toEqual(["before", "after"]);
    await cache.compare("before", "new-after", options);
    expect(calls).toEqual(["before", "after", "new-after"]);
    cache.dispose();
  });

  test("late previous-pair decoding cannot publish stale results after selection changes", async () => {
    const old = Promise.withResolvers<ComparisonPixels>();
    const cache = new PixelDifferenceCache(async (source) =>
      source === "old" ? old.promise : image(2, 2),
    );
    const abort = new AbortController();
    const stale = cache.compare("before", "old", options, abort.signal);
    const rejected = stale.catch((error: unknown) => error);
    abort.abort();
    const fresh = await cache.compare("before", "new", options);
    old.resolve(image(2, 2, 0));
    expect(await rejected).toBeInstanceOf(Error);
    expect(fresh.changed).toBe(0);
    expect(await cache.compare("before", "new", options)).toBe(fresh);
    cache.dispose();
  });
});
