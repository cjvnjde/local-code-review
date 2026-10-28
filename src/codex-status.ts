import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { VERSION } from "./version.ts";
import { runGit } from "./git.ts";

export interface CodexProbeResult { ok: boolean; error?: string; thread?: string }

/** Read session metadata through the existing local daemon; never start a turn or inspect credentials. */
export async function probeCodex(thread: string, cwd: string, spawn: typeof Bun.spawn = Bun.spawn): Promise<CodexProbeResult> {
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cli = spawn(["codex", "queue", "--help"], { cwd, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const cliTimer = setTimeout(() => cli.kill(), 3000);
    try { if (await cli.exited !== 0) throw new Error("The installed Codex CLI does not support codex queue."); }
    finally { clearTimeout(cliTimer); }
    const proxy = spawn(["codex", "app-server", "proxy"], { cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    child = proxy;
    timer = setTimeout(() => proxy.kill(), 5000);
    let nextId = 0;
    let ended = false;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    const lines = createInterface({ input: Readable.fromWeb(proxy.stdout as any), crlfDelay: Infinity });
    const reader = (async () => {
      try {
        for await (const line of lines) {
          const packet = JSON.parse(line);
          const entry = pending.get(packet.id);
          if (!entry) continue;
          pending.delete(packet.id);
          if (packet.error) entry.reject(new Error(packet.error.message || "Codex could not read that session."));
          else entry.resolve(packet.result);
        }
      } finally {
        ended = true;
        for (const entry of pending.values()) entry.reject(new Error("The local Codex server is unavailable."));
        pending.clear();
      }
    })();
    void reader.catch(() => proxy.kill());
    const request = (method: string, params: object): Promise<any> => new Promise((resolve, reject) => {
      if (ended) { reject(new Error("The local Codex server is unavailable.")); return; }
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      try {
        proxy.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        Promise.resolve(proxy.stdin.flush()).catch(reject);
      } catch (error) { pending.delete(id); reject(error); }
    });
    await request("initialize", { clientInfo: { name: "lcr_status", title: "lcr status", version: VERSION }, capabilities: {} });
    proxy.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    let found = await request("thread/read", { threadId: thread, includeTurns: false }).catch(() => null);
    if (!found?.thread) {
      const matches: any[] = [];
      let cursor: string | null = null;
      do {
        const page = await request("thread/list", { cwd, searchTerm: thread, limit: 100, cursor });
        matches.push(...page.data.filter((entry: any) => entry.name === thread));
        cursor = page.nextCursor;
      } while (cursor && matches.length < 2);
      if (matches.length !== 1) throw new Error("Codex session not found or its name is ambiguous. Select its UUID.");
      found = { thread: matches[0] };
    }
    const expected = await realpath(cwd).catch(() => path.resolve(cwd));
    const actual = typeof found.thread.cwd === "string"
      ? await realpath(found.thread.cwd).catch(() => path.resolve(found.thread.cwd)) : "";
    const actualRoot = actual && actual !== expected
      ? await runGit(["rev-parse", "--show-toplevel"], actual).then((value) => value.trim()).catch(() => actual)
      : actual;
    if (actualRoot !== expected) throw new Error("That Codex session belongs to a different repository.");
    return { ok: true, thread: found.thread.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Codex is unavailable." };
  } finally {
    if (timer) clearTimeout(timer);
    child?.kill();
  }
}
