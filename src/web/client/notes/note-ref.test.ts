import { describe, expect, test } from "bun:test";
import {
  insertRef,
  noteByRef,
  plainRefs,
  refIn,
  refLabel,
  refOf,
  refToken,
} from "./note-ref.ts";

// Notes as the page holds them: the anchors say which kind of note it is, the id carries its tail.
const line = (tail: string, file = "src/cli.ts", label = "42") => ({
  id: `${file}|n42|n42|#${tail}`,
  file,
  label,
  a: "n42",
  b: "n42",
  start: 42,
  end: 42,
  body: "",
});
const whole = (tail: string, file = "src/cli.ts") => ({
  id: `${file}|*|*|#${tail}`,
  file,
  label: "",
  a: "*",
  b: "*",
  start: 0,
  end: 0,
  body: "",
});
const overall = (tail: string) => ({
  id: `|@|@|#${tail}`,
  file: "",
  label: "",
  a: "@",
  b: "@",
  start: 0,
  end: 0,
  body: "",
});

describe("refOf", () => {
  test("a reference is the tail every minted id ends with", () => {
    expect(refOf("src/cli.ts|n42|n42|#mk1a")).toBe("mk1a");
    expect(refOf("src/cli.ts|n42|n42|12-20|#mk1a")).toBe("mk1a");
    expect(refOf("|@|@|#mk1a")).toBe("mk1a");
  });

  test("an id that was never minted here names nothing", () => {
    expect(refOf("src/cli.ts|n42|n42")).toBe("");
    expect(refOf("")).toBe("");
    expect(refOf(null)).toBe("");
  });
});

describe("refIn", () => {
  test("the scheme is what says a link is a reference", () => {
    expect(refIn("lcr:mk1a")).toBe("mk1a");
    expect(refIn("<lcr:mk1a>")).toBe("mk1a");
    expect(refIn("LCR:mk1a")).toBe("mk1a");
  });

  test("an ordinary link stays an ordinary link", () => {
    expect(refIn("https://example.com")).toBe("");
    expect(refIn("./src/cli.ts")).toBe("");
    expect(refIn("")).toBe("");
  });
  test("short references and copied local comment links name the same stable id", () => {
    expect(refIn("#mk1a")).toBe("mk1a");
    expect(refIn("http://localhost:4321/#note=mk1a")).toBe("mk1a");
    expect(refIn("#note=mk1a")).toBe("mk1a");
    expect(refIn("https://example.com/#note=mk1a")).toBe("");
    expect(refIn("http://localhost:4321/other#note=mk1a")).toBe("");
    expect(refIn('lcr:mk1a" onclick=evil')).toBe("");
  });
});

describe("noteByRef", () => {
  const notes = [line("mk1a"), whole("mk1b"), overall("mk1c")];

  test("it finds the one note a reference names", () => {
    expect(noteByRef("mk1b", notes)).toBe(notes[1]);
  });

  test("a note the review no longer holds is named by nothing", () => {
    expect(noteByRef("gone", notes)).toBe(null);
    expect(noteByRef("", notes)).toBe(null);
  });

  test("a reference several notes answer to names none of them", () => {
    const twice = [line("mk1a"), line("mk1a", "src/other.ts")];
    expect(noteByRef("mk1a", twice)).toBe(null);
  });
});

describe("refLabel", () => {
  test("the file's own name is enough beside the note the reference stands in", () => {
    expect(refLabel(line("mk1a"))).toBe("cli.ts:42");
    expect(refLabel(whole("mk1b"))).toBe("cli.ts (whole file)");
    expect(refLabel(overall("mk1c"))).toBe("Overall note");
  });
});

describe("refToken", () => {
  test("it writes the same short token for every note scope", () => {
    expect(refToken(line("mk1a"))).toBe("#mk1a");
    expect(refToken(whole("mk1b"))).toBe("#mk1b");
    expect(refToken(overall("mk1c"))).toBe("#mk1c");
  });

  test("moving or renaming the note leaves its reference unchanged", () => {
    expect(refToken(line("mk1a", "src/[id]/page.ts"))).toBe("#mk1a");
  });
});

describe("plainRefs", () => {
  test("a reference reads as the note it names where there is no room for a link", () => {
    expect(plainRefs("Same as [src/cli.ts:42](lcr:mk1a), see there")).toBe(
      "Same as src/cli.ts:42, see there",
    );
    expect(plainRefs("[src/\\[id\\]/page.ts:42](lcr:mk1a)")).toBe(
      "src/[id]/page.ts:42",
    );
  });

  test("an ordinary link is left as it was written", () => {
    expect(plainRefs("[docs](https://example.com)")).toBe(
      "[docs](https://example.com)",
    );
    expect(plainRefs("")).toBe("");
  });
});

describe("insertRef", () => {
  const token = "[src/cli.ts:42](lcr:mk1a)";

  test("it lands where the caret is, one space clear of the words around it", () => {
    const out = insertRef("Same as, see there", 7, 7, token);
    expect(out.value).toBe(`Same as ${token}, see there`);
    expect(out.value.slice(out.caret)).toBe(", see there");
  });

  test("an empty box takes the reference on its own", () => {
    expect(insertRef("", 0, 0, token)).toEqual({
      value: token,
      caret: token.length,
    });
  });

  test("it replaces what was selected, and needs no space against a line break", () => {
    expect(insertRef("see that\n\n", 4, 8, token).value).toBe(
      `see ${token}\n\n`,
    );
  });

  test("a caret past the end of the text still writes at the end", () => {
    expect(insertRef("see", 99, 99, token).value).toBe(`see ${token}`);
  });
});

describe("reference boundaries", () => {
  test("only an entire minted suffix identifies a note", () => {
    for (const id of [
      "a|n1|n1|#abc/extra",
      "a|n1|n1|#abc?query",
      "a|n1|n1|#abc|more",
      "a|n1|n1|#ABC",
      "a#abc",
      undefined,
    ])
      expect(refOf(id)).toBe("");
    const valid = line("abc");
    expect(noteByRef("abc", new Set([null, { id: "legacy" }, valid]))).toBe(
      valid,
    );
    expect(
      noteByRef("abc", [valid, whole("other"), overall("abc")]),
    ).toBeNull();
  });

  test("reference destinations reject prefixes, suffixes and nonlocal protocols", () => {
    for (const url of [
      "prefixlcr:abc",
      "prefix#abc",
      "#note=abc/extra",
      "#note=abc?x",
      "lcr:abc/x",
      "lcr:ab<c",
      "lcr:ab>c",
      "httpx://localhost/#note=abc",
      "ftp://localhost/#note=abc",
      "http://localhost/#note=abc/extra",
      "http://localhost/#other#note=abc",
      "http://localhost.evil/#note=abc",
    ])
      expect(refIn(url)).toBe("");
    expect(refIn(" \tlcr:abc \n")).toBe("abc");
    expect(refIn("https://127.0.0.1:4321/#note=abc")).toBe("abc");
    expect(refIn("http://[::1]:4321/#note=abc")).toBe("abc");
  });

  test("UI reference labels prefer the captured element and title, falling back to mode and URL", () => {
    expect(
      refLabel({
        ...overall("abc"),
        web: {
          before: {
            element: { tag: "button" },
            mode: "area",
            title: "Checkout",
            url: "http://localhost/",
          },
        },
      }),
    ).toBe("UI · button · Checkout");
    expect(
      refLabel({
        ...overall("abc"),
        web: {
          before: { mode: "point", title: "", url: "http://localhost/path" },
        },
      }),
    ).toBe("UI · point · http://localhost/path");
    expect(refLabel({ ...line("abc"), label: "", start: 7 })).toBe("cli.ts:7");
    expect(refLabel({ ...line("abc"), label: "", start: 0 })).toBe("cli.ts:");
  });

  test("image reference labels identify side and coordinates instead of a misleading line number", () => {
    const image = { side: "old", x: 1, y: 2, width: 3, height: 4 };
    expect(refLabel({ ...whole("abc", "screens/home.png"), image })).toBe(
      "home.png (before · 1,2 · 3×4)",
    );
    expect(
      refLabel({
        ...whole("abc", "screens/home.png"),
        image: { ...image, side: "new" },
      }),
    ).toBe("home.png (after · 1,2 · 3×4)");
  });

  test("inserting a token preserves punctuation but separates following words", () => {
    for (const punctuation of [
      ".",
      ",",
      ";",
      ":",
      "!",
      "?",
      ")",
      "]",
      "\n",
      "\t",
    ])
      expect(insertRef("a" + punctuation + "tail", 1, 1, "#abc")).toEqual({
        value: "a #abc" + punctuation + "tail",
        caret: 6,
      });
    expect(insertRef("ahead word", 1, 1, "#abc")).toEqual({
      value: "a #abc head word",
      caret: 6,
    });
    expect(insertRef("line\nword", 5, 5, "#abc")).toEqual({
      value: "line\n#abc word",
      caret: 9,
    });
  });

  test("replacing a selected run removes exactly that run and clamps only outside the input", () => {
    expect(insertRef("before SELECT after", 7, 13, "#abc")).toEqual({
      value: "before #abc after",
      caret: 11,
    });
    expect(insertRef("word", -10, 99, "#abc")).toEqual({
      value: "#abc",
      caret: 4,
    });
    expect(insertRef("word", 2, 1, "#abc")).toEqual({
      value: "wo #abc rd",
      caret: 7,
    });
  });

  test("legacy references strip only their own Markdown link and preserve escaped labels", () => {
    expect(plainRefs("[a\\]b]( \t<lcr:abc>\t ) and [c](LCR:def)")).toBe(
      "a]b and c",
    );
    expect(plainRefs("[a](lcr:abc/not-a-ref) [b](https://localhost/)")).toBe(
      "[a](lcr:abc/not-a-ref) [b](https://localhost/)",
    );
    expect(plainRefs("[first](lcr:abc) [second](lcr:def)")).toBe(
      "first second",
    );
  });
});
