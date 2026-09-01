import { describe, expect, test } from "bun:test";
import { fuzzyScore, rankReferenceNotes } from "./ref-search.ts";

const note=(id: string,file: string,body: string)=>({id,file,body});

describe("fuzzyScore", () => {
  test("matches ordered characters without requiring a literal substring", () => {
    expect(fuzzyScore("pnltx","Panel.tsx")).toBeNumber();
    expect(fuzzyScore("xyz","Panel.tsx")).toBeNull();
  });

  test("ranks a literal match above a scattered one", () => {
    expect(fuzzyScore("panel","Panel.tsx")!).toBeGreaterThan(fuzzyScore("pnltx","Panel.tsx")!);
  });
});

describe("rankReferenceNotes", () => {
  test("searches the file name and all of the comment body", () => {
    const notes=[
      note("body","src/other.ts","First line.\nThe resource handle leaks down here."),
      note("file","src/resource-handler.ts","Unrelated wording."),
      note("gone","src/view.ts","Nothing relevant."),
    ];
    expect(rankReferenceNotes(notes,"handle").map(n=>n.id)).toEqual(["file","body"]);
  });

  test("a fuzzy file-name match outranks an exact body-only match", () => {
    const notes=[
      note("body","src/view.ts","Panel rendering is broken."),
      note("file","src/PanelRenderer.tsx","The layout is broken."),
    ];
    expect(rankReferenceNotes(notes,"pnl").map(n=>n.id)).toEqual(["file","body"]);
    expect(rankReferenceNotes(notes,"panel").map(n=>n.id)).toEqual(["file","body"]);
  });

  test("query words may match across the file name and comment", () => {
    const notes=[
      note("mixed","src/Panel.tsx","The cleanup path leaks a listener."),
      note("partial","src/Panel.tsx","Use the shared colour token."),
    ];
    expect(rankReferenceNotes(notes,"pnl listener").map(n=>n.id)).toEqual(["mixed"]);
  });

  test("an empty query keeps review order and a miss returns nothing", () => {
    const notes=[note("a","a.ts","Alpha"),note("b","b.ts","Beta")];
    expect(rankReferenceNotes(notes," ")).toEqual(notes);
    expect(rankReferenceNotes(notes,"zqx")).toEqual([]);
  });
});
