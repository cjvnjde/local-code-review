import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveAttachment } from "../review/attach.ts";
import { createSession, type ReviewSession } from "../review/session.ts";
import { createHub } from "../server/events.ts";
import type { WebAnnotation } from "../shared/web-annotation.ts";
import {
  WebAnnotationInvalid,
  WebSelectionConflict,
  webSelectionKey,
  type WebCapture,
  type WebAnnotationTarget,
} from "../shared/web-review.ts";
import { createWebReview, type WebReviewController } from "./controller.ts";

const noteId = "|@|@|#visual";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

async function withController(
  run: (fixture: {
    web: WebReviewController;
    session: ReviewSession;
    events: unknown[];
    before: WebCapture;
    additional: WebCapture;
    after: WebCapture;
    annotation: WebAnnotation;
    target: WebAnnotationTarget;
    contents: () => Promise<string>;
    answer: () => Promise<void>;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "lcr-web-controller-"));
  const session = createSession(dir, ".review", "HEAD");
  const hub = createHub();
  const events: unknown[] = [];
  const off = hub.add((chunk) => events.push(JSON.parse(chunk.slice(6))));
  const web = createWebReview({
    url: "http://127.0.0.1:4321/settings",
    repoRoot: dir,
    outDir: ".review",
    session,
    hub,
    reviewUrl: () => "http://127.0.0.1:4322/",
  });
  try {
    const image =
      "images/" + (await saveAttachment(dir, ".review", png, "image/png"));
    const capture = (at: string): WebCapture => ({
      url: "http://127.0.0.1:4321/settings",
      title: "Workspace settings",
      at,
      mode: "element",
      rect: { x: 10, y: 20, width: 1, height: 1 },
      viewport: { width: 800, height: 600, dpr: 1 },
      scroll: { x: 0, y: 0 },
      page: image,
      area: image,
      selector: "button#save",
      components: [{ framework: "React", name: "Settings" }],
    });
    const before = capture("2026-01-01T00:00:00.000Z");
    const additional = capture("2026-01-01T00:00:01.000Z");
    const after = capture("2026-01-01T00:00:02.000Z");
    await session.save({
      comments: [
        {
          id: noteId,
          file: "",
          scope: "global",
          start: 0,
          end: 0,
          body: "Keep the save action aligned.",
          web: { before, additional: [additional], after: [after] },
        },
      ],
    });
    await run({
      web,
      session,
      events,
      before,
      additional,
      after,
      annotation: {
        image,
        width: 1,
        height: 1,
        padding: 0,
        marks: [
          {
            tool: "pen",
            color: "#ff0000",
            width: 1,
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        ],
      },
      target: {
        kind: "selection",
        index: 0,
        key: webSelectionKey(before),
        expected: "",
      },
      contents: () => readFile(path.join(dir, ".review", session.file), "utf8"),
      answer: async () => {
        await session.answer(
          session.file,
          noteId,
          "The original should remain as evidence.",
          "answered",
        );
      },
    });
  } finally {
    off();
    await web.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("web review controller without Chrome", () => {
  test("saved annotation writes publish one refresh, preserve evidence, and detach both input and returned state", async () => {
    await withController(
      async ({
        web,
        session,
        events,
        target,
        annotation,
        before,
        additional,
        after,
      }) => {
        const expected = structuredClone(annotation);
        const pending = web.annotate({ id: noteId, target, annotation });
        target.key = "changed after submitting";
        annotation.marks[0]!.color = "#000000";
        const result = await pending;
        expect(result.web).toEqual({
          before: { ...before, annotation: expected },
          additional: [additional],
          after: [after],
        });
        expect(events).toEqual([{ type: "review", file: session.file }]);
        result.web.before.rect.x = 300;
        result.web.before.annotation!.marks[0]!.color = "#000000";
        expect((await session.read()).notes[0]!.web).toEqual({
          before: { ...before, annotation: expected },
          additional: [additional],
          after: [after],
        });
      },
    );
  });

  test("concurrent stale proposals cannot overwrite the accepted annotation and the queue remains usable", async () => {
    await withController(
      async ({ web, session, events, target, annotation }) => {
        const first = web.annotate({ id: noteId, target, annotation });
        const stale = web.annotate({
          id: noteId,
          target,
          annotation: {
            ...annotation,
            marks: [
              {
                tool: "text",
                color: "#000000",
                at: { x: 0, y: 0 },
                text: "stale",
                size: 1,
              },
            ],
          },
        });
        const rejected =
          expect(stale).rejects.toBeInstanceOf(WebSelectionConflict);
        await first;
        await rejected;
        expect((await session.read()).notes[0]!.web!.before.annotation).toEqual(
          annotation,
        );
        expect(events).toHaveLength(1);
        const cleared = await web.annotate({
          id: noteId,
          target: { ...target, expected: annotation.image },
          annotation: null,
        });
        expect(cleared.web.before.annotation).toBeUndefined();
        expect(
          (await session.read()).notes[0]!.web!.before.annotation,
        ).toBeUndefined();
        expect(events).toHaveLength(2);
      },
    );
  });

  test("annotations select additional and comparison captures independently", async () => {
    await withController(
      async ({ web, session, annotation, additional, after, before }) => {
        for (const [kind, index, capture] of [
          ["selection", 1, additional],
          ["after", 0, after],
        ] as const) {
          await web.annotate({
            id: noteId,
            target: {
              kind,
              index,
              key: webSelectionKey(capture),
              expected: "",
            },
            annotation,
          });
        }
        expect((await session.read()).notes[0]!.web).toEqual({
          before,
          additional: [{ ...additional, annotation }],
          after: [{ ...after, annotation }],
        });
      },
    );
  });

  for (const invalid of [
    "missing PNG",
    "wrong dimensions",
    "traversal image",
    "empty marks",
  ] as const) {
    test(`rejects ${invalid} without rewriting the review or publishing refreshes`, async () => {
      await withController(
        async ({ web, contents, events, target, annotation }) => {
          const original = await contents();
          const bad = structuredClone(annotation);
          if (invalid === "missing PNG") bad.image = "images/missing.png";
          if (invalid === "wrong dimensions") bad.width = 2;
          if (invalid === "traversal image")
            bad.image = "images/../../outside.png";
          if (invalid === "empty marks") bad.marks = [];
          await expect(
            web.annotate({ id: noteId, target, annotation: bad }),
          ).rejects.toBeInstanceOf(WebAnnotationInvalid);
          expect(await contents()).toBe(original);
          expect(events).toEqual([]);
        },
      );
    });
  }

  test("removing the first selection promotes additional evidence and clears comparisons without losing the conversation", async () => {
    await withController(
      async ({ web, session, events, before, additional }) => {
        const first = await web.removeSelection({
          id: noteId,
          index: 0,
          key: webSelectionKey(before),
        });
        expect(first.web).toEqual({ before: additional, after: [] });
        const last = await web.removeSelection({
          id: noteId,
          index: 0,
          key: webSelectionKey(additional),
        });
        expect(last.web).toBeNull();
        const saved = (await session.read()).notes[0]!;
        expect(saved.web).toBeUndefined();
        expect(saved.id).toBe(noteId);
        expect(saved.body).toBe("Keep the save action aligned.");
        expect(saved.scope).toBe("global");
        expect(events).toEqual([
          { type: "review", file: session.file },
          { type: "review", file: session.file },
        ]);
      },
    );
  });

  test("removing an additional selection preserves the original capture and its comparisons", async () => {
    await withController(
      async ({ web, session, before, after, additional }) => {
        const removed = await web.removeSelection({
          id: noteId,
          index: 1,
          key: webSelectionKey(additional),
        });
        expect(removed.web).toEqual({ before, after: [after] });
        expect((await session.read()).notes[0]!.web).toEqual(removed.web);
      },
    );
  });

  test("a stale removal does not consume the queue or mutate persisted evidence", async () => {
    await withController(
      async ({ web, contents, events, additional, before, after }) => {
        const original = await contents();
        const stale = web.removeSelection({
          id: noteId,
          index: 1,
          key: webSelectionKey(before),
        });
        const valid = web.removeSelection({
          id: noteId,
          index: 1,
          key: webSelectionKey(additional),
        });
        await expect(stale).rejects.toBeInstanceOf(WebSelectionConflict);
        expect((await valid).web).toEqual({ before, after: [after] });
        expect(await contents()).not.toBe(original);
        expect(events).toHaveLength(1);
      },
    );
  });

  for (const payload of [
    { index: 0, key: "" },
    { id: noteId, draftId: crypto.randomUUID(), index: 0, key: "" },
    { id: noteId, index: -1, key: "" },
    { id: noteId, index: 101, key: "" },
    { id: noteId, index: 0.5, key: "" },
    { draftId: crypto.randomUUID(), index: 0, key: "" },
  ]) {
    test(`rejects ambiguous or invalid selection removal ${JSON.stringify(payload)}`, async () => {
      await withController(async ({ web, contents, events }) => {
        const original = await contents();
        await expect(web.removeSelection(payload)).rejects.toBeInstanceOf(
          Error,
        );
        expect(await contents()).toBe(original);
        expect(events).toEqual([]);
      });
    });
  }

  test("annotation requires exactly one existing owner and a valid target", async () => {
    await withController(
      async ({ web, contents, events, target, annotation }) => {
        const original = await contents();
        for (const payload of [
          { target, annotation },
          { id: noteId, draftId: crypto.randomUUID(), target, annotation },
          { id: "", target, annotation },
          { id: noteId, target: { ...target, index: -1 }, annotation },
        ]) {
          await expect(web.annotate(payload)).rejects.toBeInstanceOf(
            WebAnnotationInvalid,
          );
        }
        await expect(
          web.annotate({ draftId: crypto.randomUUID(), target, annotation }),
        ).rejects.toBeInstanceOf(WebSelectionConflict);
        await expect(
          web.annotate({ id: "|*|*|#missing", target, annotation }),
        ).rejects.toBeInstanceOf(WebSelectionConflict);
        expect(await contents()).toBe(original);
        expect(events).toEqual([]);
      },
    );
  });

  test("answered evidence stays immutable through controller mutation requests", async () => {
    await withController(
      async ({ web, contents, events, target, annotation, before, answer }) => {
        await answer();
        const original = await contents();
        await expect(
          web.annotate({ id: noteId, target, annotation }),
        ).rejects.toBeInstanceOf(WebSelectionConflict);
        await expect(
          web.removeSelection({
            id: noteId,
            index: 0,
            key: webSelectionKey(before),
          }),
        ).rejects.toBeInstanceOf(WebSelectionConflict);
        expect(await contents()).toBe(original);
        expect(events).toEqual([]);
      },
    );
  });

  test("deleted and nonvisual notes fail before a browser can launch, including after queue errors", async () => {
    await withController(async ({ web, session, events, target }) => {
      await session.remove(noteId);
      await expect(web.review(noteId)).rejects.toThrow("no longer exists");
      await expect(web.focus(noteId)).rejects.toThrow("no longer exists");
      await expect(web.captureAfter(noteId)).rejects.toThrow(
        "no longer exists",
      );
      await expect(
        web.removeSelection({ id: noteId, index: 0, key: target.key }),
      ).rejects.toThrow("no longer exists");
      await expect(web.discardDraft(crypto.randomUUID())).rejects.toThrow(
        "no longer exists",
      );
      await session.save({
        comments: [
          {
            id: noteId,
            file: "",
            scope: "global",
            start: 0,
            end: 0,
            body: "An overall observation without captured UI.",
          },
        ],
      });
      await expect(web.focus(noteId)).rejects.toThrow("no longer exists");
      await expect(web.captureAfter(noteId)).rejects.toThrow(
        "no longer exists",
      );
      expect(web.status().state).toBe("closed");
      expect(web.replyDraft(noteId)).toEqual({ reply: true, web: null });
      expect(web.draft("../../other-review")).toBeUndefined();
      expect(events).toEqual([]);
    });
  });
});
