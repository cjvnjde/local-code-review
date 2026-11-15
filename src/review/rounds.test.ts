import { afterEach, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReviewRoundStore, ReviewRoundError } from "./rounds.ts";
import type { CaptureRoundInput } from "../shared/review-rounds.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-rounds-"));
  roots.push(root);
  await mkdir(path.join(root, ".review"));
  const files = new Set<string>();
  const input: CaptureRoundInput = {
    source: "manual",
    review: "review.md",
    notes: [{ review: "review.md", noteId: "note-a", file: "a.ts" }],
  };
  const options = {
    repoRoot: root,
    outDir: ".review",
    listFiles: async () => [...files],
    now: () => "2026-01-02T03:04:05.000Z",
  };
  const store = createReviewRoundStore(options);
  const put = async (name: string, content: string | Uint8Array) => {
    files.add(name);
    await writeFile(path.join(root, name), content);
  };
  return { root, files, options, store, input, put };
}

test("round baseline and reviewer verification survive restart without altering Markdown", async () => {
  const f = await setup();
  await f.put("a.ts", "const answer = 1;\n");
  const markdown =
    "# Existing review\n\nReviewer prose and agent replies must stay byte-identical.\n";
  await writeFile(path.join(f.root, ".review/review.md"), markdown);
  const round = await f.store.capture({
    ...f.input,
    source: "agent",
    taskId: "task-1",
  });
  const baselinePath = path.join(f.root, ".review/rounds", `${round.id}.json`);
  const baseline = await readFile(baselinePath, "utf8");
  await f.put("a.ts", "const answer = 2;\n");
  const reopened = createReviewRoundStore(f.options);
  expect((await reopened.list())[0]).toEqual(round);
  const comparison = await reopened.compare(round.id);
  expect(comparison.complete).toBe(true);
  expect(comparison.round.taskId).toBe("task-1");
  expect(comparison.files[0]?.patch).toContain("-const answer = 1;");
  expect(comparison.files[0]?.patch).toContain("+const answer = 2;");
  expect(comparison.affectedNotes).toEqual(f.input.notes);
  expect(comparison.verification.state).toBe("unverified");
  expect(
    (await reopened.verify(round.id, comparison.fingerprint)).verification
      .state,
  ).toBe("verified");
  expect(
    (await createReviewRoundStore(f.options).compare(round.id)).verification
      .state,
  ).toBe("verified");
  expect(await readFile(baselinePath, "utf8")).toBe(baseline);
  expect(await readFile(path.join(f.root, ".review/review.md"), "utf8")).toBe(
    markdown,
  );
});

test("changed contents reject stale reviewer requests and invalidate previous verification permanently", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  const round = await f.store.capture(f.input);
  await f.put("a.ts", "reviewed\n");
  const shown = await f.store.compare(round.id);
  await f.store.verify(round.id, shown.fingerprint);
  await f.put("a.ts", "later edit\n");
  await expect(f.store.verify(round.id, shown.fingerprint)).rejects.toThrow(
    "Files changed",
  );
  expect((await f.store.compare(round.id)).verification.state).toBe("stale");
  await f.put("a.ts", "reviewed\n");
  const reverted = await createReviewRoundStore(f.options).compare(round.id);
  expect(reverted.verification.state).toBe("stale");
  expect(
    (await f.store.verify(round.id, reverted.fingerprint)).verification.state,
  ).toBe("verified");
});

test("new, deleted, exact renamed and binary content changes retain honest before/current evidence", async () => {
  const f = await setup();
  await f.put("a.ts", "deleted\n");
  await f.put("move.ts", "move me\n");
  await f.put("image.bin", new Uint8Array([0, 1, 2]));
  const round = await f.store.capture(f.input);
  await unlink(path.join(f.root, "a.ts"));
  f.files.delete("a.ts");
  await rename(path.join(f.root, "move.ts"), path.join(f.root, "moved.ts"));
  f.files.delete("move.ts");
  f.files.add("moved.ts");
  await f.put("new.ts", "new\n");
  await f.put("image.bin", new Uint8Array([0, 3, 4]));
  const current = await f.store.compare(round.id);
  expect(current.complete).toBe(true);
  expect(current.files.find((file) => file.path === "a.ts")?.kind).toBe(
    "deleted",
  );
  expect(current.files.find((file) => file.path === "new.ts")?.kind).toBe(
    "added",
  );
  expect(current.files.find((file) => file.path === "moved.ts")).toMatchObject({
    kind: "renamed",
    from: "move.ts",
  });
  const binary = current.files.find((file) => file.path === "image.bin")!;
  expect(binary.binary).toBe(true);
  expect(binary.beforeHash).not.toBe(binary.currentHash);
  expect(binary.patch).toBeUndefined();
});

test("actual UTF-8 contents, including BOM and newline differences, drive comparisons", async () => {
  const f = await setup();
  await f.put("a.ts", "\ufeffsame\r\n");
  const round = await f.store.capture(f.input);
  const before = await f.store.compare(round.id);
  expect(before.files).toEqual([]);
  await f.put("a.ts", "\ufeffsame\r\n");
  expect((await f.store.compare(round.id)).fingerprint).toBe(
    before.fingerprint,
  );
  await f.put("a.ts", "\ufeffsame\n");
  const changed = await f.store.compare(round.id);
  expect(changed.files).toHaveLength(1);
  expect(changed.fingerprint).not.toBe(before.fingerprint);
});

test("failed inventory persists a failed baseline and never becomes verifiable after recovery", async () => {
  const f = await setup();
  await f.put("a.ts", "present\n");
  const broken = createReviewRoundStore({
    ...f.options,
    listFiles: async () => {
      throw new Error("Git unavailable");
    },
  });
  const round = await broken.capture(f.input);
  expect(round.baseline).toBe("failed");
  expect((await createReviewRoundStore(f.options).list())[0]?.baseline).toBe(
    "failed",
  );
  const current = await f.store.compare(round.id);
  expect(current.complete).toBe(false);
  expect(current.files[0]?.kind).toBe("unavailable");
  await expect(f.store.verify(round.id, current.fingerprint)).rejects.toThrow(
    "incomplete evidence",
  );
});

test("oversized and symlink evidence is unavailable, not unchanged or a valid empty snapshot", async () => {
  const f = await setup();
  await f.put("large.bin", new Uint8Array(256 * 1024 + 1));
  await f.put("a.ts", "small\n");
  await symlink(path.join(f.root, "a.ts"), path.join(f.root, "link.ts"));
  f.files.add("link.ts");
  const round = await f.store.capture(f.input);
  expect(round.baseline).toBe("partial");
  const current = await f.store.compare(round.id);
  expect(current.complete).toBe(false);
  expect(
    current.files
      .filter((file) => file.kind === "unavailable")
      .map((file) => file.path),
  ).toEqual(["large.bin", "link.ts"]);
  await expect(f.store.verify(round.id, current.fingerprint)).rejects.toThrow(
    "incomplete evidence",
  );
});

test("current inventory failure makes existing verification stale and cannot hide deleted evidence", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  const round = await f.store.capture(f.input);
  const current = await f.store.compare(round.id);
  await f.store.verify(round.id, current.fingerprint);
  const unavailable = createReviewRoundStore({
    ...f.options,
    listFiles: async () => {
      throw new Error("offline");
    },
  });
  const missing = await unavailable.compare(round.id);
  expect(missing.complete).toBe(false);
  expect(missing.verification.state).toBe("stale");
  expect(missing.files[0]?.kind).toBe("unavailable");
});

test("fresh references include other affected conversations and output files are excluded", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  await f.put(".review/review.md", "existing\n");
  let references = [{ review: "review.md", noteId: "global", file: "" }];
  const store = createReviewRoundStore({
    ...f.options,
    readNotes: async () => references,
  });
  const round = await store.capture(f.input);
  references = [
    ...references,
    { review: "review.md", noteId: "later", file: "a.ts" },
  ];
  await f.put("a.ts", "after\n");
  await f.put(".review/review.md", "unrelated Markdown changed\n");
  const current = await store.compare(round.id);
  expect(current.files.map((file) => file.path)).toEqual(["a.ts"]);
  expect(current.affectedNotes.map((note) => note.noteId)).toEqual([
    "note-a",
    "global",
    "later",
  ]);
});

test("missing or corrupt baseline is an error, never a valid baseline", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  const round = await f.store.capture(f.input);
  const stored = path.join(f.root, ".review/rounds", `${round.id}.json`);
  const parsed = JSON.parse(await readFile(stored, "utf8"));
  parsed.snapshot.entries[0].content = "tampered";
  await writeFile(stored, JSON.stringify(parsed));
  await expect(f.store.compare(round.id)).rejects.toThrow("corrupt");
  await unlink(stored);
  await expect(f.store.compare(round.id)).rejects.toThrow();
});

test("explicit archival frees capacity while preserving inspectable baseline and verification", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  const first = await f.store.capture(f.input);
  const baselinePath = path.join(f.root, ".review/rounds", `${first.id}.json`);
  const baseline = await readFile(baselinePath, "utf8");
  const comparison = await f.store.compare(first.id);
  await f.store.verify(first.id, comparison.fingerprint);
  for (let n = 1; n < 32; n++) await f.store.capture(f.input);
  await expect(f.store.capture(f.input)).rejects.toThrow(
    "Active review round limit",
  );
  await f.store.archive(first.id);
  const reopened = createReviewRoundStore(f.options);
  expect(await reopened.list({ archived: true })).toEqual([first]);
  expect((await reopened.list()).some((round) => round.id === first.id)).toBe(
    false,
  );
  expect((await reopened.compare(first.id)).verification.state).toBe(
    "verified",
  );
  expect(await readFile(baselinePath, "utf8")).toBe(baseline);
  expect((await reopened.capture(f.input)).baseline).toBe("ready");
  expect(await reopened.list({ archived: true, offset: 32 })).toEqual([]);
  await expect(reopened.archive("../outside")).rejects.toThrow(
    "Invalid review round ID",
  );
  await expect(reopened.list({ archived: true, offset: -1 })).rejects.toThrow(
    "Invalid review round offset",
  );
});

test("manual baseline before the first note needs neither a fabricated review path nor Markdown", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  const store = createReviewRoundStore({
    ...f.options,
    readNotes: async () => {
      throw new Error("An unsaved review must not be read.");
    },
  });
  const round = await store.capture({
    source: "manual",
    review: "",
    notes: [],
  });
  expect(round.review).toBe("");
  expect(round.baseline).toBe("ready");
  expect((await store.compare(round.id)).complete).toBe(true);
  await expect(
    readFile(path.join(f.root, ".review/review.md")),
  ).rejects.toThrow();
  await expect(
    store.capture({ source: "agent", review: "", notes: [], taskId: "task" }),
  ).rejects.toThrow("exact review filename");
});

test("expected round errors expose HTTP status while corrupt storage remains a server failure", async () => {
  const f = await setup();
  await f.put("a.ts", "before\n");
  await expect(f.store.compare("../outside")).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    f.store.compare("00000000-0000-4000-8000-000000000000"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(f.store.list({ offset: -1 })).rejects.toMatchObject({
    status: 400,
  });
  const round = await f.store.capture(f.input);
  await expect(f.store.verify(round.id, "malformed")).rejects.toMatchObject({
    status: 400,
  });
  const shown = await f.store.compare(round.id);
  await f.put("a.ts", "changed\n");
  await expect(
    f.store.verify(round.id, shown.fingerprint),
  ).rejects.toMatchObject({ status: 409 });
  await writeFile(
    path.join(f.root, ".review/rounds", `${round.id}.json`),
    "{invalid JSON",
  );
  const failure = await f.store
    .compare(round.id)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(ReviewRoundError);
});
