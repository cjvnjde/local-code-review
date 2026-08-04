import { describe, expect, test } from "bun:test";
import { GENERAL_MAX, NOTE_MAX, fitHeight } from "./autogrow.ts";

const MIN = 64, MAX = 320;

describe("fitHeight", () => {
  test("an empty or one-line box keeps the height it was designed at", () => {
    expect(fitHeight(0, MIN, MAX)).toBe(MIN);
    expect(fitHeight(MIN - 1, MIN, MAX)).toBe(MIN);
    expect(fitHeight(MIN, MIN, MAX)).toBe(MIN);
  });

  test("past the min it tracks the content line for line", () => {
    expect(fitHeight(MIN + 20, MIN, MAX)).toBe(MIN + 20);
    expect(fitHeight(MAX, MIN, MAX)).toBe(MAX);
  });

  test("the cap holds, so a long note cannot swallow the window", () => {
    expect(fitHeight(MAX + 1, MIN, MAX)).toBe(MAX);
    expect(fitHeight(4000, MIN, MAX)).toBe(MAX);
  });

  test("a cap below the min still yields the min, so the box is never unusably short", () => {
    expect(fitHeight(500, 64, 30)).toBe(64);
  });

  test("both caps leave room for several lines", () => {
    expect(NOTE_MAX).toBeGreaterThan(64);
    expect(GENERAL_MAX).toBeGreaterThan(34 * 2);
  });
});
