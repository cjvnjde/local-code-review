import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  client,
  ndJsonStream,
  RequestError,
  type AgentCapabilities,
  type AgentRequestMethod,
  type AgentRequestParamsByMethod,
  type AgentRequestResponsesByMethod,
  type AnyMessage,
  type ClientConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { z } from "zod";
import { VERSION } from "../version.ts";

export interface AcpConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}
const configSchema = z.object({
  name: z.string().refine((value) => !!value.trim()),
  command: z.string().refine((value) => !!value.trim()),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});
export async function readAcpConfig(file: string): Promise<AcpConfig> {
  const parsed = configSchema.safeParse(
    JSON.parse(await readFile(file, "utf8")),
  );
  if (!parsed.success)
    throw new Error(
      "ACP config requires name, command, optional string args[] and string env{}; no shell command is evaluated.",
    );
  return parsed.data;
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
export interface Permission extends RequestPermissionRequest {
  id: string;
}
export interface AcpHooks {
  update(session: string, update: SessionUpdate): void;
  permission(permission: Permission): void;
  lost(error: Error): void;
}

/** Diagnostic capture is opt-in and memory-only; the normal client discards stderr. */
export interface AcpOptions {
  diagnostics?: boolean;
}
export const ACP_DIAGNOSTIC_BYTES = 8 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/** Stable ACP v1. The official SDK owns framing, correlation and protocol dispatch. */
export class AcpClient {
  private child?: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private connection?: ClientConnection;
  private next = 0;
  private permissions = new Map<
    string,
    {
      permission: Permission;
      written: Promise<void>;
      resolve: (value: RequestPermissionResponse) => void;
    }
  >();
  private dead = false;
  private stderrTail = new Uint8Array(0);
  private stderrReader?: ReadableStreamDefaultReader<Uint8Array>;
  private stderrDone = Promise.resolve();
  private outbound = Promise.resolve();
  private decisionWrites = new Map<string | number | null, () => void>();
  capabilities: AgentCapabilities = {};
  constructor(
    private config: AcpConfig,
    private cwd: string,
    private hooks: AcpHooks,
    private options: AcpOptions = {},
  ) {}

  get diagnostics(): string {
    return new TextDecoder().decode(this.stderrTail);
  }

  async start() {
    if (this.dead || this.child)
      throw new Error("ACP connection is closed or already started.");
    this.child = Bun.spawn([this.config.command, ...this.config.args], {
      cwd: this.cwd,
      env: { ...process.env, ...this.config.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const child = this.child;
    this.stderrDone = this.drainStderr(child.stderr);
    void child.exited.then((code) =>
      this.fail(
        new Error(
          `ACP agent exited (${code}). Inspect the agent and authentication before retrying.`,
        ),
      ),
    );
    const output = new WritableStream<Uint8Array>({
      write: async (bytes) => {
        // ndJsonStream answers malformed JSON itself. Preserve lcr's fail-closed
        // policy instead of leaving uncertain pending work alive after that error.
        const message: AnyMessage = JSON.parse(new TextDecoder().decode(bytes));
        if (
          "error" in message &&
          message.id === null &&
          (message.error.code === -32700 || message.error.code === -32600)
        ) {
          const error = new Error("Invalid ACP JSON-RPC message.");
          this.fail(error);
          throw error;
        }
        try {
          child.stdin.write(bytes);
          await child.stdin.flush();
        } catch (error) {
          this.fail(asError(error));
          throw error;
        }
        if ("id" in message && !("method" in message)) {
          this.decisionWrites.get(message.id)?.();
          this.decisionWrites.delete(message.id);
        }
      },
    });
    const stream = ndJsonStream(output, child.stdout, {
      maxMessageBytes: MAX_MESSAGE_BYTES,
    });
    const guarded = stream.readable.pipeThrough(
      new TransformStream<AnyMessage, AnyMessage>({
        transform: (message, controller) => {
          if (message.jsonrpc !== "2.0")
            throw new Error("Invalid ACP JSON-RPC message.");
          if (
            "method" in message &&
            message.method === "session/request_permission"
          ) {
            const parsed = permissionBoundary.safeParse(message.params);
            if (!parsed.success)
              throw new Error("Invalid ACP permission options.");
          }
          controller.enqueue(message);
        },
      }),
    );
    const app = client({ name: "lcr" })
      .onNotification("session/update", ({ params }) => {
        this.hooks.update(params.sessionId, params.update);
      })
      .onRequest(
        "session/request_permission",
        ({ params, signal, requestId }) => {
          if (this.dead || signal.aborted)
            return { outcome: { outcome: "cancelled" } };
          const { promise, resolve } =
            Promise.withResolvers<RequestPermissionResponse>();
          const id = String(++this.next);
          const permission = { ...params, id };
          const written = Promise.withResolvers<void>();
          this.decisionWrites.set(requestId, written.resolve);
          const finish = (value: RequestPermissionResponse) => {
            signal.removeEventListener("abort", aborted);
            this.permissions.delete(id);
            resolve(value);
          };
          const aborted = () => finish({ outcome: { outcome: "cancelled" } });
          this.permissions.set(id, {
            permission,
            written: written.promise,
            resolve: finish,
          });
          signal.addEventListener("abort", aborted, { once: true });
          try {
            this.hooks.permission(permission);
          } catch (error) {
            this.fail(asError(error));
          }
          return promise;
        },
      )
      .onRequest("*", ({ method }) => {
        throw RequestError.methodNotFound(method);
      });
    this.connection = app.connect({
      readable: guarded,
      writable: stream.writable,
    });
    const connection = this.connection;
    void connection.closed.then(() =>
      this.fail(
        asError(
          connection.signal.reason ??
            "ACP transport closed; execution may be incomplete.",
        ),
      ),
    );
    try {
      const result = await this.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "lcr", version: VERSION },
        },
        15_000,
      );
      if (result.protocolVersion !== 1)
        throw new Error(
          `Unsupported ACP version ${result.protocolVersion}; lcr supports stable v1.`,
        );
      this.capabilities = result.agentCapabilities ?? {};
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async drainStderr(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    this.stderrReader = reader;
    try {
      while (true) {
        const { value: bytes, done } = await reader.read();
        if (done) break;
        if (!this.options.diagnostics) continue;
        const retained = Math.min(
          ACP_DIAGNOSTIC_BYTES,
          this.stderrTail.length + bytes.length,
        );
        const tail = new Uint8Array(retained);
        const fromNew = Math.min(bytes.length, retained);
        tail.set(
          this.stderrTail.subarray(
            this.stderrTail.length - (retained - fromNew),
          ),
        );
        tail.set(bytes.subarray(bytes.length - fromNew), retained - fromNew);
        this.stderrTail = tail;
      }
    } catch {
      // Process shutdown can cancel its pipe; diagnostics never keep it alive.
    } finally {
      this.stderrReader = undefined;
      reader.releaseLock();
    }
  }

  request<M extends AgentRequestMethod>(
    method: M,
    params: AgentRequestParamsByMethod[M],
    timeout?: number,
  ): Promise<AgentRequestResponsesByMethod[M]>;
  request<T = unknown>(
    method: string,
    params: unknown,
    timeout?: number,
  ): Promise<T>;
  async request<T = unknown>(
    method: string,
    params: unknown,
    timeout = 0,
  ): Promise<T> {
    if (this.dead || !this.connection)
      throw new Error("ACP connection is closed.");
    const timer = timeout
      ? setTimeout(
          () => this.fail(new Error(`ACP ${method} timed out.`)),
          timeout,
        )
      : undefined;
    try {
      await this.outbound;
      if (this.dead) throw new Error("ACP connection is closed.");
      return await this.connection.agent.request<T>(method, params);
    } catch (error) {
      if (error instanceof RequestError)
        throw new Error(`ACP ${error.code}: ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  decide(id: string, optionId?: string) {
    const entry = this.permissions.get(id);
    if (
      !entry ||
      (optionId !== undefined &&
        !entry.permission.options.some(
          (option) => option.optionId === optionId,
        ))
    )
      throw new Error(
        "That permission request or option is no longer available.",
      );
    this.permissions.delete(id);
    this.outbound = this.outbound.then(async () => {
      if (this.dead) return;
      entry.resolve({
        outcome:
          optionId === undefined
            ? { outcome: "cancelled" }
            : { outcome: "selected", optionId },
      });
      await entry.written;
    });
  }
  cancel(sessionId: string) {
    if (this.dead || !this.connection)
      throw new Error("ACP connection is closed.");
    for (const { permission } of this.permissions.values())
      if (permission.sessionId === sessionId) this.decide(permission.id);
    // SDK writes are asynchronous. A failed cancellation terminates the
    // connection and never replays an uncertain prompt.
    this.outbound = this.outbound
      .then(async () => {
        if (!this.dead)
          await this.connection!.agent.notify("session/cancel", { sessionId });
      })
      .catch((error) => this.fail(asError(error)));
  }
  async session(previous?: string): Promise<string> {
    if (previous && !this.capabilities.loadSession)
      throw new Error(
        "This agent cannot restore the saved session. Acknowledge a new session explicitly in the queue controls.",
      );
    if (previous) {
      await this.request(
        "session/load",
        { cwd: this.cwd, mcpServers: [], sessionId: previous },
        30_000,
      );
      return previous;
    }
    const result = await this.request(
      "session/new",
      { cwd: this.cwd, mcpServers: [] },
      30_000,
    );
    if (typeof result.sessionId !== "string" || !result.sessionId)
      throw new Error("ACP agent returned no session id.");
    return result.sessionId;
  }
  private fail(error: Error, notify = true) {
    if (this.dead) return;
    this.dead = true;
    for (const { resolve } of this.permissions.values())
      resolve({ outcome: { outcome: "cancelled" } });
    this.permissions.clear();
    for (const resolve of this.decisionWrites.values()) resolve();
    this.decisionWrites.clear();
    this.connection?.close(error);
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
        // Give buffered stderr time to drain, but never wait indefinitely on
        // a pipe inherited by an agent's descendants.
        const drained = Promise.withResolvers<void>();
        const drainTimer = setTimeout(drained.resolve, 100);
        try {
          await Promise.race([this.stderrDone, drained.promise]);
        } finally {
          clearTimeout(drainTimer);
          await this.stderrReader?.cancel().catch(() => {});
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

const permissionBoundary = z.object({
  sessionId: z.string(),
  toolCall: z.object({ toolCallId: z.string() }).passthrough(),
  options: z.array(
    z.object({
      optionId: z.string(),
      name: z.string(),
      kind: z.enum([
        "allow_once",
        "allow_always",
        "reject_once",
        "reject_always",
      ]),
    }),
  ),
});
