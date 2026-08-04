import { describe, expect, test } from "bun:test";
import { unviewCommented } from "./persistence.ts";
import { state } from "./state.ts";

const note = (file: string) => ({ id: file + "|n1|n1", file, body: "x" });

describe("unviewCommented", () => {
  test("only files that carry a note lose the viewed mark", () => {
    state.notes = new Map([["a", note("src/a.ts")], ["b", note("src/b.ts")]]);
    state.viewed = new Map([
      ["src/a.ts", { h: "h1", auto: false }],
      ["src/c.ts", { h: "h3", auto: false }],
    ]);
    state.folded = new Set(["src/a.ts", "src/c.ts"]);

    expect([...unviewCommented()].sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect([...state.viewed.keys()]).toEqual(["src/c.ts"]);
    expect([...state.folded]).toEqual(["src/c.ts"]);
  });

  test("two notes on one file unview it once and leave the rest alone", () => {
    state.notes = new Map([["a1", note("src/a.ts")], ["a2", note("src/a.ts")]]);
    state.viewed = new Map([["src/a.ts", { h: "h1", auto: true }]]);
    state.folded = new Set<string>();

    expect([...unviewCommented()]).toEqual(["src/a.ts"]);
    expect(state.viewed.size).toBe(0);
  });

  test("no notes means every viewed mark survives", () => {
    state.notes = new Map();
    state.viewed = new Map([["src/a.ts", { h: "h1", auto: false }]]);
    state.folded = new Set(["src/a.ts"]);

    expect(unviewCommented().size).toBe(0);
    expect(state.viewed.size).toBe(1);
    expect(state.folded.size).toBe(1);
  });
});
