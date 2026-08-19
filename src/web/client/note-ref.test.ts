import { describe, expect, test } from "bun:test";
import { insertRef, noteByRef, plainRefs, refIn, refLabel, refOf, refToken } from "./note-ref.ts";

// Notes as the page holds them: the anchors say which kind of note it is, the id carries its tail.
const line = (tail: string, file = "src/cli.ts", label = "42") =>
  ({ id: `${file}|n42|n42|#${tail}`, file, label, a: "n42", b: "n42", start: 42, end: 42, body: "" });
const whole = (tail: string, file = "src/cli.ts") =>
  ({ id: `${file}|*|*|#${tail}`, file, label: "", a: "*", b: "*", start: 0, end: 0, body: "" });
const overall = (tail: string) =>
  ({ id: `|@|@|#${tail}`, file: "", label: "", a: "@", b: "@", start: 0, end: 0, body: "" });

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
  test("it writes the heading of the note it points at, and that note's tail", () => {
    expect(refToken(line("mk1a"))).toBe("[src/cli.ts:42](lcr:mk1a)");
    expect(refToken(whole("mk1b"))).toBe("[src/cli.ts (whole file)](lcr:mk1b)");
    expect(refToken(overall("mk1c"))).toBe("[Overall note](lcr:mk1c)");
  });

  test("a bracket in the heading is kept out of the link syntax", () => {
    expect(refToken(line("mk1a", "src/[id]/page.ts"))).toBe("[src/\\[id\\]/page.ts:42](lcr:mk1a)");
  });
});

describe("plainRefs", () => {
  test("a reference reads as the note it names where there is no room for a link", () => {
    expect(plainRefs("Same as [src/cli.ts:42](lcr:mk1a), see there")).toBe("Same as src/cli.ts:42, see there");
    expect(plainRefs("[src/\\[id\\]/page.ts:42](lcr:mk1a)")).toBe("src/[id]/page.ts:42");
  });

  test("an ordinary link is left as it was written", () => {
    expect(plainRefs("[docs](https://example.com)")).toBe("[docs](https://example.com)");
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
    expect(insertRef("", 0, 0, token)).toEqual({ value: token, caret: token.length });
  });

  test("it replaces what was selected, and needs no space against a line break", () => {
    expect(insertRef("see that\n\n", 4, 8, token).value).toBe(`see ${token}\n\n`);
  });

  test("a caret past the end of the text still writes at the end", () => {
    expect(insertRef("see", 99, 99, token).value).toBe(`see ${token}`);
  });
});
