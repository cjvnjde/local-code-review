import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCodexChannel } from "./codex-channel.ts";
import { createSession } from "./session.ts";
import type { ReviewComment } from "./types.ts";

const comment: ReviewComment = {
  id: "a.ts|n1|n1|#question", file: "a.ts", start: 1, end: 1, label: "1",
  body: "Why this fallback? `$(do-not-run)`", code: "+const value = 2;",
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-codex-"));
  const session = createSession(root, "review files", "HEAD");
  const first = await session.save({ comments: [comment] });
  const options = { repoRoot: root, outDir: "review files", thread: "my session", session };
  return { root, session, first, options, review: path.basename(first.file) };
}

describe("Codex feedback adapter", () => {
  test("queues one explicit session and exact saved note through argument arrays", async () => {
    const f = await fixture();
    const calls: { command: string[]; cwd: string }[] = [];
    const channel = createCodexChannel(f.options, async (command, cwd) => { calls.push({ command, cwd }); return { ok: true }; });
    expect(channel.agent).toBe("codex");
    expect(await channel.publish(f.review, f.first.changed)).toEqual({ state: "forwarded", count: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command.slice(0, 5)).toEqual(["codex", "queue", "--thread", "my session", "--message"]);
    expect(calls[0]!.command).toHaveLength(6);
    expect(calls[0]!.cwd).toBe(f.root);
    const prompt = calls[0]!.command[5]!;
    expect(prompt).toContain(JSON.stringify(path.join(f.root, f.first.file)));
    expect(prompt).toContain(JSON.stringify(comment.id));
    expect(prompt).toContain("Status: answered");
    expect(prompt).toContain("Preserve all other text");
    expect(prompt).not.toContain("$(do-not-run)");
    expect(await channel.publish(f.review, [])).toEqual({ state: "unchanged", count: 0 });
    expect(calls).toHaveLength(1);
  });

  test("retries a failed send on an unchanged save, preserving feedback and conversation", async () => {
    const f = await fixture();
    let attempts = 0;
    const channel = createCodexChannel(f.options, async () => ++attempts === 1
      ? { ok: false, error: "Session unavailable" } : { ok: true });
    expect(await channel.publish(f.review, f.first.changed)).toEqual({ state: "failed", count: 0, error: "Session unavailable" });
    await f.session.reply(comment.id!, "Please explain only.");
    expect(await channel.publish(f.review, [])).toEqual({ state: "forwarded", count: 1 });
    expect((await f.session.read()).notes[0]!.messages[0]!.body).toBe("Please explain only.");
    expect(await channel.publish(f.review, [])).toEqual({ state: "unchanged", count: 0 });
    expect(attempts).toBe(2);
  });

  test("keeps the original review on retry after the page opens another one", async () => {
    const f = await fixture();
    const commands: string[][] = [];
    const channel = createCodexChannel(f.options, async (command) => {
      commands.push(command); return { ok: commands.length !== 1, error: "Offline" };
    });
    await channel.publish(f.review, f.first.changed);
    f.session.startFresh();
    const second = await f.session.save({ comments: [{ ...comment, id: "a.ts|n1|n1|#second" }] });
    expect(await channel.publish(path.basename(second.file), second.changed)).toEqual({ state: "forwarded", count: 2 });
    expect(commands[1]![5]).toContain(JSON.stringify(path.join(f.root, f.first.file)));
    expect(commands[2]![5]).toContain(JSON.stringify(path.join(f.root, second.file)));
  });

  test("drops withdrawn notes from pending sends and refuses paths outside saved reviews", async () => {
    const f = await fixture();
    let count = 0;
    const channel = createCodexChannel(f.options, async () => { count++; return { ok: false, error: "Offline" }; });
    await channel.publish(f.review, f.first.changed);
    await f.session.remove(comment.id!);
    expect(await channel.publish(f.review, [])).toEqual({ state: "unchanged", count: 0 });
    expect(await channel.publish("../README.md", f.first.changed)).toEqual({ state: "unchanged", count: 0 });
    expect(count).toBe(1);
    expect((await f.session.read()).notes).toEqual([]);
  });

  test("serializes reviewer notifications without dropping a follow-up during delivery", async () => {
    const f = await fixture();
    let finish: (value: { ok: boolean }) => void = () => {};
    let started: () => void = () => {};
    const start = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const channel = createCodexChannel(f.options, async () => {
      calls++;
      if (calls === 1) { started(); return new Promise((resolve) => { finish = resolve; }); }
      return { ok: true };
    });
    const first = channel.publish(f.review, f.first.changed);
    await start;
    const note = await f.session.reply(comment.id!, "And null values?");
    const second = channel.publish(f.review, [note!]);
    expect(calls).toBe(1);
    finish({ ok: true });
    expect(await first).toEqual({ state: "forwarded", count: 1 });
    expect(await second).toEqual({ state: "forwarded", count: 1 });
    expect(calls).toBe(2);
  });

  test("reports a runner failure while keeping the pending message retryable", async () => {
    const f = await fixture();
    let failed = true;
    const channel = createCodexChannel(f.options, async () => {
      if (failed) throw new Error("spawn failed");
      return { ok: true };
    });
    expect((await channel.publish(f.review, f.first.changed)).state).toBe("failed");
    failed = false;
    expect((await channel.publish(f.review, [])).state).toBe("forwarded");
  });
});
