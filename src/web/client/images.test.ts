import { describe, expect, test } from "bun:test";
import { imagesHtml, isImage } from "./images.ts";

const file = (over: any = {}) => ({ path: "assets/logo.png", status: "modified", ...over });
/** The side each pane is drawn for, in the order the panes appear. */
const sides = (html: string) => [...html.matchAll(/class="imgf (old|new)"/g)].map((m) => m[1]);

describe("isImage", () => {
  test("reads the extension, whatever its case", () => {
    expect(isImage("a/b/logo.PNG")).toBe(true);
    expect(isImage("icon.svg")).toBe(true);
    expect(isImage("src/logo.png.ts")).toBe(false);
    expect(isImage("Makefile")).toBe(false);
  });
});

describe("imagesHtml", () => {
  test("draws nothing for a file that is not an image", () => {
    expect(imagesHtml(file({ path: "src/app.ts" }))).toBe("");
  });

  test("a change is both sides, old before new", () => {
    const html = imagesHtml(file());
    expect(sides(html)).toEqual(["old", "new"]);
    expect(html).toContain("/api/blob?side=old&amp;path=assets%2Flogo.png");
    expect(html).toContain("/api/blob?side=new&amp;path=assets%2Flogo.png");
    expect(html).toContain("imgw two");
  });

  test("a file only added, or only deleted, has the one side it has", () => {
    expect(sides(imagesHtml(file({ status: "added" })))).toEqual(["new"]);
    expect(sides(imagesHtml(file({ status: "deleted" })))).toEqual(["old"]);
    expect(imagesHtml(file({ status: "added" }))).not.toContain("imgw two");
  });

  test("a rename says which name the old side is, and still asks under the new one", () => {
    const html = imagesHtml(file({ status: "renamed", from: "assets/mark.png" }));
    expect(html).toContain("assets/mark.png</span>");
    // The server maps the rename, so both sides are asked for by the name the diff lists.
    expect(html).toContain("/api/blob?side=old&amp;path=assets%2Flogo.png");
  });

  test("escapes the path it puts in the markup rather than trusting the file name", () => {
    const html = imagesHtml(file({ path: 'a"><b>.png', status: "added" }));
    expect(html).not.toContain('"><b>');
    expect(html).toContain("a%22%3E%3Cb%3E.png");
  });
});
