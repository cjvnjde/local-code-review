import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  boundedArray,
  parseRequest,
  readBoundedJson,
  readJsonRequest,
  RequestInputError,
} from "./request.ts";
import {
  annotationRequestSchema,
  noteRequestSchema,
  submitRequestSchema,
} from "./request-schemas.ts";

const encoder = new TextEncoder();
const note = {
  id: "note",
  file: "app.ts",
  body: "Review this.",
  start: 1,
  end: 1,
};

describe("bounded JSON reader", () => {
  test.each([undefined, "1"])(
    "counts streamed bytes even with Content-Length %s",
    async (length) => {
      let cancelled = false;
      let reads = 0;
      const request = new Request("http://localhost/", {
        method: "POST",
        headers: length === undefined ? {} : { "content-length": length },
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            reads++;
            controller.enqueue(
              encoder.encode(reads === 1 ? '{"body":"' : "x".repeat(16)),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
      });
      await expect(readBoundedJson(request, 16)).rejects.toMatchObject({
        status: 413,
      });
      expect(cancelled).toBe(true);
      expect(reads).toBeLessThanOrEqual(3);
    },
  );

  test("oversized declared bodies are cancelled without pulling bytes", async () => {
    let reads = 0;
    let cancelled = false;
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-length": "100" },
      body: new ReadableStream<Uint8Array>(
        {
          pull() {
            reads++;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    });
    await expect(readBoundedJson(request, 16)).rejects.toMatchObject({
      status: 413,
    });
    expect(reads).toBe(0);
    expect(cancelled).toBe(true);
  });

  test("cancellation cannot hold the oversized response hostage", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("oversized"));
        },
        cancel() {
          return new Promise<void>(() => {});
        },
      }),
    });
    await expect(readBoundedJson(request, 2)).rejects.toMatchObject({
      status: 413,
    });
  });

  test("accepts an exact byte limit and UTF-8 split between chunks", async () => {
    const bytes = encoder.encode('{"text":"雪"}');
    const request = new Request("http://localhost/", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    });
    expect(
      await readJsonRequest(
        request,
        z.strictObject({ text: z.string() }),
        bytes.length,
      ),
    ).toEqual({ text: "雪" });
    await expect(
      readBoundedJson(
        new Request("http://localhost/", {
          method: "POST",
          body: bytes,
        }),
        bytes.length - 1,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  test.each(["{", "", '{"x":NaN}'])(
    "rejects malformed JSON %s",
    async (body) => {
      await expect(
        readBoundedJson(
          new Request("http://localhost/", {
            method: "POST",
            body,
          }),
          1024,
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  test("rejects invalid UTF-8 instead of silently replacing bytes", async () => {
    await expect(
      readBoundedJson(
        new Request("http://localhost/", {
          method: "POST",
          body: new Uint8Array([34, 255, 34]),
        }),
        1024,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("request schemas", () => {
  test("triage is optional and accepts only the four independent classifications", () => {
    expect(parseRequest(noteRequestSchema, { comment: note }).comment).toEqual(
      note,
    );
    for (const triage of ["blocker", "bug", "suggestion", "question"]) {
      expect(
        parseRequest(noteRequestSchema, { comment: { ...note, triage } })
          .comment.triage,
      ).toBe(triage);
    }
    for (const triage of ["pending", "applied", "", null, [], 0]) {
      expect(() =>
        parseRequest(noteRequestSchema, { comment: { ...note, triage } }),
      ).toThrow(RequestInputError);
    }
  });

  test("submission requires an explicit bounded list of valid comments", () => {
    expect(parseRequest(submitRequestSchema, { comments: [] })).toEqual({
      comments: [],
    });
    expect(
      parseRequest(submitRequestSchema, {
        comments: [{ ...note, id: undefined }],
      }).comments,
    ).toHaveLength(1);
    for (const value of [
      null,
      [],
      {},
      { comments: null },
      { comments: {} },
      { comments: [null] },
      { comments: [{ ...note, end: 0 }] },
      { comments: [note], replace: "true" },
      { comments: [note], unknown: true },
      { comments: [{ ...note, unknown: true }] },
      { comments: Array(10001).fill(note) },
    ]) {
      expect(() => parseRequest(submitRequestSchema, value)).toThrow(
        RequestInputError,
      );
    }
  });

  test("oversized arrays fail before their members are parsed", () => {
    let visited = 0;
    const schema = boundedArray(
      z.unknown().transform((value) => {
        visited++;
        return value;
      }),
      2,
    );
    expect(() => parseRequest(schema, [1, 2, 3])).toThrow(RequestInputError);
    expect(visited).toBe(0);
  });

  test("large annotations retain geometry while malformed metadata stays invalid", () => {
    const annotation = {
      image: "images/annotation.png",
      width: 10,
      height: 10,
      padding: 0,
      marks: [
        {
          tool: "pen",
          color: "#ff0000",
          width: 1,
          points: Array.from({ length: 3000 }, () => ({ x: 1, y: 2 })),
        },
      ],
    };
    const payload = {
      id: "note",
      target: { kind: "selection", index: 0, key: "capture", expected: "" },
      annotation,
    };
    expect(JSON.stringify(payload).length).toBeGreaterThan(32768);
    expect(parseRequest(annotationRequestSchema, payload).annotation).toEqual(
      annotation,
    );
    expect(() =>
      parseRequest(annotationRequestSchema, {
        ...payload,
        annotation: { ...annotation, marks: [] },
      }),
    ).toThrow(RequestInputError);
    expect(() =>
      parseRequest(annotationRequestSchema, { ...payload, draftId: "draft" }),
    ).toThrow(RequestInputError);
  });
});
