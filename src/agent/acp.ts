import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { VERSION } from "../version.ts";

export interface AcpConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}
export async function readAcpConfig(file: string): Promise<AcpConfig> {
  const config = JSON.parse(await readFile(file, "utf8"));
  if (
    !config ||
    typeof config.name !== "string" ||
    !config.name.trim() ||
    typeof config.command !== "string" ||
    !config.command.trim() ||
    (config.args !== undefined &&
      (!Array.isArray(config.args) ||
        config.args.some((arg: unknown) => typeof arg !== "string"))) ||
    (config.env !== undefined &&
      (!config.env ||
        typeof config.env !== "object" ||
        Array.isArray(config.env) ||
        Object.values(config.env).some((value) => typeof value !== "string")))
  )
    throw new Error(
      "ACP config requires name, command, optional string args[] and string env{}; no shell command is evaluated.",
    );
  return {
    name: config.name,
    command: config.command,
    args: config.args ?? [],
    ...(config.env ? { env: config.env } : {}),
  };
}
export const acpTarget = (config: AcpConfig) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.name,
        config.command,
        config.args,
        Object.entries(config.env ?? {}).sort(),
      ]),
    )
    .digest("hex");
export interface Permission {
  id: string;
  sessionId: string;
  toolCall: any;
  options: { optionId: string; name: string; kind: string }[];
}
export interface AcpHooks {
  update(session: string, update: any): void;
  permission(permission: Permission): void;
  lost(error: Error): void;
}

/** Stable ACP v1, newline-delimited JSON-RPC over an externally installed agent's stdio. */
export class AcpClient {
  private child?: ReturnType<typeof Bun.spawn>;
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private permissions = new Map<
    string,
    Permission & { rpcId: string | number }
  >();
  private dead = false;
  capabilities: any = {};
  constructor(
    private config: AcpConfig,
    private cwd: string,
    private hooks: AcpHooks,
  ) {}
  async start() {
    this.child = Bun.spawn([this.config.command, ...this.config.args], {
      cwd: this.cwd,
      env: { ...process.env, ...this.config.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.read(this.child.stdout as ReadableStream<Uint8Array>);
    // Drain stderr without retaining credentials or unbounded agent diagnostics.
    void (async () => {
      for await (const _ of this.child!.stderr as ReadableStream<Uint8Array>) {
      }
    })().catch(() => {});
    void this.child.exited.then((code) =>
      this.fail(
        new Error(
          `ACP agent exited (${code}). Inspect the agent and authentication before retrying.`,
        ),
      ),
    );
    const result = await this.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "lcr", version: VERSION },
      },
      15_000,
    );
    if (result.protocolVersion !== 1) {
      await this.close();
      throw new Error(
        `Unsupported ACP version ${result.protocolVersion}; lcr supports stable v1.`,
      );
    }
    this.capabilities = result.agentCapabilities ?? {};
  }
  private send(message: any) {
    if (this.dead || !this.child) throw new Error("ACP connection is closed.");
    (this.child.stdin as any).write(
      JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n",
    );
    (this.child.stdin as any).flush();
  }
  request(method: string, params: any, timeout = 0): Promise<any> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(
            () => this.fail(new Error(`ACP ${method} timed out.`)),
            timeout,
          )
        : undefined;
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  private async read(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const bytes of stream) {
        buffer += decoder.decode(bytes, { stream: true });
        if (buffer.length > 16 * 1024 * 1024)
          throw new Error("ACP message exceeded 16 MiB.");
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line.trim()) this.receive(JSON.parse(line));
        }
      }
      this.fail(
        new Error("ACP transport closed; execution may be incomplete."),
      );
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private receive(message: any) {
    if (message.jsonrpc !== "2.0")
      throw new Error("Invalid ACP JSON-RPC message.");
    if (!message.method) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error)
        waiter.reject(
          new Error(`ACP ${message.error.code}: ${message.error.message}`),
        );
      else waiter.resolve(message.result);
    } else if (
      message.method === "session/update" &&
      message.id === undefined
    ) {
      this.hooks.update(message.params.sessionId, message.params.update);
    } else if (
      message.method === "session/request_permission" &&
      message.id !== undefined
    ) {
      const id = String(++this.next);
      const permission = { ...message.params, id, rpcId: message.id };
      if (
        !Array.isArray(permission.options) ||
        permission.options.some(
          (option: any) =>
            typeof option.optionId !== "string" ||
            typeof option.name !== "string",
        )
      )
        throw new Error("Invalid ACP permission options.");
      this.permissions.set(id, permission);
      this.hooks.permission(permission);
    } else if (message.id !== undefined) {
      this.send({
        id: message.id,
        error: {
          code: -32601,
          message: "Client method not supported or advertised.",
        },
      });
    }
  }
  decide(id: string, optionId?: string) {
    const permission = this.permissions.get(id);
    if (
      !permission ||
      (optionId !== undefined &&
        !permission.options.some((option) => option.optionId === optionId))
    )
      throw new Error(
        "That permission request or option is no longer available.",
      );
    this.send({
      id: permission.rpcId,
      result: {
        outcome:
          optionId === undefined
            ? { outcome: "cancelled" }
            : { outcome: "selected", optionId },
      },
    });
    this.permissions.delete(id);
  }
  cancel(sessionId: string) {
    for (const permission of this.permissions.values())
      if (permission.sessionId === sessionId) this.decide(permission.id);
    this.send({ method: "session/cancel", params: { sessionId } });
  }
  async session(previous?: string): Promise<string> {
    if (previous && !this.capabilities.loadSession)
      throw new Error(
        "This agent cannot restore the saved session. Acknowledge a new session explicitly in the queue controls.",
      );
    const result = await this.request(
      previous ? "session/load" : "session/new",
      {
        cwd: this.cwd,
        mcpServers: [],
        ...(previous ? { sessionId: previous } : {}),
      },
      30_000,
    );
    const id = previous || result.sessionId;
    if (typeof id !== "string" || !id)
      throw new Error("ACP agent returned no session id.");
    return id;
  }
  private fail(error: Error, notify = true) {
    if (this.dead) return;
    this.dead = true;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    this.permissions.clear();
    this.child?.kill();
    if (notify) this.hooks.lost(error);
  }
  async close() {
    this.fail(new Error("ACP connection stopped."), false);
    if (this.child) {
      const child = this.child;
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      try {
        await child.exited;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
