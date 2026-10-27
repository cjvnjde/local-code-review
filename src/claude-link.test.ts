import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claudeEndpoint, createClaudeBridge, startClaudeLink } from "./claude-link.ts";
import { createHub } from "./events.ts";
import { createSession } from "./session.ts";
import type { ReviewComment } from "./types.ts";

const closing: (() => void)[] = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
const comment: ReviewComment = {
  id: "a.ts|n1|n1|#link", file: "a.ts", start: 1, end: 1, label: "1", body: "Why this fallback?", code: "+fallback();",
};
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 3500;
  while (Date.now() < end) { if (await check()) return; await Bun.sleep(10); }
  throw new Error("Timed out waiting for the local Claude link");
}
async function fixture() {
  const root = await mkdtemp(path.join(process.platform === "darwin" ? "/tmp" : tmpdir(), "lcr-link-"));
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\lcr-test-${path.basename(root)}` : path.join(root, "c.sock");
  const session = createSession(root, ".feedback", "origin/main");
  const hub = createHub();
  const packets: any[] = [];
  const bridge = createClaudeBridge(endpoint, (packet) => packets.push(packet));
  closing.push(() => bridge.close());
  const send = (packet: object) => bridge.receive(JSON.stringify({ jsonrpc: "2.0", ...packet }));
  await send({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  await send({ method: "notifications/initialized" });
  const start = async () => {
    const broker = await startClaudeLink(session, hub, () => "http://localhost:7778", endpoint);
    closing.push(() => broker.close());
    await until(() => !!broker.available?.());
    return broker;
  };
  return { root, endpoint, session, hub, packets, bridge, send, start };
}

describe("separate Claude bridge and review", () => {
  test("initializes and reports offline tools before any review is started", async () => {
    const f = await fixture();
    expect(f.packets[0].result.capabilities.experimental).toEqual({ "claude/channel": {} });
    await f.send({ id: 2, method: "tools/list" });
    expect(f.packets.at(-1).result.tools.map((tool: any) => tool.name)).toEqual(["read_note", "reply"]);
    await f.send({ id: 3, method: "tools/call", params: { name: "read_note", arguments: { review: "review-x.md", note_id: comment.id } } });
    expect(f.packets.at(-1).result.isError).toBe(true);
    expect(f.packets.at(-1).result.content[0].text).toContain("lcr origin/main");
    expect(await stat(path.join(f.root, ".feedback")).catch(() => null)).toBeNull();
  });

  test("connects to a later review, forwards notes and writes answers into its chosen output directory", async () => {
    const f = await fixture();
    const broker = await f.start();
    const saved = await f.session.save({ comments: [comment] });
    const review = path.basename(saved.file);
    expect(broker.publish(review, saved.changed)).toEqual({ state: "forwarded", count: 1 });
    await until(() => f.packets.some((packet) => packet.method === "notifications/claude/channel"));
    const notice = f.packets.find((packet) => packet.method === "notifications/claude/channel");
    expect(notice.params.meta).toEqual({ review, note_id: comment.id });
    await f.send({ id: 4, method: "tools/call", params: { name: "read_note", arguments: notice.params.meta } });
    await until(() => f.packets.some((packet) => packet.id === 4));
    expect(JSON.parse(f.packets.find((packet) => packet.id === 4).result.content[0].text).body).toBe(comment.body);
    await f.send({ id: 5, method: "tools/call", params: { name: "reply", arguments: { ...notice.params.meta, body: "It handles missing input.", status: "answered" } } });
    await until(() => f.packets.some((packet) => packet.id === 5));
    expect((await f.session.read()).notes[0]!.messages[0]!.body).toBe("It handles missing input.");
    expect((await f.session.read()).range).toBe("origin/main");
    f.bridge.close();
    await until(() => !broker.available?.());
  });

  test("reconnects after one explicitly started review ends and another starts", async () => {
    const f = await fixture();
    const first = await f.start();
    first.close();
    await until(() => !first.available?.());
    const second = await f.start();
    expect(second.available?.()).toBe(true);
    const saved = await f.session.save({ comments: [comment] });
    second.publish(path.basename(saved.file), saved.changed);
    await until(() => f.packets.some((packet) => packet.method === "notifications/claude/channel"));
  });

  test("does not take over another live review in the same repository", async () => {
    const f = await fixture();
    const first = await f.start();
    const original = console.error;
    console.error = () => {};
    let second;
    try { second = await startClaudeLink(f.session, f.hub, () => "http://localhost:7779", f.endpoint); }
    finally { console.error = original; }
    closing.push(() => second.close());
    expect(first.available?.()).toBe(true);
    expect(second.available?.()).toBe(false);
  });

  test("different repositories use different private endpoints", async () => {
    const f = await fixture();
    const first = await claudeEndpoint(f.root);
    const second = await claudeEndpoint(path.join(f.root, "other"));
    expect(first).not.toBe(second);
    if (process.platform !== "win32") {
      expect((await stat(path.dirname(first))).mode & 0o077).toBe(0);
      expect(first.length).toBeLessThan(104);
    }
  });
});
