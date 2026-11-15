import { constants } from "node:fs";
import {
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { runGit } from "../git/commands.ts";
import type {
  CaptureRoundInput,
  ReviewRound,
  RoundComparison,
  RoundFileChange,
  RoundNoteReference,
} from "../shared/review-rounds.ts";

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_ROUNDS = 32;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const text = z.string().max(4096);
const referenceSchema = z.object({
  review: text,
  noteId: text,
  file: text,
  label: text.optional(),
});
const inputSchema = z
  .object({
    source: z.enum(["agent", "manual"]),
    review: text,
    taskId: text.optional(),
    notes: z.array(referenceSchema).max(MAX_FILES),
  })
  .refine(
    (input) => input.source === "manual" || input.review.length > 0,
    "Agent handoff requires an exact review filename.",
  );
const entrySchema = z.object({
  path: text,
  state: z.enum(["present", "missing", "unavailable"]),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  content: z.string().max(MAX_FILE_BYTES).optional(),
  binary: z.boolean().optional(),
  mode: z.number().int().optional(),
  detail: text.optional(),
});
const snapshotSchema = z.object({
  entries: z.array(entrySchema).max(MAX_FILES),
  issues: z.array(text).max(MAX_FILES + 1),
  complete: z.boolean(),
});
const recordSchema = z.object({
  version: z.literal(1),
  round: inputSchema.safeExtend({
    id: z.string().uuid(),
    created: z.string(),
    baseline: z.enum(["ready", "partial", "failed"]),
    issues: z.array(text).max(MAX_FILES + 1),
  }),
  snapshot: snapshotSchema,
});
const verificationSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.string(),
  stale: z.boolean(),
});
type Entry = z.infer<typeof entrySchema>;
type Snapshot = z.infer<typeof snapshotSchema>;

/** Expected client errors only; unexpected filesystem/corrupt-storage errors remain server errors. */
export class ReviewRoundError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ReviewRoundError";
  }
}

export interface ReviewRoundStoreOptions {
  repoRoot: string;
  outDir: string;
  /** Complete tracked + untracked inventory, including tracked deletions. Defaults to Git. */
  listFiles?(): Promise<string[]>;
  /** Fresh conversation references for this review; bodies and replies are never persisted here. */
  readNotes?(review: string): Promise<RoundNoteReference[]>;
  now?(): string;
}

export interface ReviewRoundStore {
  capture(input: CaptureRoundInput): Promise<ReviewRound>;
  /** Archived pages contain at most 32 rounds; offset is a nonnegative page offset. */
  list(options?: {
    archived?: boolean;
    offset?: number;
  }): Promise<ReviewRound[]>;
  archive(id: string): Promise<void>;
  compare(id: string): Promise<RoundComparison>;
  verify(id: string, fingerprint: string): Promise<RoundComparison>;
}

/** Immutable, bounded baselines live separately from reviewer verification and Markdown. */
export function createReviewRoundStore(
  options: ReviewRoundStoreOptions,
): ReviewRoundStore {
  const root = path.resolve(options.repoRoot);
  const output = path.resolve(root, options.outDir);
  const directory = path.join(output, "rounds");
  const now = options.now ?? (() => new Date().toISOString());
  const listFiles =
    options.listFiles ??
    (async () =>
      (
        await runGit(
          ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
          root,
        )
      )
        .split("\0")
        .filter(Boolean));
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  };
  const filename = (id: string, verification = false) => {
    if (!z.string().uuid().safeParse(id).success)
      throw new ReviewRoundError(400, "Invalid review round ID.");
    return path.join(
      directory,
      `${id}${verification ? ".verification" : ""}.json`,
    );
  };
  async function readJson(file: string) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES)
        throw new Error("Review round storage is invalid or oversized.");
      return JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  }
  async function atomic(file: string, data: unknown, immutable = false) {
    await mkdir(directory, { recursive: true });
    const bytes = JSON.stringify(data);
    if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES)
      throw new Error("Review round storage limit exceeded.");
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (immutable)
        await link(temporary, file); // Never replace an existing baseline.
      else await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function ids(archived = false) {
    try {
      const files = await readdir(directory);
      const markers = new Set(
        files.filter((name) => name.endsWith(".archive.json")),
      );
      return files
        .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
        .map((name) => name.slice(0, -5))
        .filter((id) => markers.has(`${id}.archive.json`) === archived)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async function load(id: string) {
    const file = filename(id);
    let value: unknown;
    try {
      value = await readJson(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ReviewRoundError(404, "Review round baseline was not found.");
      throw error;
    }
    const record = recordSchema.parse(value);
    if (record.round.id !== id) throw new Error("Review round ID mismatch.");
    for (const entry of record.snapshot.entries) {
      if (
        entry.state === "present" &&
        (!entry.hash ||
          (!entry.binary &&
            (entry.content === undefined ||
              digest(entry.content) !== entry.hash)))
      )
        throw new Error("Review round baseline content is missing or corrupt.");
    }
    return record;
  }
  async function verification(id: string) {
    try {
      return verificationSchema.parse(await readJson(filename(id, true)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  const included = (name: string) => {
    const absolute = path.resolve(root, name);
    return (
      name.length <= 4096 &&
      name !== "" &&
      !path.isAbsolute(name) &&
      absolute.startsWith(root + path.sep) &&
      absolute !== output &&
      !absolute.startsWith(output + path.sep) &&
      !name.split(/[\\/]/).includes(".git")
    );
  };
  async function snapshot(previous: Entry[] = []): Promise<Snapshot> {
    const issues: string[] = [];
    let listed: string[];
    try {
      listed = await listFiles();
    } catch {
      return {
        entries: [],
        complete: false,
        issues: [
          "Repository file inventory is unavailable; no complete baseline or comparison can be claimed.",
        ],
      };
    }
    const names = [
      ...new Set([...listed, ...previous.map((entry) => entry.path)]),
    ]
      .filter(included)
      .sort();
    if (names.length > MAX_FILES)
      issues.push(
        `File inventory exceeds the ${MAX_FILES}-file limit; evidence is incomplete.`,
      );
    const entries: Entry[] = [];
    let remaining = MAX_CONTENT_BYTES;
    const realRoot = await realpath(root);
    for (const name of names.slice(0, MAX_FILES)) {
      let handle;
      try {
        const absolute = path.resolve(root, name);
        const parent = await realpath(path.dirname(absolute));
        if (parent !== realRoot && !parent.startsWith(realRoot + path.sep))
          throw new Error("Path leaves repository through a symlink.");
        handle = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const stat = await handle.stat();
        if (!stat.isFile())
          throw new Error(
            "Not a regular file (symlinks and submodules are not captured).",
          );
        if (stat.size > MAX_FILE_BYTES)
          throw new Error(
            `File exceeds the ${MAX_FILE_BYTES}-byte evidence limit.`,
          );
        if (stat.size > remaining)
          throw new Error("Round content budget exhausted.");
        const bytes = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < bytes.length) {
          const result = await handle.read(
            bytes,
            count,
            bytes.length - count,
            count,
          );
          if (!result.bytesRead) break;
          count += result.bytesRead;
        }
        const after = await handle.stat();
        if (
          count !== stat.size ||
          after.mtimeMs !== stat.mtimeMs ||
          after.ctimeMs !== stat.ctimeMs
        )
          throw new Error(
            "File changed while capturing; evidence is unavailable.",
          );
        const content = bytes.subarray(0, count);
        remaining -= count;
        let decoded: string | undefined;
        if (!content.includes(0)) {
          try {
            decoded = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(content);
          } catch {
            /* Non-UTF-8 evidence remains binary. */
          }
        }
        entries.push({
          path: name,
          state: "present",
          hash: digest(content),
          binary: decoded === undefined,
          content: decoded,
          mode: stat.mode & 0o111,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          entries.push({ path: name, state: "missing" });
        else {
          const detail =
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "File evidence is unavailable.";
          entries.push({ path: name, state: "unavailable", detail });
          issues.push(`${name}: ${detail}`.slice(0, 4096));
        }
      } finally {
        await handle?.close();
      }
    }
    return { entries, issues, complete: !issues.length };
  }
  const identity = (snapshot: Snapshot) =>
    digest(
      JSON.stringify(
        snapshot.entries
          .filter((entry) => entry.state !== "missing")
          .map(({ path, state, hash, mode }) => [path, state, hash, mode]),
      ),
    );
  const same = (a: Entry | undefined, b: Entry | undefined) => {
    return (
      ((!a || a.state === "missing") && (!b || b.state === "missing")) ||
      (a?.state === "present" &&
        b?.state === "present" &&
        a.hash === b.hash &&
        a.mode === b.mode)
    );
  };
  function changes(before: Snapshot, current: Snapshot): RoundFileChange[] {
    const old = new Map(before.entries.map((entry) => [entry.path, entry]));
    const next = new Map(current.entries.map((entry) => [entry.path, entry]));
    const result: RoundFileChange[] = [];
    for (const name of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      const a = old.get(name),
        b = next.get(name);
      if (same(a, b)) continue;
      const missingEvidence =
        a?.state === "unavailable" ||
        b?.state === "unavailable" ||
        (!before.complete && !a) ||
        (!current.complete && !b);
      const presentA = a?.state === "present",
        presentB = b?.state === "present";
      const binary = !!(a?.binary || b?.binary);
      const change: RoundFileChange = {
        path: name,
        kind: missingEvidence
          ? "unavailable"
          : !presentA
            ? "added"
            : !presentB
              ? "deleted"
              : "modified",
        binary,
        beforeHash: a?.hash,
        currentHash: b?.hash,
      };
      if (missingEvidence)
        change.detail =
          a?.detail ||
          b?.detail ||
          "File inventory is incomplete; before/after evidence is unknown.";
      else if (binary)
        change.detail =
          "Binary content compared by SHA-256; no text diff is available.";
      else {
        change.patch = createTwoFilesPatch(
          presentA ? name : "/dev/null",
          presentB ? name : "/dev/null",
          a?.content ?? "",
          b?.content ?? "",
          "handoff",
          "current",
          { context: 3, maxEditLength: 2000, timeout: 100 },
        );
        if (change.patch === undefined)
          change.detail =
            "Contents differ; text diff exceeded its computation limit.";
        else if (change.patch.length > MAX_FILE_BYTES) {
          change.patch = undefined;
          change.detail =
            "Contents differ; text diff exceeds the display limit.";
        }
        if (presentA && presentB && a.mode !== b.mode)
          change.detail = "Executable permission changed.";
      }
      result.push(change);
    }
    // Exact-content renames only; edited moves remain honest added/deleted pairs.
    const removed = new Map<string, RoundFileChange[]>();
    for (const change of result)
      if (change.kind === "deleted" && change.beforeHash) {
        const matches = removed.get(change.beforeHash) ?? [];
        matches.push(change);
        removed.set(change.beforeHash, matches);
      }
    const consumed = new Set<RoundFileChange>();
    for (const change of result)
      if (change.kind === "added" && change.currentHash) {
        const prior = removed.get(change.currentHash)?.shift();
        if (prior) {
          change.kind = "renamed";
          change.from = prior.path;
          change.beforeHash = prior.beforeHash;
          change.patch = undefined;
          change.detail = "Exact-content rename; path changed.";
          consumed.add(prior);
        }
      }
    return result.filter((change) => !consumed.has(change));
  }
  async function compare(id: string): Promise<RoundComparison> {
    const record = await load(id);
    const current = await snapshot(record.snapshot.entries);
    const complete =
      record.round.baseline === "ready" &&
      record.snapshot.complete &&
      current.complete;
    const fingerprint = identity(current);
    const files = changes(record.snapshot, current);
    const references =
      options.readNotes && record.round.review
        ? await options.readNotes(record.round.review)
        : [];
    const notes = new Map(
      [...record.round.notes, ...references].map((note) => [
        JSON.stringify([note.review, note.noteId]),
        note,
      ]),
    );
    const paths = new Set(
      files.flatMap((file) => [file.path, ...(file.from ? [file.from] : [])]),
    );
    const affectedNotes = [...notes.values()].filter(
      (note) => paths.has(note.file) || (!note.file && files.length > 0),
    );
    const saved = await verification(id);
    if (
      saved &&
      !saved.stale &&
      (!complete || saved.fingerprint !== fingerprint)
    ) {
      saved.stale = true;
      await atomic(filename(id, true), saved);
    }
    return {
      round: record.round,
      fingerprint,
      complete,
      issues: [...record.round.issues, ...current.issues],
      files,
      affectedNotes,
      verification: {
        state: saved ? (saved.stale ? "stale" : "verified") : "unverified",
        at: saved?.at,
      },
    };
  }
  return {
    capture: (input) =>
      serial(async () => {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success)
          throw new ReviewRoundError(
            400,
            parsed.error.issues[0]?.message ??
              "Invalid review round capture input.",
          );
        const valid = parsed.data;
        if ((await ids()).length >= MAX_ROUNDS)
          throw new ReviewRoundError(
            409,
            `Active review round limit (${MAX_ROUNDS}) reached. Archive a round in the review rounds panel before capturing more.`,
          );
        let captured: Snapshot;
        try {
          captured = await snapshot();
        } catch {
          captured = {
            entries: [],
            complete: false,
            issues: [
              "Baseline capture failed; before evidence is unavailable.",
            ],
          };
        }
        let references: RoundNoteReference[] = [];
        try {
          references =
            options.readNotes && valid.review
              ? await options.readNotes(valid.review)
              : [];
        } catch {
          captured.complete = false;
          captured.issues.push(
            "Conversation references could not be read at handoff.",
          );
        }
        const notes = z
          .array(referenceSchema)
          .max(MAX_FILES)
          .parse([
            ...new Map(
              [...valid.notes, ...references].map((note) => [
                JSON.stringify([note.review, note.noteId]),
                note,
              ]),
            ).values(),
          ]);
        const round: ReviewRound = {
          ...valid,
          notes,
          id: randomUUID(),
          created: now(),
          baseline: captured.complete
            ? "ready"
            : captured.entries.length
              ? "partial"
              : "failed",
          issues: captured.issues,
        };
        await atomic(
          filename(round.id),
          { version: 1, round, snapshot: captured },
          true,
        );
        return round;
      }),
    list: (options = {}) =>
      serial(async () => {
        const offset = options.offset ?? 0;
        if (!Number.isSafeInteger(offset) || offset < 0)
          throw new ReviewRoundError(400, "Invalid review round offset.");
        const rounds: ReviewRound[] = [];
        for (const id of (await ids(options.archived)).slice(
          offset,
          offset + MAX_ROUNDS,
        ))
          rounds.push((await load(id)).round);
        return rounds.sort(
          (a, b) =>
            b.created.localeCompare(a.created) || b.id.localeCompare(a.id),
        );
      }),
    archive: (id) =>
      serial(async () => {
        await load(id);
        // A separate marker preserves the immutable baseline and all verification evidence.
        await atomic(path.join(directory, `${id}.archive.json`), {
          version: 1,
          archived: now(),
        });
      }),
    compare: (id) => serial(() => compare(id)),
    verify: (id, fingerprint) =>
      serial(async () => {
        if (!/^[a-f0-9]{64}$/.test(fingerprint))
          throw new ReviewRoundError(400, "Invalid review round fingerprint.");
        const current = await compare(id);
        if (!current.complete)
          throw new ReviewRoundError(
            409,
            "Cannot verify a round with missing or incomplete evidence.",
          );
        if (current.fingerprint !== fingerprint)
          throw new ReviewRoundError(
            409,
            "Files changed since you viewed this round. Refresh and review them before verifying.",
          );
        await atomic(filename(id, true), {
          fingerprint,
          at: now(),
          stale: false,
        });
        // Re-read after persistence too: a concurrent code edit must not receive a fresh success label.
        return compare(id);
      }),
  };
}
