/** Small request/event transport. No browser automation runtime is shipped with lcr. */
export class Cdp {
  private seq = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Map<
    string,
    Set<(params: any, session?: string) => void>
  >();
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let msg: any;
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
      } else
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
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<any> {
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
  on(method: string, fn: (params: any, session?: string) => void): () => void {
    const list = this.listeners.get(method) || new Set();
    list.add(fn);
    this.listeners.set(method, list);
    return () => list.delete(fn);
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
