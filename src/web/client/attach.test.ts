import { describe, expect, test } from "bun:test";
import { attachSrc, filesFrom, insertShot, labelFor, plainShots, shotHtml, shotToken, swapShot } from "./attach.ts";

describe("attachSrc", () => {
  test("a picture of this review is drawn from the review's own directory", () => {
    expect(attachSrc("images/a1b2c3.png")).toBe("/api/attachment?name=a1b2c3.png");
    expect(attachSrc("images/after-fix.PNG")).toBe("/api/attachment?name=after-fix.PNG");
    expect(attachSrc("<images/a1b2c3.png>")).toBe("/api/attachment?name=a1b2c3.png");
  });

  test("anything that is not one is not one, so it stays the link it was written as", () => {
    expect(attachSrc("https://example.com/shot.png")).toBe("");
    expect(attachSrc("docs/shot.png")).toBe("");
    expect(attachSrc("/images/shot.png")).toBe("");
    expect(attachSrc("images/notes.md")).toBe("");
    expect(attachSrc("images/")).toBe("");
    expect(attachSrc("")).toBe("");
  });

  test("no name reaches out of the directory, whatever the note says", () => {
    expect(attachSrc("images/../../etc/passwd.png")).toBe("");
    expect(attachSrc("images/sub/shot.png")).toBe("");
    expect(attachSrc("images/.hidden.png")).toBe("");
  });
});

describe("labelFor", () => {
  test("a file keeps its own name, without the extension", () => {
    expect(labelFor("overlapping-header.png")).toBe("overlapping-header");
    expect(labelFor("/Users/me/Desktop/Screenshot 2026-08-20.png")).toBe("Screenshot 2026-08-20");
  });

  test("a picture the clipboard had no name for is called what it is", () => {
    expect(labelFor("")).toBe("screenshot");
    expect(labelFor("image.png")).toBe("screenshot");
    expect(labelFor(".png")).toBe("screenshot");
  });

  test("a bracket in the name is kept out of the link syntax", () => {
    expect(labelFor("shot[1].png")).toBe("shot\\[1\\]");
  });
});

describe("insertShot", () => {
  test("a picture lands on a line of its own, one blank line clear of the prose", () => {
    const written = insertShot("This is wrong:", 14, 14, "![shot](images/a.png)");
    expect(written.value).toBe("This is wrong:\n\n![shot](images/a.png)");
    expect(written.caret).toBe(written.value.length);
  });

  test("prose after the caret carries on under it", () => {
    const written = insertShot("before after", 6, 6, "![a](images/a.png)");
    expect(written.value).toBe("before\n\n![a](images/a.png)\n\nafter");
    expect(written.value.slice(written.caret)).toBe("\n\nafter");
  });

  test("an empty note is just the picture, and a selection is replaced by it", () => {
    expect(insertShot("", 0, 0, "![a](images/a.png)").value).toBe("![a](images/a.png)");
    expect(insertShot("take this out", 5, 13, "![a](images/a.png)").value).toBe("take\n\n![a](images/a.png)");
  });

  test("offsets outside the text are read as its ends rather than as an error", () => {
    expect(insertShot("note", 99, 99, "![a](i)").value).toBe("note\n\n![a](i)");
    expect(insertShot("note", -3, -3, "![a](i)").value).toBe("![a](i)\n\nnote");
  });
});

describe("shotToken", () => {
  test("is the ordinary Markdown image, which is the whole of what is written down", () => {
    expect(shotToken("screenshot", "images/a1b2.png")).toBe("![screenshot](images/a1b2.png)");
  });
});

describe("filesFrom", () => {
  const item = (type: string) => ({ kind: "file", getAsFile: () => ({ type, name: "image.png" }) });

  test("a pasted screenshot is the picture in the clipboard", () => {
    const files = filesFrom({ items: [item("image/png")], files: [] });
    expect(files.length).toBe(1);
    expect(files[0].type).toBe("image/png");
  });

  test("a drop from the desktop is read off the files it carries", () => {
    expect(filesFrom({ files: [{ type: "image/webp", name: "a.webp" }] }).length).toBe(1);
  });

  test("text, and files lcr does not keep, are nothing to attach", () => {
    expect(filesFrom({ items: [{ kind: "string", getAsFile: () => null }] })).toEqual([]);
    expect(filesFrom({ files: [{ type: "application/pdf", name: "spec.pdf" }] })).toEqual([]);
    expect(filesFrom(null)).toEqual([]);
  });
});

describe("plainShots", () => {
  test("a summary reads a picture as what it was called", () => {
    expect(plainShots("look: ![the header](images/a.png)")).toBe("look: the header");
    expect(plainShots("![](images/a.png)")).toBe("image");
  });

  test("a link that is not an attached picture is left exactly as it was written", () => {
    expect(plainShots("![shot](https://example.com/a.png)")).toBe("![shot](https://example.com/a.png)");
    expect(plainShots("[a note](lcr:9f)")).toBe("[a note](lcr:9f)");
  });
});

describe("shotHtml", () => {
  test("is drawn where the note points at it, and opens whole in a tab of its own", () => {
    const html = shotHtml("/api/attachment?name=a.png", "the header");
    expect(html).toContain('<img src="/api/attachment?name=a.png"');
    expect(html).toContain('alt="the header"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  test("escapes what it is given rather than trusting the note it came out of", () => {
    const html = shotHtml("/api/attachment?name=a.png", '"><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });

  test("a picture with nothing written over it still says what it is", () => {
    expect(shotHtml("/api/attachment?name=a.png", "")).toContain('alt="attached image"');
  });
});

describe("swapShot", () => {
  test("the placeholder becomes the link, where the placeholder stood", () => {
    const swapped = swapShot("look:\n\n![…attaching](#lcr-attaching-1)", "![…attaching](#lcr-attaching-1)", "![a](images/a.png)");
    expect(swapped!.value).toBe("look:\n\n![a](images/a.png)");
    expect(swapped!.caret).toBe(swapped!.value.length);
  });

  test("a picture that never arrived takes the blank line it was given with it", () => {
    expect(swapShot("look:\n\nMARK", "MARK", "")!.value).toBe("look:");
    expect(swapShot("MARK", "MARK", "")!.value).toBe("");
    expect(swapShot("before\n\nMARK\n\nafter", "MARK", "")!.value).toBe("before\n\nafter");
  });

  test("a placeholder the reader deleted is nothing to swap", () => {
    expect(swapShot("changed my mind", "MARK", "![a](images/a.png)")).toBeNull();
  });
});

/* ---------- the editor's own half, on a stand-in for the box it wires ---------- */
/**
 * `wireAttach` is the one part of this that only exists against a document, and the part worth being
 * sure of: a picture that never makes it out of the box it was pasted into is a picture the review
 * never carried. The box is small enough to stand in for.
 */
class Fake extends EventTarget {
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  contains = () => false;
  querySelector = (_: string): any => null;
}
/** Stands in for a `.nbox`, which outlives the editors drawn into it. */
class FakeBox extends Fake {
  open: any = null;
  querySelector = (selector: string) => (selector === "textarea" ? this.open : null);
  /** A box that has an editor in it, the way one being written into does. */
  static with(ta: any) {
    const box = new FakeBox();
    box.open = ta;
    return box;
  }
}
class FakeText extends Fake {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  isConnected = true;
  grew = 0;
  focused = 0;
  setSelectionRange(from: number, to: number) {
    this.selectionStart = from;
    this.selectionEnd = to;
  }
  focus() {
    this.focused++;
  }
  constructor() {
    super();
    this.addEventListener("input", () => this.grew++);
  }
}
const paste = (files: any[]) => Object.assign(new Event("paste", { cancelable: true }), {
  clipboardData: { items: [], files },
});
const png = (name = "image.png") => ({ type: "image/png", name });
/** Lets the upload and the swap that follows it settle. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe("wireAttach", () => {
  test("a pasted picture is uploaded and written into the note", async () => {
    const { wireAttach } = await import("./attach.ts");
    const asked: any[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      asked.push({ url, type: init.headers["content-type"] });
      return Response.json({ name: "a1.png", ref: "images/a1.png" });
    }) as any;
    try {
      const ta = new FakeText(), box = FakeBox.with(ta);
      ta.value = "This is wrong:";
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      wireAttach(box, ta);
      const event = paste([png()]);
      box.dispatchEvent(new Event("noop"));
      ta.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      // The placeholder stands in the note while the picture travels.
      expect(ta.value).toContain("…attaching");
      await settle();
      expect(ta.value).toBe("This is wrong:\n\n![screenshot](images/a1.png)");
      expect(asked).toEqual([{ url: "/api/attach", type: "image/png" }]);
      // The box was asked to grow for the placeholder and again for the link.
      expect(ta.grew).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a paste of ordinary text is left to the box", async () => {
    const { wireAttach } = await import("./attach.ts");
    const ta = new FakeText(), box = FakeBox.with(ta);
    wireAttach(box, ta);
    const event = paste([{ type: "text/plain", name: "" }]);
    ta.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(ta.value).toBe("");
  });

  test("a picture that never arrives leaves no gap where it stood", async () => {
    const { wireAttach } = await import("./attach.ts");
    const original = globalThis.fetch, alerted: string[] = [];
    const noAlert = (globalThis as any).alert;
    globalThis.fetch = (async () => Response.json({ error: "no room on disk" }, { status: 500 })) as any;
    (globalThis as any).alert = (text: string) => alerted.push(text);
    try {
      const ta = new FakeText(), box = FakeBox.with(ta);
      ta.value = "look";
      ta.selectionStart = ta.selectionEnd = 4;
      wireAttach(box, ta);
      ta.dispatchEvent(paste([png()]));
      await settle();
      expect(ta.value).toBe("look");
      expect(alerted[0]).toContain("no room on disk");
    } finally {
      globalThis.fetch = original;
      (globalThis as any).alert = noAlert;
    }
  });

  test("a placeholder the reader deleted is not written over", async () => {
    const { wireAttach } = await import("./attach.ts");
    const original = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ ref: "images/a2.png" })) as any;
    try {
      const ta = new FakeText(), box = FakeBox.with(ta);
      wireAttach(box, ta);
      ta.dispatchEvent(paste([png()]));
      ta.value = "changed my mind";
      await settle();
      expect(ta.value).toBe("changed my mind");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a drag of files says the box will take them, and a drop of one takes it", async () => {
    const { wireAttach } = await import("./attach.ts");
    const original = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ ref: "images/a3.png" })) as any;
    try {
      const ta = new FakeText(), box = FakeBox.with(ta);
      wireAttach(box, ta);
      const transfer = { types: ["Files"], items: [], files: [png("shot-of-the-header.png")], dropEffect: "" };
      const over = Object.assign(new Event("dragover", { cancelable: true }), { dataTransfer: transfer });
      box.dispatchEvent(over);
      expect(box.classes.has("dropping")).toBe(true);
      expect(over.defaultPrevented).toBe(true);
      const drop = Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: transfer });
      box.dispatchEvent(drop);
      expect(box.classes.has("dropping")).toBe(false);
      expect(drop.defaultPrevented).toBe(true);
      await settle();
      expect(ta.value).toBe("![shot-of-the-header](images/a3.png)");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a drag of text is the browser's business, so dragging a word inside the box still works", async () => {
    const { wireAttach } = await import("./attach.ts");
    const ta = new FakeText(), box = FakeBox.with(ta);
    wireAttach(box, ta);
    const transfer = { types: ["text/plain"], items: [], files: [] };
    const over = Object.assign(new Event("dragover", { cancelable: true }), { dataTransfer: transfer });
    box.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(box.classes.has("dropping")).toBe(false);
    const drop = Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: transfer });
    box.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  test("a box wired twice takes one drop once, because the box outlives its editors", async () => {
    const { wireAttach } = await import("./attach.ts");
    const original = globalThis.fetch;
    let uploads = 0;
    globalThis.fetch = (async () => {
      uploads++;
      return Response.json({ ref: "images/a4.png" });
    }) as any;
    try {
      const first = new FakeText(), box = FakeBox.with(first);
      wireAttach(box, first);
      // The note is edited again: the same box, a second text box drawn into it.
      const second = new FakeText();
      box.open = second;
      wireAttach(box, second);
      const transfer = { types: ["Files"], items: [], files: [png()], dropEffect: "" };
      box.dispatchEvent(Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: transfer }));
      await settle();
      expect(uploads).toBe(1);
      // And into the editor that is actually open, not the one that was.
      expect(second.value).toBe("![screenshot](images/a4.png)");
      expect(first.value).toBe("");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a drop an inner box has already taken is not taken again on the way up", async () => {
    const { wireAttach } = await import("./attach.ts");
    const original = globalThis.fetch;
    let uploads = 0;
    globalThis.fetch = (async () => {
      uploads++;
      return Response.json({ ref: "images/a5.png" });
    }) as any;
    try {
      // A reply box stands inside the note box it answers, so a drop on it reaches both.
      const reply = new FakeText(), inner = FakeBox.with(reply);
      const note = new FakeText(), outer = FakeBox.with(note);
      wireAttach(outer, note);
      wireAttach(inner, reply);
      const transfer = { types: ["Files"], items: [], files: [png()], dropEffect: "" };
      const drop = Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: transfer });
      inner.dispatchEvent(drop);
      // The page bubbles the same event on to the box around it.
      outer.dispatchEvent(drop);
      await settle();
      expect(uploads).toBe(1);
      expect(reply.value).toBe("![screenshot](images/a5.png)");
      expect(note.value).toBe("");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a drop on a note with nothing open says where a picture goes", async () => {
    const { wireAttach } = await import("./attach.ts");
    const noAlert = (globalThis as any).alert, alerted: string[] = [];
    (globalThis as any).alert = (text: string) => alerted.push(text);
    try {
      const ta = new FakeText(), box = FakeBox.with(ta);
      wireAttach(box, ta);
      box.open = null; // the editor closed and the note is being read
      const transfer = { types: ["Files"], items: [], files: [png()], dropEffect: "" };
      // The drag is still taken — a drop only reaches a target that took it, and the browser's own
      // answer to a file nobody took is to open it over the review — but nothing is marked for it.
      const over = Object.assign(new Event("dragover", { cancelable: true }), { dataTransfer: transfer });
      box.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      expect(box.classes.has("dropping")).toBe(false);
      const drop = Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: transfer });
      box.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      expect(alerted[0]).toContain("drop the picture in there");
    } finally {
      (globalThis as any).alert = noAlert;
    }
  });
});
