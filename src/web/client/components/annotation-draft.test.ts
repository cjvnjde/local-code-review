import { describe, expect, test } from "bun:test";
import type { AnnotationMark } from "../../../shared/web-annotation.ts";
import {
  ANNOTATION_DRAFT_MAX_LENGTH,
  createAnnotationDraftStore,
  type AnnotationDraft,
  type AnnotationDraftIdentity,
  type AnnotationDraftResult,
  type AnnotationDraftStorage,
} from "./annotation-draft.ts";

class MemoryStorage implements AnnotationDraftStorage {
  values = new Map<string, string>();
  failure: "get" | "set" | "remove" | null = null;
  error = new Error("Storage is unavailable");
  getItem(key: string) {
    if (this.failure === "get") throw this.error;
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failure === "set") throw this.error;
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failure === "remove") throw this.error;
    this.values.delete(key);
  }
}

const identity: AnnotationDraftIdentity = {
  repo: "/work/project",
  read: "review-123",
  route: "/checkout?tab=summary",
  source: "images/capture-123.png",
  baseline: "[]",
  width: 300,
  height: 200,
  padding: 20,
};
const mark = (): AnnotationMark => ({
  tool: "pen",
  color: "#aabbcc",
  width: 3,
  points: [
    { x: 0, y: 0 },
    { x: 340, y: 240 },
  ],
});
const empty = (): AnnotationDraft => ({
  marks: [],
  path: null,
  pendingText: null,
  text: "",
});
const drawing = (): AnnotationDraft => ({ ...empty(), marks: [mark()] });
function value<T>(result: AnnotationDraftResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function error<T>(result: AnnotationDraftResult<T>) {
  if (result.ok) throw new Error("Expected a draft error");
  return result.error;
}
function seed(storage: MemoryStorage, draft = drawing()) {
  const store = createAnnotationDraftStore(identity, storage);
  value(store.save(draft));
  const key = [...storage.values.keys()][0]!;
  return { key, store };
}

describe("browser-local annotation drafts", () => {
  test("restores detached, whitelisted metadata without captures or uploads", () => {
    const storage = new MemoryStorage();
    const draft = drawing();
    Object.assign(draft, {
      pixels: "data:image/png;base64,secret",
      upload: "never",
    });
    Object.assign(draft.marks[0]!, { image: "data:image/png;base64,secret" });
    const { store } = seed(storage, draft);
    const restored = value(store.load())!;
    expect(restored).toEqual(drawing());
    expect([...storage.values.values()][0]).not.toContain("secret");
    expect([...storage.values.values()][0]).not.toContain("upload");
    expect(restored).not.toBe(draft);
    expect(restored.marks[0]).not.toBe(draft.marks[0]);
    if (draft.marks[0]!.tool === "pen") draft.marks[0]!.points[0]!.x = 120;
    expect(value(store.load())).toEqual(drawing());
    restored.marks.splice(0);
    expect(value(store.load())).toEqual(drawing());
  });

  test("isolates repository, review, route, capture, baseline and geometry", () => {
    const storage = new MemoryStorage();
    const { store: original } = seed(storage);
    const variants: Partial<AnnotationDraftIdentity>[] = [
      { repo: identity.repo + "-other" },
      { read: identity.read + "-other" },
      { route: identity.route + "-other" },
      { source: "images/another-capture.png" },
      { baseline: JSON.stringify([mark()]) },
      { width: identity.width + 1 },
      { height: identity.height + 1 },
      { padding: identity.padding + 1 },
    ];
    for (const variant of variants) {
      const separate = createAnnotationDraftStore(
        { ...identity, ...variant },
        storage,
      );
      expect(value(separate.load())).toBeNull();
      value(separate.save(empty()));
      expect(value(original.load())).toEqual(drawing());
      value(separate.clear());
      expect(value(original.load())).toEqual(drawing());
      expect(storage.values.size).toBe(1);
    }
  });

  test("uses an unambiguous key even when identity fields contain separators", () => {
    const storage = new MemoryStorage();
    const one = createAnnotationDraftStore(
      { ...identity, repo: "a:b", read: "c" },
      storage,
    );
    const two = createAnnotationDraftStore(
      { ...identity, repo: "a", read: "b:c" },
      storage,
    );
    value(one.save(drawing()));
    expect(value(two.load())).toBeNull();
    value(two.save(empty()));
    expect(storage.values.size).toBe(2);
  });

  test("keeps large applied baselines out of the storage key", () => {
    const storage = new MemoryStorage();
    const baseline = JSON.stringify(
      Array.from({ length: 10000 }, () => ({ x: 1, y: 2 })),
    );
    const store = createAnnotationDraftStore(
      { ...identity, baseline },
      storage,
    );
    value(store.save(empty()));
    const key = [...storage.values.keys()][0]!;
    expect(key.length).toBeLessThan(512);
    expect(value(store.load())).toEqual(empty());
  });

  test("captures the identity instead of retaining mutable caller state", () => {
    const storage = new MemoryStorage();
    const mutable = { ...identity };
    const store = createAnnotationDraftStore(mutable, storage);
    mutable.source = "images/changed.png";
    mutable.baseline = "changed";
    value(store.save(drawing()));
    expect(value(createAnnotationDraftStore(identity, storage).load())).toEqual(
      drawing(),
    );
    expect(
      value(createAnnotationDraftStore(mutable, storage).load()),
    ).toBeNull();
  });

  test("restores empty drawings, unfinished one-node paths and pending text", () => {
    const storage = new MemoryStorage();
    const { store } = seed(storage, empty());
    expect(value(store.load())).toEqual(empty());
    const unfinished: AnnotationDraft = {
      marks: [mark()],
      path: {
        tool: "path",
        color: "#123456",
        width: 2,
        closed: false,
        nodes: [
          {
            x: 4,
            y: 8,
            kind: "smooth",
            in: { x: 2, y: 6 },
            out: { x: 6, y: 10 },
          },
        ],
      },
      pendingText: { x: 340, y: 240 },
      text: "Not placed yet\nSecond line",
    };
    value(store.save(unfinished));
    expect(value(createAnnotationDraftStore(identity, storage).load())).toEqual(
      unfinished,
    );
    const restored = value(store.load())!;
    expect(restored.path?.nodes).toHaveLength(1);
    expect(restored.path?.nodes[0]).not.toBe(unfinished.path!.nodes[0]);
    expect(restored.pendingText).not.toBe(unfinished.pendingText);
    value(store.clear());
    expect(value(store.load())).toBeNull();
  });

  test("rejects malformed, unsupported and oversized records without removing them", () => {
    const storage = new MemoryStorage();
    const { key, store } = seed(storage);
    const saved = JSON.parse(storage.values.get(key)!);
    const invalid = [
      "not JSON",
      "null",
      "[]",
      JSON.stringify({ ...saved, version: 2 }),
      JSON.stringify({ ...saved, draft: {} }),
      JSON.stringify({
        ...saved,
        draft: { ...empty(), marks: [{ ...mark(), width: 0 }] },
      }),
      JSON.stringify({
        ...saved,
        draft: { ...empty(), pendingText: { x: -1, y: 0 } },
      }),
      " ".repeat(ANNOTATION_DRAFT_MAX_LENGTH + 1),
    ];
    for (const raw of invalid) {
      storage.values.set(key, raw);
      expect(error(store.load()).kind).toBe("invalid");
      expect(storage.values.get(key)).toBe(raw);
    }
  });

  test("explicit discard removes only the observed malformed record", () => {
    const storage = new MemoryStorage();
    const { key, store } = seed(storage);
    storage.values.set(key, "broken");
    storage.values.set("some-other-local-setting", "keep");
    expect(error(store.load()).kind).toBe("invalid");
    value(store.clear());
    expect(storage.values.has(key)).toBe(false);
    expect(storage.values.get("some-other-local-setting")).toBe("keep");
    value(store.save(empty()));
    expect(value(store.load())).toEqual(empty());
  });

  test("never restores a copied record from a different applied baseline or capture", () => {
    const storage = new MemoryStorage();
    const { key, store } = seed(storage);
    const saved = JSON.parse(storage.values.get(key)!);
    for (const variant of [
      { baseline: "[changed]" },
      { repo: "other" },
      { read: "other" },
      { route: "/other" },
      { source: "images/other.png" },
      { width: 1 },
      { height: 1 },
      { padding: 0 },
    ]) {
      const raw = JSON.stringify({
        ...saved,
        identity: { ...identity, ...variant },
      });
      storage.values.set(key, raw);
      expect(error(store.load()).kind).toBe("conflict");
      expect(error(store.save(empty())).kind).toBe("conflict");
      expect(error(store.clear()).kind).toBe("conflict");
      expect(storage.values.get(key)).toBe(raw);
    }
  });

  test("rejects invalid unfinished paths, marks, text and points before writing", () => {
    const storage = new MemoryStorage();
    const store = createAnnotationDraftStore(identity, storage);
    const path = {
      tool: "path",
      color: "#123456",
      width: 2,
      closed: false,
      nodes: [{ x: 2, y: 3, kind: "corner" }],
    };
    const variants: unknown[] = [
      { ...empty(), path: { ...path, nodes: [] } },
      { ...empty(), path: { ...path, closed: true } },
      { ...empty(), path: { ...path, nodes: [{ x: 2, y: 3, kind: "bad" }] } },
      {
        ...empty(),
        path: {
          ...path,
          nodes: [{ x: 2, y: 3, kind: "smooth", out: { x: 999, y: 1 } }],
        },
      },
      { ...empty(), marks: [{ ...mark(), points: [{ x: Number.NaN, y: 1 }] }] },
      { ...empty(), pendingText: { x: Infinity, y: 1 } },
      { ...empty(), text: "x".repeat(4001) },
      { marks: [] },
    ];
    for (const variant of variants) {
      expect(error(store.save(variant as AnnotationDraft)).kind).toBe(
        "invalid",
      );
      expect(storage.values.size).toBe(0);
    }
  });

  test("shares mark and point budgets across completed and unfinished geometry", () => {
    const storage = new MemoryStorage();
    const store = createAnnotationDraftStore(identity, storage);
    const path: AnnotationDraft["path"] = {
      tool: "path",
      color: "#123456",
      width: 2,
      closed: false,
      nodes: [{ x: 1, y: 1, kind: "corner" }],
    };
    expect(
      error(
        store.save({
          ...empty(),
          marks: Array.from({ length: 500 }, mark),
          path,
        }),
      ).kind,
    ).toBe("invalid");
    const pen: AnnotationMark = {
      tool: "pen",
      color: "#123456",
      width: 2,
      points: Array.from({ length: 50000 }, () => ({ x: 1, y: 1 })),
    };
    expect(error(store.save({ ...empty(), marks: [pen], path })).kind).toBe(
      "invalid",
    );
    expect(storage.values.size).toBe(0);
  });

  test("rejects invalid identities and oversized serialization without storage writes", () => {
    const storage = new MemoryStorage();
    for (const variant of [
      { width: 0 },
      { height: 1.5 },
      { padding: -1 },
      { width: 16384, padding: 1 },
      { width: 5000, height: 5000 },
      { source: "s".repeat(16385) },
    ]) {
      const store = createAnnotationDraftStore(
        { ...identity, ...variant },
        storage,
      );
      expect(error(store.load()).kind).toBe("invalid");
      expect(error(store.save(empty())).kind).toBe("invalid");
      expect(error(store.clear()).kind).toBe("invalid");
    }
    const oversized = createAnnotationDraftStore(
      {
        ...identity,
        baseline: "x".repeat(ANNOTATION_DRAFT_MAX_LENGTH),
      },
      storage,
    );
    expect(error(oversized.save(empty())).kind).toBe("invalid");
    expect(storage.values.size).toBe(0);
  });

  test("surfaces read, quota and discard failures, and preserves retry state", () => {
    const storage = new MemoryStorage();
    const store = createAnnotationDraftStore(identity, storage);
    storage.failure = "get";
    for (const result of [store.load(), store.save(empty()), store.clear()]) {
      expect(error(result).kind).toBe("storage");
      expect(error(result).cause).toBe(storage.error);
    }
    storage.failure = "set";
    expect(error(store.save(drawing())).kind).toBe("storage");
    expect(error(store.save(drawing())).cause).toBe(storage.error);
    expect(storage.values.size).toBe(0);
    storage.failure = null;
    value(store.save(drawing()));
    storage.failure = "set";
    expect(error(store.save(empty())).kind).toBe("storage");
    storage.failure = "remove";
    expect(error(store.clear()).kind).toBe("storage");
    expect(error(store.clear()).cause).toBe(storage.error);
    storage.failure = null;
    expect(value(store.load())).toEqual(drawing());
    value(store.clear());
    expect(storage.values.size).toBe(0);
  });

  test("older tabs cannot overwrite or discard a changed record", () => {
    const storage = new MemoryStorage();
    const first = createAnnotationDraftStore(identity, storage);
    const second = createAnnotationDraftStore(identity, storage);
    expect(value(first.load())).toBeNull();
    expect(value(second.load())).toBeNull();
    value(first.save(drawing()));
    expect(error(second.save(empty())).kind).toBe("conflict");
    expect(error(second.clear()).kind).toBe("conflict");
    expect(value(second.load())).toEqual(drawing());
    value(second.save(empty()));
    expect(error(first.save(drawing())).kind).toBe("conflict");
    expect(error(first.clear()).kind).toBe("conflict");
    expect(value(first.load())).toEqual(empty());
    value(second.clear());
    expect(error(first.save(drawing())).kind).toBe("conflict");
  });

  test("an unread existing record is never overwritten or discarded", () => {
    const storage = new MemoryStorage();
    seed(storage);
    const unread = createAnnotationDraftStore(identity, storage);
    expect(error(unread.save(empty())).kind).toBe("conflict");
    expect(error(unread.clear()).kind).toBe("conflict");
    expect(value(unread.load())).toEqual(drawing());
    value(unread.clear());
    expect(storage.values.size).toBe(0);
  });
});
