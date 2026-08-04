import { describe, expect, test } from "bun:test";
import { editorAction } from "./keys.ts";

const key = (key: string, mods: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) =>
  ({ key, ...mods });

describe("editorAction", () => {
  test("by default enter breaks the line and shift+enter saves", () => {
    expect(editorAction(key("Enter"), false)).toBe("newline");
    expect(editorAction(key("Enter", { shiftKey: true }), false)).toBe("save");
  });

  test("the inverted setting swaps the two", () => {
    expect(editorAction(key("Enter"), true)).toBe("save");
    expect(editorAction(key("Enter", { shiftKey: true }), true)).toBe("newline");
  });

  test("cmd or ctrl saves under either setting", () => {
    for (const enterSaves of [false, true]) {
      expect(editorAction(key("Enter", { metaKey: true }), enterSaves)).toBe("save");
      expect(editorAction(key("Enter", { ctrlKey: true }), enterSaves)).toBe("save");
      expect(editorAction(key("Enter", { ctrlKey: true, shiftKey: true }), enterSaves)).toBe("save");
    }
  });

  test("escape cancels and other keys are left to the textarea", () => {
    expect(editorAction(key("Escape"), false)).toBe("cancel");
    expect(editorAction(key("Escape", { shiftKey: true }), true)).toBe("cancel");
    expect(editorAction(key("a"), false)).toBe(null);
    expect(editorAction(key("Tab", { shiftKey: true }), true)).toBe(null);
  });
});
