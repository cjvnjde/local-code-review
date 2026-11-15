import { describe, expect, test } from "bun:test";
import {
  colorPreview,
  colorWithAlpha,
  findColors,
  parseColor,
  replaceColor,
} from "./color-literals.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown.tsx";
import { ReviewReferences } from "../notes/references.tsx";
const mdHtml = (body: string) =>
  renderToStaticMarkup(createElement(Markdown, { body }));

describe("CSS color literals", () => {
  test("short, long, and alpha hex values normalize without losing alpha", () => {
    for (const [value, hex] of [
      ["#AbC", "#aabbcc"],
      ["#aBc8", "#aabbcc88"],
      ["#012345", "#012345"],
      ["#ABCDEF00", "#abcdef00"],
    ])
      expect(parseColor(value!)).toBe(hex!);
  });

  test("legacy and modern rgb/hsl accept ordinary CSS channel and alpha syntax", () => {
    for (const [value, hex] of [
      ["rgb(255, 0, 128)", "#ff0080"],
      ["rgba(100%, 0%, 0%, 50%)", "#ff000080"],
      ["RGB(100% 0 0 / .25)", "#ff000040"],
      ["rgba(1e2 0 +0 / 0)", "#64000000"],
      ["rgb(none 0 255 / none)", "#0000ff00"],
      ["hsl(120, 100%, 50%)", "#00ff00"],
      ["hsla(240 100% 50% / 50%)", "#0000ff80"],
      ["hsl(-.5turn 100% 50%)", "#00ffff"],
      ["hsl(200grad 100% 50%)", "#00ffff"],
      ["hsl(0rad 100% 50% / 0)", "#ff000000"],
      ["rgb(300 -5 0 / 200%)", "#ff0000ff"],
    ])
      expect(parseColor(value!)).toBe(hex!);
  });

  test("malformed syntax, style injection, variables and nonliteral colors are rejected", () => {
    for (const value of [
      "#12",
      "#12345",
      "#1234567",
      "#123456789",
      "#abcg",
      " #abc ",
      "red",
      "transparent",
      "var(--color)",
      "url(https://example.com)",
      "rgb(1, 2 3)",
      "rgb(1, 2, 3 / .5)",
      "rgb(10%, 0, 0)",
      "rgb(1 2 3 /)",
      "rgb(1 2 3 / .5 / .2)",
      "rgb(NaN 0 0)",
      "rgb(1e999 0 0)",
      "hsl(1foo 50% 50%)",
      "hsl(0, 50, 50)",
      "rgb(calc(1 + 2) 0 0)",
      "rgb(0 0 0);background:url(x)",
      '#abc" onmouseover="alert(1)',
      "#abc;background:red",
    ])
      expect(parseColor(value)).toBeNull();
    expect(parseColor("hsl(1e308rad 100% 50%)")).toMatch(/^#[\da-f]{6}$/);
  });

  test("finders keep source offsets and reject identifiers, escaped hex and URL fragments", () => {
    const source =
      "keep #abc, `#1234`\n```css\ncolor: rgb(1 2 3 / 25%);\n```\nhsl(0 100% 50%)";
    const colors = findColors(source);
    expect(colors.map((color) => color.value)).toEqual([
      "#abc",
      "#1234",
      "rgb(1 2 3 / 25%)",
      "hsl(0 100% 50%)",
    ]);
    for (const color of colors)
      expect(source.slice(color.from, color.to)).toBe(color.value);
    expect(
      findColors(
        "name#abc #abcde #abcdefghi #aabbccdd00 \\#abc /#abc https://e.test/#abc my-rgb(1 2 3) rgb(1 2 3)tail é#abc",
      ),
    ).toEqual([]);
    expect(
      findColors(
        'https://e.test/?color=#abc [section](#abc) url("#abc") [color](rgb(1 2 3))',
      ),
    ).toEqual([]);
  });

  test("replacement changes one literal, preserves Markdown and returns the replacement selection", () => {
    const source =
      "Before **keep** #abc and `#abc`\n```css\na { color: rgba(10, 20, 30, .2); }\n```\n[link](https://e.test/#abc) ![shot](images/a.png)";
    const target = findColors(source)[2]!;
    const written = replaceColor(source, target, "#00ff0080")!;
    expect(written.value).toBe(
      source.slice(0, target.from) + "#00ff0080" + source.slice(target.to),
    );
    expect(written.value.slice(written.from, written.to)).toBe("#00ff0080");
    expect(written.value.startsWith("Before **keep** #abc and `#abc`")).toBe(
      true,
    );
    expect(
      written.value.endsWith(
        "[link](https://e.test/#abc) ![shot](images/a.png)",
      ),
    ).toBe(true);
  });

  test("insertion preserves selected noncolor text and stale or unsafe replacements are refused", () => {
    expect(
      replaceColor("before after", { from: 7, to: 7, value: "" }, "#1234"),
    ).toEqual({ value: "before #1234 after", from: 7, to: 12 });
    expect(
      replaceColor("before", { from: 3, to: 3, value: "" }, "#abc"),
    ).toEqual({ value: "bef #abc ore", from: 4, to: 8 });
    const target = findColors("before #abc after")[0]!;
    expect(replaceColor("before #def after", target, "#000")).toBeNull();
    expect(
      replaceColor("before #abc after", target, "red;display:none"),
    ).toBeNull();
    expect(
      replaceColor("before", { from: 0, to: 6, value: "before" }, "#000"),
    ).toBeNull();
    for (const from of [-1, 100, 1.5, NaN])
      expect(
        replaceColor("before", { from, to: from, value: "" }, "#000"),
      ).toBeNull();
  });

  test("alpha hex is not mistaken for a missing note, but real note references win", () => {
    expect(mdHtml("Color #aabbccdd")).not.toContain("unavailable");
    const note = {
      id: "src/color.css|n1|n1|#aabbccdd",
      file: "src/color.css",
      label: "1",
      a: "n1",
      b: "n1",
      start: 1,
      end: 1,
      body: "Keep reference ownership",
    };
    const html = renderToStaticMarkup(
      createElement(ReviewReferences, {
        notes: [
          {
            ...note,
            id: note.id,
            key: "",
            status: "pending",
            detail: "",
            messages: [],
          },
        ],
        files: [],
        followFile: () => {},
        follow: () => {},
        children: createElement(Markdown, { body: "See #aabbccdd" }),
      }),
    );
    expect(html).toContain("src/color.css:1");
  });
});

describe("modern CSS literals", () => {
  test("Culori converts supported spaces and preserves original spelling and alpha", () => {
    for (const [value, expected] of [
      ["oklch(100% 0 0)", "#ffffff"],
      ["oklab(0 0 0 / 50%)", "#00000080"],
      ["lab(0% 0 0)", "#000000"],
      ["lch(0 0 0 / 0)", "#00000000"],
      ["hwb(120 0% 0% / .5)", "#00ff0080"],
      ["color(display-p3 1 0 0 / 25%)", "#ff000040"],
      ["OKLCH(none none none / none)", "#00000000"],
      ["color(display-p3 none 0 0)", "#000000"],
    ]) {
      expect(parseColor(value!)).toBe(expected!);
      expect(colorPreview(value!)?.css).toBe(value!);
    }
    for (const value of [
      "oklch(.6 .2 .5turn)",
      "lch(50% 20 200grad)",
      "lab(50% -20% 20%)",
      "oklab(60% .1 -.1)",
    ])
      expect(parseColor(value)).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("wide gamut previews are explicitly clipped, not rewritten originals", () => {
    const literal = "color(display-p3 1 0 0 / .25)";
    expect(colorPreview(literal)).toEqual({
      hex: "#ff000040",
      css: literal,
      outOfGamut: true,
      modern: true,
    });
    const source = `Keep ${literal} exactly.`;
    const target = findColors(source)[0]!;
    expect(target.value).toBe(literal);
    expect(replaceColor(source, target, target.value)?.value).toBe(source);
    expect(colorWithAlpha(literal, 0.5)).toBe("color(display-p3 1 0 0 / 0.5)");
    expect(colorWithAlpha("OKLCH(60% .2 30)", 0)).toBe("OKLCH(60% .2 30 / 0)");
    expect(colorWithAlpha("#abc", 0.5)).toBe("#aabbcc80");
    expect(colorWithAlpha(literal, NaN)).toBeNull();
    expect(colorWithAlpha(literal, 2)).toBeNull();
  });

  test("rejects arbitrary CSS, relative colors, custom profiles and nonfinite channels", () => {
    for (const value of [
      "oklch(var(--l) .2 30)",
      "oklch(from red l c h)",
      "oklch(50% .2 30);color:red",
      "oklch(50%, .2, 30)",
      "oklch(50% .2 30 /)",
      "oklch(50% .2 30 / .5 / .2)",
      "oklch(1e999 .2 30)",
      "oklch(.5 .2 10%)",
      "lab(50% 1deg 0)",
      "hwb(0 20 20)",
      "hwb(0 20% 20% / var(--alpha))",
      "color(--custom 1 0 0)",
      "color(display-p3 1 0 0 / Infinity)",
      "color(display-p3 1 0 0) url(x)",
      "color(display-p3 calc(1) 0 0)",
      "url(oklch(.5 .2 30))",
      " oklch(.5 .2 30) ",
      "oklch(.5 .2 30)junk",
    ])
      expect(parseColor(value)).toBeNull();
  });

  test("modern token boundaries, Markdown, insertion and stale offsets remain safe", () => {
    const literal = "oklch(60% .2 30 / .5)";
    const source = `Keep **${literal}**, and \`lab(50% 0 0)\`.`;
    const found = findColors(source);
    expect(found.map((color) => color.value)).toEqual([
      literal,
      "lab(50% 0 0)",
    ]);
    for (const color of found)
      expect(source.slice(color.from, color.to)).toBe(color.value);
    expect(
      findColors(
        `my-${literal} ${literal}tail /${literal} é${literal} https://e.test/${literal}`,
      ),
    ).toEqual([]);
    expect(findColors(`url("${literal}") [target](${literal})`)).toEqual([]);
    const target = found[0]!;
    expect(
      replaceColor("prefix " + source, target, "color(display-p3 1 0 0)"),
    ).toBeNull();
    expect(replaceColor(source, target, "hwb(120 0% 0%)")?.value).toBe(
      "Keep **hwb(120 0% 0%)**, and `lab(50% 0 0)`.",
    );
    expect(
      replaceColor("word", { from: 4, to: 4, value: "" }, literal)?.value,
    ).toBe(`word ${literal}`);
  });
});
