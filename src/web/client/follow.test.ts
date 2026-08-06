import { describe, expect, test } from "bun:test";
import { LEAD, cardAt, revealShift } from "./follow.ts";

// Three cards stacked down the pane, each 100px tall with a 10px gap, read against a top line of 0.
const tops = [-250, -140, -30];
const at = (line: number) => cardAt(tops.length, (i) => tops[i], line);

describe("cardAt", () => {
  test("the card the line falls inside is the current one", () => {
    expect(at(0)).toBe(2);
    expect(at(-100)).toBe(1);
    expect(at(-200)).toBe(0);
  });

  test("a card whose top has just reached the line takes over", () => {
    expect(at(-140)).toBe(1);
    expect(at(-141)).toBe(0);
  });

  test("in the gap between two cards the one above still holds the line", () => {
    expect(at(-35)).toBe(1);
  });

  test("above the first card that card is still the one being scrolled into", () => {
    expect(cardAt(3, (i) => [10, 120, 230][i], 0)).toBe(0);
  });

  test("an empty pane has no card to point at", () => {
    expect(cardAt(0, () => 0, 0)).toBe(-1);
  });
});

// A 22px row inside a pane spanning y 100..500.
const paneTop = 100, paneBottom = 500;
const shift = (rowTop: number) => revealShift(paneTop, paneBottom, rowTop, rowTop + 22);

describe("revealShift", () => {
  test("a row well inside the pane is left where it is", () => {
    expect(shift(300)).toBe(0);
    expect(shift(paneTop + LEAD)).toBe(0);
    expect(shift(paneBottom - LEAD - 22)).toBe(0);
  });

  test("a row past either edge comes back with the lead margin ahead of it", () => {
    expect(shift(paneTop)).toBe(-LEAD);
    expect(shift(20)).toBe(20 - paneTop - LEAD);
    expect(shift(paneBottom - 22)).toBe(LEAD);
  });

  test("a pane too short for both margins still settles the row instead of oscillating", () => {
    const top = 100, bottom = 130; // 30px of pane for a 22px row
    const back = revealShift(top, bottom, 90, 112, LEAD);
    expect(back).toBe(-14); // 4px of lead is all the pane can spare on each side
    expect(revealShift(top, bottom, 90 - back, 112 - back, LEAD)).toBe(0);
  });
});
