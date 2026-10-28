import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClaudeChannel } from "./claude-channel.ts";
import { createHub } from "./events.ts";
import { createSession } from "./session.ts";
import type { ReviewComment } from "./types.ts";

const comment: ReviewComment = {
  id: "a.ts|n1|n1|#question", file: "a.ts", start: 1, end: 1, label: "1",
  body: "Why is this needed?", code: "+const needed = true;", side: "new",
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-channel-"));
  const session = createSession(root, ".review", "HEAD");
  const packets: any[] = [];
  const events: string[] = [];
  const hub = createHub();
  hub.add((event) => events.push(event));
  const channel = createClaudeChannel(session, hub, (packet) => packets.push(packet), () => "http://localhost:7777");
  const send = (packet: unknown) => channel.receive(JSON.stringify({ jsonrpc: "2.0", ...packet as object }));
  const initialize = async () => {
    await send({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    await send({ method: "notifications/initialized" });
  };
  const call = async (name: string, args: unknown) => {
    await send({ id: 9, method: "tools/call", params: { name, arguments: args } });
    return packets.at(-1).result;
  };
  return { root, session, channel, packets, events, send, initialize, call };
}

describe("Claude Code channel", () => {
  test("negotiates MCP and announces queued feedback only after initialization", async () => {
    const f = await fixture();
    const saved = await f.session.save({ comments: [comment] });
    expect(f.channel.publish(path.basename(saved.file), saved.changed)).toEqual({ state: "queued", count: 1 });
    expect(f.packets).toHaveLength(0);
    await f.initialize();
    expect(f.packets[0].result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {}, experimental: { "claude/channel": {} } },
      serverInfo: { name: "lcr" },
    });
    expect(f.packets[0].result.instructions).toContain("http://localhost:7777");
    expect(f.packets[1]).toMatchObject({ method: "notifications/claude/channel", params: {
      meta: { review: path.basename(saved.file), note_id: comment.id },
    } });
    await f.send({ method: "notifications/initialized" });
    expect(f.packets).toHaveLength(2);
    await f.send({ id: 2, method: "tools/list" });
    expect(f.packets.at(-1).result.tools.map((tool: any) => tool.name)).toEqual(["channel_ready", "read_note", "reply"]);
  });

  test("rejects malformed calls, requires initialization, and negotiates a known protocol", async () => {
    const f = await fixture();
    await f.channel.receive("bad JSON");
    expect(f.packets.at(-1).error.code).toBe(-32700);
    await f.channel.receive("null");
    expect(f.packets.at(-1).error.code).toBe(-32600);
    await f.send({ id: 2, method: "tools/list" });
    expect(f.packets.at(-1).error.code).toBe(-32000);
    await f.send({ id: 3, method: "initialize", params: { protocolVersion: "2026-07-28" } });
    expect(f.packets.at(-1).result.protocolVersion).toBe("2025-11-25");
    await f.send({ method: "notifications/initialized" });
    const count = f.packets.length;
    await f.send({ method: "notifications/unknown" });
    expect(f.packets).toHaveLength(count);
    await f.send({ id: 4, method: "missing" });
    expect(f.packets.at(-1).error.code).toBe(-32601);
    expect((await f.call("reply", {})).isError).toBe(true);
  });

  test("reads current follow-ups and answers the original review after the page switches", async () => {
    const f = await fixture();
    await f.initialize();
    const first = await f.session.save({ comments: [comment] });
    const review = path.basename(first.file);
    await f.session.reply(comment.id!, "Please explain without changing the code.");
    f.session.startFresh();
    await f.session.save({ comments: [{ ...comment, body: "A different conversation." }] });
    const active = f.session.file;
    const read = await f.call("read_note", { review, note_id: comment.id });
    expect(JSON.parse(read.content[0].text).messages[0].body).toContain("without changing");
    const answer = await f.call("reply", { review, note_id: comment.id, body: "It controls the fallback.", status: "answered" });
    expect(answer.isError).toBeUndefined();
    expect(f.session.file).toBe(active);
    const original = await f.session.readNote(review, comment.id!);
    expect(original!.status).toBe("answered");
    expect(original!.messages.map((entry) => entry.role)).toEqual(["reviewer", "agent"]);
    expect(original!.messages[1]!.body).toBe("It controls the fallback.");
    expect((await f.session.read()).notes[0]!.messages).toEqual([]);
    expect(f.events).toEqual([`data: ${JSON.stringify({ type: "review", file: review })}\n\n`]);
    const text = await readFile(path.join(f.root, first.file), "utf8");
    expect(text).toContain("Status: answered");
    expect(text).toContain("**Agent** <!-- lcr:m ");
  });

  test("never recreates a deleted note or accepts paths outside generated reviews", async () => {
    const f = await fixture();
    await f.initialize();
    const saved = await f.session.save({ comments: [comment] });
    const args = { review: path.basename(saved.file), note_id: comment.id, body: "Answer" };
    expect((await f.call("read_note", { ...args, review: "../README.md" })).isError).toBe(true);
    expect((await f.call("reply", { ...args, status: "invented" })).isError).toBe(true);
    expect((await f.call("reply", { ...args, body: " " })).isError).toBe(true);
    await f.session.remove(comment.id!);
    expect((await f.call("reply", args)).isError).toBe(true);
    expect((await f.session.read()).notes).toEqual([]);
  });

  test("only new or changed reviewer notes are announced on save", async () => {
    const f = await fixture();
    const first = await f.session.save({ comments: [comment] });
    expect(first.changed.map((note) => note.id)).toEqual([comment.id!]);
    expect((await f.session.save({ comments: [comment] })).changed).toEqual([]);
    await f.session.answer(path.basename(first.file), comment.id!, "Because.", "answered");
    expect((await f.session.save({ comments: [comment] })).changed).toEqual([]);
    const changed = await f.session.save({ comments: [{ ...comment, body: "What about null?" }] });
    expect(changed.changed.map((note) => note.body)).toEqual(["What about null?"]);
    expect(changed.changed[0]!.messages[0]!.body).toBe("Because.");
  });
});
