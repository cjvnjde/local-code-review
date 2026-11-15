import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { repositoryEvidence } from "./repository-evidence.ts";

async function git(root: string, args: string[], input?: string) {
  const process = Bun.spawn(["git", ...args], {
    cwd: root,
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.test",
    },
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exit !== 0) throw new Error(stderr);
  return stdout.trim();
}

test("repository evidence fingerprints dirty tracked contents without storing them or executing configured hooks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-repository-evidence-"));
  try {
    await git(root, ["init", "--quiet"]);
    const blob = await git(root, ["hash-object", "-w", "--stdin"], "initial\n");
    await git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},tracked.txt`,
    ]);
    const tree = await git(root, ["write-tree"]);
    const head = await git(root, ["commit-tree", tree, "-m", "fixture"]);
    await git(root, ["update-ref", "HEAD", head]);
    await writeFile(path.join(root, "tracked.txt"), "initial\n");
    const hook = path.join(root, "hook");
    await writeFile(hook, "#!/bin/sh\nprintf invoked > hook-ran\nexit 1\n");
    await chmod(hook, 0o755);
    await writeFile(
      path.join(root, ".gitattributes"),
      "tracked.txt filter=unsafe diff=unsafe\n",
    );
    await git(root, ["config", "filter.unsafe.clean", hook]);
    await git(root, ["config", "filter.unsafe.process", hook]);
    await git(root, ["config", "diff.unsafe.textconv", hook]);
    await git(root, ["config", "diff.external", hook]);
    await git(root, ["config", "core.fsmonitor", hook]);
    const before = JSON.parse(String((await repositoryEvidence(root)).data));
    expect(before.head).toBe(head);
    expect(before.dirty.status).toBe("available");
    await writeFile(
      path.join(root, "tracked.txt"),
      "SECRET changed working contents\n",
    );
    const changedPart = await repositoryEvidence(root);
    const changed = JSON.parse(String(changedPart.data));
    expect(changed.dirty.status).toBe("available");
    expect(changed.dirty.sha256).not.toBe(before.dirty.sha256);
    expect(String(changedPart.data)).not.toContain("SECRET");
    expect(String(changedPart.data)).not.toContain("tracked.txt");
    await writeFile(
      path.join(root, "untracked.txt"),
      "SECRET untracked contents\n",
    );
    const untracked = JSON.parse(String((await repositoryEvidence(root)).data));
    expect(untracked.dirty.sha256).toBe(changed.dirty.sha256);
    expect(
      await readFile(path.join(root, "hook-ran"), "utf8").catch(
        () => undefined,
      ),
    ).toBeUndefined();
    await writeFile(
      path.join(root, "tracked.txt"),
      Buffer.alloc(8 * 1024 * 1024 + 1),
    );
    const oversized = JSON.parse(String((await repositoryEvidence(root)).data));
    expect(oversized.head).toBe(head);
    expect(oversized.dirty.status).toBe("unavailable");
    expect(oversized.dirty.sha256).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-repositories explicitly report unavailable identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-no-repository-"));
  try {
    expect((await repositoryEvidence(root)).status).toBe("unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
