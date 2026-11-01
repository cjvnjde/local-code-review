import { expect, test } from "bun:test";
import {
  readingAt,
  readingPlace,
  readingRow,
  resumeOffset,
  scrollVelocity,
  settleDelay,
} from "./reading-model.ts";

const file = (lines: string[], hash = "original") => ({
  path: "src/app.ts",
  hash,
  rows: lines.map((text, i) => ({ t: "ctx", n: i + 1, o: i + 1, text })),
});

test("a reading place follows unique captured code after lines move", () => {
  const original = file(["before", "continue here", "after"]);
  const place = readingPlace(original, 1);
  expect(readingRow(original, place)).toBe(1);
  expect(
    readingRow(
      file(["inserted", "before", "continue here", "after"], "changed"),
      place,
    ),
  ).toBe(2);
  expect(
    readingRow(file(["unrelated", "replacement", "after"], "changed"), place),
  ).toBe(-1);
});

test("repeated code needs an unambiguous neighbour; never guess by line proximity", () => {
  const place = readingPlace(file(["before", "}", "after"]), 1);
  expect(
    readingRow(
      file(["other", "}", "else", "before", "}", "after"], "new"),
      place,
    ),
  ).toBe(4);
  expect(
    readingRow(
      file(["before", "}", "after", "before", "}", "after"], "new"),
      place,
    ),
  ).toBe(-1);
});

test("file-only positions have no line and fast scrolling needs a longer pause", () => {
  const empty = file([]);
  expect(readingRow(empty, readingPlace(empty, -1))).toBe(-1);
  expect(settleDelay(2500, 900)).toBeGreaterThan(settleDelay(300, 900));
  expect(settleDelay(2500, 0)).toBeGreaterThan(settleDelay(300, 0));
  expect(settleDelay(scrollVelocity(1500, 10000), 900)).toBeGreaterThan(
    settleDelay(scrollVelocity(60, 10000), 900),
  );
});

test("Resume retains the row offset, falls back below the header for older markers, and fits a resized pane", () => {
  const place = readingPlace(file(["start", "read here"]), 1, 76);
  expect(resumeOffset(place.offset, 40, 900)).toBe(76);
  expect(resumeOffset(undefined, 40, 900)).toBe(40);
  expect(resumeOffset(10, 40, 900)).toBe(40);
  expect(resumeOffset(700, 40, 200)).toBe(160);
});

const card = (
  path: string,
  top: number,
  bottom: number,
  header: number,
  rows: number[],
  fold = false,
) => ({
  dataset: { path },
  getBoundingClientRect: () => ({ top, bottom }),
  classList: { contains: () => fold },
  querySelector: () => ({ getBoundingClientRect: () => ({ bottom: header }) }),
  querySelectorAll: () =>
    rows.map((top, i) => ({
      dataset: { i: String(i) },
      getBoundingClientRect: () => ({ top, bottom: top + 24 }),
    })),
});
const lookup = (path: string) => ({
  fi: path === "first" ? 0 : 1,
  file: { path, rows: [] },
});

test("reading position uses visible code below the sticky header, even across file boundaries", () => {
  const at = readingAt(
    { top: 100, bottom: 600 },
    [
      card("first", -500, 130, 130, [70, 94]),
      card("second", 140, 900, 180, [181, 205]),
    ],
    lookup,
  )!;
  expect(at.file.path).toBe("second");
  expect(at.index).toBe(0);
  expect(at.offset).toBe(81);
});

test("folded rows are skipped and a lazy placeholder cannot claim a visible line", () => {
  const at = readingAt(
    { top: 100, bottom: 600 },
    [
      card("first", 80, 200, 140, [145], true),
      card("second", 210, 900, 250, []),
    ],
    lookup,
  )!;
  expect(at.index).toBe(-1);
  expect(
    readingAt(
      { top: 100, bottom: 600 },
      [card("first", 700, 900, 740, [745])],
      lookup,
    ),
  ).toBeNull();
});

test("an unchanged hash may keep an exact repeated anchor but stale text still relocates safely", () => {
  const original = file(["same", "middle", "same"]);
  const place = readingPlace(original, 2);
  expect(readingRow(original, place)).toBe(2);
  expect(readingRow(file(["same", "middle", "replacement"]), place)).toBe(0);
  expect(
    readingRow(file(["same", "middle", "same"], "changed"), {
      ...place,
      before: undefined,
      after: undefined,
    }),
  ).toBe(-1);
});

test("either remembered neighbour can identify a repeated line but conflicting neighbours remain ambiguous", () => {
  const place = readingPlace(file(["before", "target", "after"]), 1);
  expect(
    readingRow(
      file(["other", "target", "after", "else", "target", "end"], "new"),
      place,
    ),
  ).toBe(1);
  expect(
    readingRow(
      file(["before", "target", "else", "other", "target", "end"], "new"),
      place,
    ),
  ).toBe(1);
  expect(
    readingRow(
      file(["before", "target", "else", "other", "target", "after"], "new"),
      place,
    ),
  ).toBe(-1);
  expect(
    readingRow(
      file(["other", "target", "else", "other", "target", "end"], "new"),
      place,
    ),
  ).toBe(-1);
});

test("hunk titles never satisfy captured text and empty anchors never resume an arbitrary blank row", () => {
  const place = readingPlace(file(["target"]), 0);
  const changed = {
    ...file([], "new"),
    rows: [
      { t: "hunk", text: "target" },
      { t: "ctx", n: 2, o: 2, text: "other" },
    ],
  };
  expect(readingRow(changed, place)).toBe(-1);
  expect(
    readingRow(file(["", "target"], "new"), { ...place, anchor: "", text: "" }),
  ).toBe(-1);
  const old = {
    path: "deleted.ts",
    hash: "old",
    rows: [{ t: "del", o: 9, text: "removed" }],
  };
  expect(readingPlace(old, 0)).toMatchObject({
    path: "deleted.ts",
    anchor: "o9",
    text: "removed",
  });
  expect(readingRow(old, readingPlace(old, 0))).toBe(0);
});

test("resume offsets remain finite and below the header even when the pane is shorter than it", () => {
  for (const bad of [undefined, NaN, Infinity, -Infinity])
    expect(resumeOffset(bad, 40, 200)).toBe(40);
  expect(resumeOffset(160, 40, 200)).toBe(160);
  expect(resumeOffset(161, 40, 200)).toBe(160);
  expect(resumeOffset(100, 40, 50)).toBe(40);
  expect(resumeOffset(-100, 40, 50)).toBe(40);
});

test("scroll speed is direction independent, caps idle time and uses the strict settle threshold", () => {
  expect(scrollVelocity(-100, 50)).toBe(scrollVelocity(100, 50));
  expect(scrollVelocity(100, 0)).toBe(100000);
  expect(scrollVelocity(100, 250)).toBe(400);
  expect(scrollVelocity(100, 10000)).toBe(400);
  expect(scrollVelocity(0, 0)).toBe(0);
  expect(settleDelay(900, 900)).toBe(1200);
  expect(settleDelay(900.01, 900)).toBe(2800);
  expect(settleDelay(1800, 0)).toBe(1200);
  expect(settleDelay(1800.01, 0)).toBe(2800);
});

test("only an unchanged diff can resolve an otherwise indistinguishable repeated anchor", () => {
  const original = file(["x", "target", "y", "x", "target", "y"]);
  const place = readingPlace(original, 4);
  expect(readingRow(original, place)).toBe(4);
  expect(readingRow({ ...original, hash: "changed" }, place)).toBe(-1);
  expect(readingRow(original, { ...place, anchor: "n99" })).toBe(-1);
});

test("matching at a file edge does not require a nonexistent neighbour", () => {
  const place = readingPlace(
    file(["unique-before", "target", "unique-after"]),
    1,
  );
  expect(
    readingRow(
      file(["target", "unique-after", "other", "target"], "new"),
      place,
    ),
  ).toBe(0);
  expect(
    readingRow(
      file(["target", "other", "unique-before", "target"], "new"),
      place,
    ),
  ).toBe(3);
  expect(readingPlace(file([]), -1)).toMatchObject({ anchor: "", text: "" });
});

test("reading geometry skips unregistered cards and keeps the first visible fallback", () => {
  const at = readingAt(
    { top: 100, bottom: 600 },
    [
      card("unknown", 80, 150, 100, [110]),
      card("first", 160, 300, 200, [], true),
      card("second", 310, 590, 350, [], true),
    ],
    (path) => (path === "unknown" ? null : lookup(path)),
  )!;
  expect(at.file.path).toBe("first");
  expect(at.index).toBe(-1);
  expect(at.offset).toBe(0);
});

test("cards touching but not crossing pane edges cannot claim a reading row", () => {
  expect(
    readingAt(
      { top: 100, bottom: 600 },
      [card("first", 0, 100, 0, [100])],
      lookup,
    ),
  ).toBeNull();
  expect(
    readingAt(
      { top: 100, bottom: 600 },
      [card("first", 600, 900, 600, [601])],
      lookup,
    ),
  ).toBeNull();
  const withoutHeader = {
    ...card("first", 80, 900, 0, [100, 124]),
    querySelector: () => null,
  };
  expect(
    readingAt({ top: 100, bottom: 600 }, [withoutHeader], lookup),
  ).toMatchObject({ index: 0, offset: 0 });
});
