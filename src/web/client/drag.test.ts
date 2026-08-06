import { describe, expect, test } from "bun:test";
import { ROW_SLIP, START_SLIP, atStart, charRange, leftRow } from "./drag.ts";

// A code row is 24px tall; the pressed row here spans y 100..124.
const top = 100, bottom = 124;

describe("leftRow", () => {
  test("the pressed row itself never counts as left", () => {
    expect(leftRow(top, top, bottom)).toBe(false);
    expect(leftRow(110, top, bottom)).toBe(false);
    expect(leftRow(bottom, top, bottom)).toBe(false);
  });

  test("brushing the neighbouring row stays within the slack", () => {
    expect(leftRow(bottom + ROW_SLIP, top, bottom)).toBe(false);
    expect(leftRow(top - ROW_SLIP, top, bottom)).toBe(false);
  });

  test("travelling past the slack in either direction means row selection", () => {
    expect(leftRow(bottom + ROW_SLIP + 1, top, bottom)).toBe(true);
    expect(leftRow(top - ROW_SLIP - 1, top, bottom)).toBe(true);
  });

  test("the slack is more than half a row, so a wobble cannot cross it", () => {
    expect(ROW_SLIP).toBeGreaterThan((bottom - top) / 2);
  });
});

// The drag started at x 200 on the row spanning y 100..124.
const x0 = 200, y0 = 112;

describe("atStart", () => {
  test("the press point itself counts as back at the start", () => {
    expect(atStart(x0, y0, x0, y0)).toBe(true);
  });

  test("a wobble within the slack still counts, in either direction", () => {
    expect(atStart(x0 + START_SLIP, y0, x0, y0)).toBe(true);
    expect(atStart(x0 - START_SLIP, y0 + START_SLIP, x0, y0)).toBe(true);
  });

  test("travelling along the line past the slack is a fragment, not a return", () => {
    expect(atStart(x0 + START_SLIP + 1, y0, x0, y0)).toBe(false);
    expect(atStart(x0 - START_SLIP - 1, y0, x0, y0)).toBe(false);
  });

  test("a wrapped line puts its other visual rows out of reach vertically", () => {
    expect(atStart(x0, y0 + START_SLIP + 1, x0, y0)).toBe(false);
  });
});

describe("charRange", () => {
  const text = "  const total = sum(a, b);";

  test("a run inside the line is ordered and kept", () => {
    expect(charRange(text, 8, 13)).toEqual({ a: 8, b: 13 });
    expect(charRange(text, 13, 8)).toEqual({ a: 8, b: 13 });
  });

  test("offsets past the line clamp to it", () => {
    expect(charRange(text, 8, 900)).toEqual({ a: 8, b: text.length });
    expect(charRange(text, -5, 7)).toEqual({ a: 0, b: 7 });
  });

  test("an empty run is a plain line note", () => {
    expect(charRange(text, 8, 8)).toBe(null);
  });

  test("indentation alone says nothing worth noting on its own", () => {
    expect(charRange(text, 0, 2)).toBe(null);
  });

  test("the whole line is a plain line note", () => {
    expect(charRange(text, 0, text.length)).toBe(null);
    expect(charRange(text, -1, text.length + 4)).toBe(null);
  });
});
