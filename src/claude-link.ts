import { mkdir, lstat, chmod, unlink } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { createClaudeChannel, runClaudeChannel } from "./claude-channel.ts";
import type { ClaudeChannel } from "./claude-channel.ts";
import type { AgentChannel, ChannelDelivery } from "./agent-channel.ts";
import { createHub } from "./events.ts";
import type { Hub } from "./events.ts";
import type { ReviewSession } from "./session.ts";
import { VERSION } from "./version.ts";

/** Private local IPC, independent of the web port, diff range, and output directory. */
export async function claudeEndpoint(repoRoot: string): Promise<string> {
  const key = createHash("sha256").update(repoRoot).digest("hex").slice(0, 24);
  if (process.platform === "win32") return `\\\\.\\pipe\\lcr-claude-${key}`;
  // macOS's long TMPDIR can exceed the Unix socket path limit.
  const dir = path.join(process.platform === "darwin" ? "/tmp" : tmpdir(), `lcr-${process.getuid!()}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) {
    throw new Error(`Claude link directory must be private and owned by you: ${dir}`);
  }
  return path.join(dir, `claude-${key}.sock`);
}

async function activeSocket(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    const finish = (active: boolean) => { socket.destroy(); resolve(active); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(true)); // an uncertain listener is never removed
  });
}

/** The explicitly started lcr owns the page, range and review file; Claude only connects to it. */
export async function startClaudeLink(
  session: ReviewSession, hub: Hub, url: () => string, endpoint: string,
): Promise<AgentChannel & { close: () => void }> {
  let peer: Socket | null = null;
  let channel: ClaudeChannel | null = null;
  const candidates = new Map<Socket, ClaudeChannel>();
  let checkingSince = 0;
  let closed = false;
  const server = createServer((socket) => {
    let booting = true;
    const owned = () => {
      if (peer !== socket) throw new Error("This Claude session has not confirmed the review channel.");
    };
    const attached = createClaudeChannel({
      readNote: (...args) => { owned(); return session.readNote(...args); },
      answer: (...args) => { owned(); return session.answer(...args); },
    }, hub, (packet) => {
      if (!booting) socket.write(JSON.stringify(packet) + "\n");
    }, url, () => {
      if (peer && peer !== socket) return false;
      peer = socket; channel = attached;
      hub.emit({ type: "review", file: session.file });
      return true;
    });
    candidates.set(socket, attached);
    if (!checkingSince) checkingSince = Date.now();
    socket.on("error", () => {});
    socket.once("close", () => {
      candidates.delete(socket);
      if (peer === socket) {
        peer = null; channel = null;
        checkingSince = Date.now();
        if (!closed) for (const candidate of candidates.values()) candidate.probe();
      }
      if (!candidates.size) checkingSince = 0;
      hub.emit({ type: "review", file: session.file });
    });
    void (async () => {
      await attached.receive(JSON.stringify({ jsonrpc: "2.0", id: "lcr-link-init", method: "initialize", params: { protocolVersion: "2025-03-26" } }));
      await attached.receive(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
      booting = false;
      attached.probe();
      hub.emit({ type: "review", file: session.file });
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      for await (const line of lines) if (line.trim()) await attached.receive(line);
    })().catch(() => socket.destroy());
  });
  const listen = () => new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { server.off("listening", ready); reject(error); };
    const ready = () => { server.off("error", failed); resolve(); };
    server.once("error", failed); server.once("listening", ready);
    server.listen(endpoint);
  });
  try {
    await listen();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    if (await activeSocket(endpoint)) {
      console.error("  Claude link already belongs to another lcr in this repository; this page stays independent.\n");
      return { agent: "claude", available: () => false, publish: () => ({ state: "unchanged", count: 0 }), close: () => {} };
    }
    const stat = await lstat(endpoint).catch(() => null);
    if (!stat?.isSocket() || stat.uid !== process.getuid?.()) throw error;
    await unlink(endpoint);
    await listen();
  }
  if (process.platform !== "win32") await chmod(endpoint, 0o600);
  return {
    agent: "claude",
    available: () => !!channel,
    status: () => ({
      agent: "claude",
      state: channel ? "ready" : candidates.size && Date.now() - checkingSince < 15_000 ? "checking" : "unavailable",
      detail: channel ? "Claude confirmed that channel messages reach this session."
        : candidates.size ? "No channel delivery confirmation yet. Claude may be busy, missing channel opt-in, or blocked by organization policy."
        : "No Claude bridge is connected to this repository.",
    }),
    publish(review, notes): ChannelDelivery {
      return channel?.publish(review, notes) ?? { state: "failed", count: 0, error: "Claude disconnected. Reconnect it and send a follow-up." };
    },
    close() { if (closed) return; closed = true; for (const socket of candidates.keys()) socket.destroy(); server.close(); },
  };
}

/** A globally registered MCP bridge starts no page or Git watcher and can wait for a later lcr. */
export function createClaudeBridge(endpoint: string, write: (packet: Record<string, unknown>) => void) {
  let socket: Socket | null = null;
  let connecting: Socket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false, ready = false;
  const requests = new Set<string | number>();
  const waiting: Record<string, unknown>[] = [];
  const offline = async (): Promise<never> => { throw new Error("No lcr review is connected. Start lcr with your chosen diff, for example: lcr origin/main."); };
  const local = createClaudeChannel({ readNote: offline, answer: offline }, createHub(), write,
    () => "the review you start explicitly with lcr <git diff arguments> in this repository");

  function connect() {
    if (stopped) return;
    const next = createConnection(endpoint);
    connecting = next;
    next.on("error", () => {});
    next.once("connect", () => {
      if (stopped) { next.destroy(); return; }
      socket = next; connecting = null;
    });
    next.once("close", () => {
      if (connecting === next) connecting = null;
      if (socket === next) {
        socket = null;
        for (const id of requests) write({ jsonrpc: "2.0", id, result: {
          isError: true, content: [{ type: "text", text: "lcr disconnected. Check the review before retrying; an answer may already have been saved." }],
        } });
        requests.clear();
      }
      if (!stopped) timer = setTimeout(connect, 500);
    });
    void (async () => {
      const lines = createInterface({ input: next, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        const packet = JSON.parse(line);
        if (typeof packet.id === "string" || typeof packet.id === "number") requests.delete(packet.id);
        if (packet.method === "notifications/claude/channel" && !ready) waiting.push(packet);
        else write(packet);
      }
    })().catch(() => next.destroy());
  }
  connect();
  return {
    async receive(line: string) {
      let packet;
      try { packet = JSON.parse(line); } catch { await local.receive(line); return; }
      if (ready && socket && packet?.jsonrpc === "2.0" && packet.method === "tools/call" &&
          (typeof packet.id === "string" || typeof packet.id === "number")) {
        requests.add(packet.id); socket.write(line + "\n"); return;
      }
      await local.receive(line);
      if (local.ready && !ready) {
        ready = true;
        for (const event of waiting.splice(0)) write(event);
      }
    },
    close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      connecting?.destroy();
      socket?.destroy();
    },
  };
}

export async function runClaudeBridge(repoRoot: string) {
  const bridge = createClaudeBridge(await claudeEndpoint(repoRoot), (packet) => { process.stdout.write(JSON.stringify(packet) + "\n"); });
  console.error(`  lcr ${VERSION}: Claude bridge waiting for a review. Start lcr with your chosen diff.\n`);
  try { await runClaudeChannel(bridge); }
  finally { bridge.close(); }
}
