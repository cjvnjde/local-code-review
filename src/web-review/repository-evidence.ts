import type { ContextPartInput } from "../review/context.ts";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { boundedRequest } from "./evidence.ts";

/** No shell, pager, external diff, textconv or filesystem-monitor hooks. Output never persists. */
async function gitEvidence(root: string, args: string[], maxBytes: number) {
  const process = Bun.spawn(
    [
      "git",
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      ...args,
    ],
    {
      cwd: root,
      env: {
        ...Bun.env,
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const timer = setTimeout(() => process.kill(), 1200);
  const reader = process.stdout.getReader();
  let size = 0;
  let output = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new Error("Repository evidence exceeds its byte limit.");
      output += decoder.decode(value, { stream: true });
    }
    if ((await process.exited) !== 0)
      throw new Error("Repository evidence command unavailable.");
    return { value: output + decoder.decode(), bytes: size };
  } finally {
    clearTimeout(timer);
    process.kill();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function dirtyFingerprint(root: string, head: string) {
  // Index-only commands cannot run configured working-tree clean/process filters.
  const index = await gitEvidence(
    root,
    ["ls-files", "--stage", "--full-name", "-z", "--"],
    512 * 1024,
  );
  const files = new Set<string>();
  let excluded = 0;
  for (const entry of index.value.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) [a-f0-9]{40,64} [0-3]\t([\s\S]+)$/.exec(entry);
    if (!match) throw 0;
    if (!["100644", "100755"].includes(match[1]!)) {
      excluded++;
      continue;
    }
    files.add(match[2]!);
  }
  if (files.size > 1000) throw 0;
  const canonicalRoot = await realpath(root);
  const hash = new Bun.CryptoHasher("sha256").update(head).update(index.value);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const deadline = Date.now() + 1200;
  let bytes = 0;
  for (const file of [...files].sort()) {
    if (Date.now() >= deadline || file.length > 4096) throw 0;
    const segments = file.split("/");
    if (segments.some((part) => !part || part === "." || part === ".."))
      throw 0;
    let location = canonicalRoot;
    let missing = false;
    let skip = false;
    for (const [index, segment] of segments.entries()) {
      location = path.join(location, segment);
      try {
        const info = await lstat(location);
        if (
          info.isSymbolicLink() ||
          (index < segments.length - 1 ? !info.isDirectory() : !info.isFile())
        ) {
          skip = true;
          break;
        }
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          missing = true;
          break;
        }
        throw error;
      }
    }
    if (skip) {
      excluded++;
      continue;
    }
    hash.update(JSON.stringify(file)).update(missing ? ":deleted;" : ":file;");
    if (missing) continue;
    const handle = await open(
      location,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size + bytes > 8 * 1024 * 1024) throw 0;
      hash.update(JSON.stringify([info.size, info.mode & 0o777]));
      const content = new Bun.CryptoHasher("sha256");
      while (true) {
        if (Date.now() >= deadline) throw 0;
        const result = await handle.read(buffer);
        if (!result.bytesRead) break;
        bytes += result.bytesRead;
        if (bytes > 8 * 1024 * 1024) throw 0;
        content.update(buffer.subarray(0, result.bytesRead));
      }
      hash.update(content.digest("hex"));
    } finally {
      await handle.close();
    }
  }
  return {
    status: "available",
    sha256: hash.digest("hex"),
    trackedPaths: files.size,
    excludedPaths: excluded,
    cleanliness:
      "Not assessed; this fingerprints the tracked index and working contents, including dirty changes.",
  };
}

export async function repositoryEvidence(
  root: string,
): Promise<ContextPartInput> {
  const part = {
    name: "repository",
    label: "Capture-time checkout identity",
    type: "application/json",
  };
  const at = new Date().toISOString();
  try {
    const head = (
      await gitEvidence(root, ["rev-parse", "--verify", "HEAD"], 128)
    ).value.trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) throw 0;
    let dirty: { status: string; sha256?: string; detail?: string };
    try {
      dirty = await boundedRequest(dirtyFingerprint(root, head), 3600);
    } catch {
      dirty = {
        status: "unavailable",
        detail:
          "Tracked changes exceeded bounded command/file collection (8 MiB, 1000 paths, 3600 ms), or Git/filesystem evidence was unavailable.",
      };
    }
    return {
      ...part,
      data: JSON.stringify({
        version: 1,
        at,
        head,
        dirty,
        identity:
          "Local checkout only; this does not identify the running application build.",
        fingerprint:
          "SHA-256 of captured HEAD, tracked index identities and bounded regular working-file contents (including dirty contents). This is not a cleanliness test. No source content, filenames or diffs are stored.",
        exclusions: [
          "Untracked and ignored files are excluded.",
          "Submodule contents, symbolic links and non-regular files are excluded from working-file hashing; their index identities remain included.",
          "Collection is non-atomic: the checkout can change while evidence is gathered.",
          "Unavailable or oversized tracked content has no fingerprint.",
          "Working-tree clean/process filters, external diff, textconv and fsmonitor hooks are not executed.",
        ],
        limits: {
          workingBytes: 8 * 1024 * 1024,
          paths: 1000,
          commandBytes: 512 * 1024,
          commandMs: 1200,
          dirtyMs: 3600,
        },
      }),
      detail:
        "Capture-time local checkout HEAD and bounded tracked dirty-content fingerprint; not running-app identity.",
    };
  } catch {
    return {
      ...part,
      status: "unavailable",
      detail:
        "A bounded Git HEAD identity was unavailable (including non-repositories and unborn checkouts).",
    };
  }
}
