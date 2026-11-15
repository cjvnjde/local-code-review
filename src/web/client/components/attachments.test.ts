import { expect, test } from "bun:test";
import {
  attachmentDownloadSrc,
  attachmentSrc,
  imageTokens,
  uploadAttachment,
} from "./attachments.ts";

test("editable image tokens exclude code examples, escaped images and remote content", () => {
  const body = [
    "![Visible](images/first.png)",
    "`![example](images/inline.png)`",
    "\\![escaped](images/escaped.png)",
    "    ![indented](images/code.png)",
    "~~~md",
    "![fenced](images/fence.png)",
    "~~~",
    "![remote](https://example.com/tracker.png)",
    '![Second](<assets/second.png> "Title")',
  ].join("\n");
  const tokens = imageTokens(body);
  expect(tokens.map((token) => token.ref)).toEqual([
    "images/first.png",
    "assets/second.png",
  ]);
  for (const token of tokens)
    expect(body.slice(token.from, token.to)).toBe(token.ref);
  const token = tokens[1]!;
  expect(
    body.slice(0, token.from) + "images/edited.png" + body.slice(token.to),
  ).toContain('![Second](<images/edited.png> "Title")');
});

test("download links accept arbitrary local attachment files without treating them as images", () => {
  for (const ref of [
    "images/0123456789abcdef-report.bin",
    "assets/report.json",
    "./images/report.pdf",
  ]) {
    expect(attachmentDownloadSrc(ref)).toContain("/api/attachment?ref=");
    expect(attachmentDownloadSrc(ref)).toEndWith("&download=1");
    expect(attachmentSrc(ref)).toBe("");
  }
  for (const ref of [
    "../private.bin",
    "./review.md",
    "review.md",
    "images/../secret",
    "images%2fsecret.bin",
    "images/folder/file.bin",
    "https://evil.example/data.bin",
    "data:text/html,bad",
    "images/evil.html?x=1",
  ]) {
    expect(attachmentDownloadSrc(ref)).toBe("");
  }
  expect(imageTokens("[Report](images/0123456789abcdef-report.bin)")).toEqual(
    [],
  );
});

test("binary uploads preserve bytes, unknown MIME and the original filename header", async () => {
  const originalFetch = globalThis.fetch;
  const raw = new Uint8Array([0, 255, 254, 128]);
  const file = new File([raw], "résumé report [final].bin");
  try {
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      expect(url).toBe("/api/attach");
      expect(init!.method).toBe("POST");
      expect(new Headers(init!.headers).get("content-type")).toBe(
        "application/octet-stream",
      );
      expect(
        decodeURIComponent(
          new Headers(init!.headers).get("x-attachment-name")!,
        ),
      ).toBe(file.name);
      expect(new Uint8Array(await (init!.body as Blob).arrayBuffer())).toEqual(
        raw,
      );
      return Response.json({ ref: "images/0123456789abcdef-report.bin" });
    }) as typeof fetch;
    expect(await uploadAttachment(file, file.name)).toBe(
      "images/0123456789abcdef-report.bin",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upload failures expose the limit error and never accept an unsafe returned path", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      Response.json(
        { error: "That file exceeds the 12 MiB attachment limit." },
        { status: 413 },
      )) as typeof fetch;
    await expect(uploadAttachment(new Blob())).rejects.toThrow("12 MiB");
    globalThis.fetch = (async () =>
      Response.json({ ref: "../private.bin" })) as typeof fetch;
    await expect(uploadAttachment(new Blob())).rejects.toThrow(
      "valid attachment reference",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image filenames with escaped Markdown punctuation remain annotatable", () => {
  const body = "![capture \\[final\\] \\_draft\\_.png](images/capture.png)";
  const [token] = imageTokens(body);
  expect(token!.label).toBe("capture [final] _draft_.png");
  expect(body.slice(token!.from, token!.to)).toBe("images/capture.png");
});
