import { afterEach, describe, expect, test } from "bun:test";
import { autogrow, fitHeight } from "./autogrow.ts";

const MIN = 64,
  MAX = 320;

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
});

const computedStyle = Object.getOwnPropertyDescriptor(
  globalThis,
  "getComputedStyle",
);

afterEach(() => {
  if (computedStyle)
    Object.defineProperty(globalThis, "getComputedStyle", computedStyle);
  else Reflect.deleteProperty(globalThis, "getComputedStyle");
});

function textarea(
  metrics = {
    minHeight: "64px",
    borderTopWidth: "1px",
    borderBottomWidth: "2px",
  },
  offsetHeight = 40,
) {
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => metrics,
  });
  let scrollHeight = 100;
  const listeners = new Map<string, () => void>();
  const ta = {
    style: { height: "900px", resize: "both", overflowY: "" },
    offsetHeight,
    get scrollHeight() {
      return Math.max(scrollHeight, parseFloat(this.style.height) || 0);
    },
    addEventListener(name: string, fn: () => void) {
      listeners.set(name, fn);
    },
  };
  return {
    ta,
    setContent: (height: number) => {
      scrollHeight = height;
    },
    input: () => listeners.get("input")!(),
  };
}

describe("textarea growth", () => {
  test("includes borders, scrolls only beyond the cap, and shrinks after deletion", () => {
    const fixture = textarea();
    autogrow(fixture.ta, 200);
    expect(fixture.ta.style).toEqual({
      height: "103px",
      resize: "none",
      overflowY: "hidden",
    });
    fixture.setContent(197);
    fixture.input();
    expect(fixture.ta.style.height).toBe("200px");
    expect(fixture.ta.style.overflowY).toBe("hidden");
    fixture.setContent(198);
    fixture.input();
    expect(fixture.ta.style.height).toBe("200px");
    expect(fixture.ta.style.overflowY).toBe("auto");
    fixture.setContent(2);
    fixture.input();
    expect(fixture.ta.style.height).toBe("64px");
    expect(fixture.ta.style.overflowY).toBe("hidden");
  });

  test("the returned resizer fits programmatically replaced content", () => {
    const fixture = textarea();
    const fit = autogrow(fixture.ta, 200);
    fixture.setContent(120);
    fit();
    expect(fixture.ta.style.height).toBe("123px");
  });

  test("uses the rendered minimum when computed metrics are unavailable", () => {
    const fixture = textarea(
      { minHeight: "auto", borderTopWidth: "", borderBottomWidth: "invalid" },
      48,
    );
    fixture.setContent(10);
    autogrow(fixture.ta, 200);
    expect(fixture.ta.style.height).toBe("48px");
    fixture.setContent(75);
    fixture.input();
    expect(fixture.ta.style.height).toBe("75px");
  });

  test("unmeasured detached textareas can grow from zero", () => {
    const fixture = textarea(
      { minHeight: "", borderTopWidth: "", borderBottomWidth: "" },
      0,
    );
    fixture.setContent(0);
    autogrow(fixture.ta, 200);
    expect(fixture.ta.style.height).toBe("0px");
    fixture.setContent(21);
    fixture.input();
    expect(fixture.ta.style.height).toBe("21px");
  });
});
