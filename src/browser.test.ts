import { describe, expect, test } from "bun:test";
import { browserCommand } from "./browser.ts";

describe("browserCommand", () => {
  test("uses the platform launcher", () => {
    expect(browserCommand("http://localhost:7777", "darwin")).toEqual(["open", "http://localhost:7777"]);
    expect(browserCommand("http://localhost:7777", "win32")).toEqual([
      "cmd",
      "/c",
      "start",
      "",
      "http://localhost:7777",
    ]);
    expect(browserCommand("http://localhost:7777", "linux")).toEqual(["xdg-open", "http://localhost:7777"]);
  });

  test("refuses anything that is not a plain HTTP URL", () => {
    expect(browserCommand("file:///etc/passwd", "darwin")).toBeNull();
    expect(browserCommand("http://localhost:7777 -a Calculator", "darwin")).toBeNull();
  });
});
