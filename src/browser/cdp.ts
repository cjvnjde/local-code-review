import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

export type CdpCommand = keyof ProtocolMapping.Commands;
export type CdpParams<M extends CdpCommand> =
  ProtocolMapping.Commands[M]["paramsType"] extends []
    ? Record<string, never>
    : NonNullable<ProtocolMapping.Commands[M]["paramsType"][0]>;
export type CdpResult<M extends CdpCommand> =
  ProtocolMapping.Commands[M]["returnType"];
export type CdpEvent = keyof ProtocolMapping.Events;
export type CdpEventParams<M extends CdpEvent> = ProtocolMapping.Events[M][0];
type OptionalCdpCommand = {
  [M in CdpCommand]: {} extends CdpParams<M> ? M : never;
}[CdpCommand];

/** Small request/event transport. No browser automation runtime is shipped with lcr. */
export class Cdp {
  private seq = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Map<
    string,
    Set<(params: unknown, session?: string) => void>
  >();
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let msg: {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: unknown;
        sessionId?: string;
      };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result);
      } else if (msg.method)
        for (const fn of this.listeners.get(msg.method) || [])
          fn(msg.params, msg.sessionId);
    });
    socket.addEventListener("close", () =>
      this.fail(
        new Error("The review browser disconnected. Reopen it from lcr."),
      ),
    );
    socket.addEventListener("error", () =>
      this.fail(new Error("The review browser connection failed.")),
    );
  }
  static async connect(
    url: string,
    options: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<Cdp> {
    options.signal?.throwIfAborted();
    const socket = new WebSocket(url);
    const cdp = new Cdp(socket);
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", failed);
        socket.removeEventListener("close", failed);
        options.signal?.removeEventListener("abort", aborted);
        if (error) {
          socket.close();
          reject(error);
        } else resolve();
      };
      const opened = () => finish();
      const failed = () =>
        finish(new Error("Could not connect to the review browser."));
      const aborted = () => finish(new Error("Browser connection cancelled."));
      const timer = setTimeout(
        () => finish(new Error("Browser connection timed out.")),
        options.timeout ?? 10000,
      );
      socket.addEventListener("open", opened);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
      options.signal?.addEventListener("abort", aborted, { once: true });
    });
    return cdp;
  }
  onDisconnect(listener: () => void): () => void {
    this.socket.addEventListener("close", listener, { once: true });
    return () => this.socket.removeEventListener("close", listener);
  }
  get connected() {
    return this.socket.readyState === WebSocket.OPEN;
  }
  send<M extends CdpCommand>(
    method: M,
    params: CdpParams<M>,
    sessionId?: string,
  ): Promise<CdpResult<M>>;
  send<M extends OptionalCdpCommand>(method: M): Promise<CdpResult<M>>;
  send(
    method: CdpCommand,
    params: object = {},
    sessionId?: string,
  ): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("The review browser is not connected."));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " timed out."));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  on<M extends CdpEvent>(
    method: M,
    fn: (params: CdpEventParams<M>, session?: string) => void,
  ): () => void {
    // The wire payload becomes typed only at this generated-protocol boundary.
    const listener = (params: unknown, session?: string) =>
      fn(params as CdpEventParams<M>, session);
    const list = this.listeners.get(method) || new Set();
    list.add(listener);
    this.listeners.set(method, list);
    return () => list.delete(listener);
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.fail(new Error("Browser connection closed."));
    this.socket.close();
  }
}
