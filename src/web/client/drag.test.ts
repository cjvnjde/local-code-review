import { describe, expect, test } from "bun:test";
import { ROW_SLIP, leftRow } from "./drag.ts";

// A code row is 20px tall; the pressed row here spans y 100..120.
const top = 100, bottom = 120;

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
