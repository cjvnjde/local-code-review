import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { Cdp } from "./cdp.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}
async function transport() {
  const peers = new Set<ServerWebSocket<undefined>>();
  const requests: Request[] = [];
  const arrivals = new Map<
    number,
    { promise: Promise<Request>; resolve(value: Request): void }
  >();
  const connection = Promise.withResolvers<ServerWebSocket<undefined>>();
  const server = Bun.serve<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("WebSocket required", { status: 400 });
    },
    websocket: {
      open(socket) {
        peers.add(socket);
        connection.resolve(socket);
      },
      message(_socket, message) {
        const value: unknown = JSON.parse(String(message));
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          typeof value.id !== "number" ||
          !("method" in value) ||
          typeof value.method !== "string" ||
          !("params" in value) ||
          !value.params ||
          typeof value.params !== "object" ||
          Array.isArray(value.params)
        )
          throw new Error("Invalid outgoing CDP request");
        const request: Request = {
          id: value.id,
          method: value.method,
          params: Object.fromEntries(Object.entries(value.params)),
          ...("sessionId" in value && typeof value.sessionId === "string"
            ? { sessionId: value.sessionId }
            : {}),
        };
        requests.push(request);
        arrivals.get(requests.length)?.resolve(request);
        arrivals.delete(requests.length);
      },
      close(socket) {
        peers.delete(socket);
      },
    },
  });
  cleanups.push(() => {
    for (const socket of peers) socket.close();
    server.stop(true);
  });
  const cdp = await Cdp.connect(
    `ws://127.0.0.1:${server.port}/devtools/browser/test`,
  );
  cleanups.push(() => cdp.close());
  const socket = await connection.promise;
  return {
    cdp,
    socket,
    requests,
    send: (value: unknown) => socket.send(JSON.stringify(value)),
    received: (count: number): Promise<Request> => {
      const existing = requests[count - 1];
      if (existing) return Promise.resolve(existing);
      const arrival = Promise.withResolvers<Request>();
      arrivals.set(count, arrival);
      return arrival.promise;
    },
  };
}

test("CDP correlates concurrent out-of-order results and keeps session arguments separate", async () => {
  const f = await transport();
  const first = f.cdp.send(
    "Runtime.evaluate",
    { expression: "1 + 1" },
    "session-a",
  );
  const second = f.cdp.send("Target.getTargets");
  const a = await f.received(1);
  const b = await f.received(2);
  expect(a).toMatchObject({
    method: "Runtime.evaluate",
    params: { expression: "1 + 1" },
    sessionId: "session-a",
  });
  expect(b).toMatchObject({ method: "Target.getTargets", params: {} });
  expect(b).not.toHaveProperty("sessionId");
  expect(a.id).not.toBe(b.id);
  f.send({ id: b.id, result: { targetInfos: [{ targetId: "tab-b" }] } });
  expect(await second).toEqual({ targetInfos: [{ targetId: "tab-b" }] });
  f.send({ id: a.id, result: { result: { value: 2 } } });
  expect(await first).toEqual({ result: { value: 2 } });
  expect(f.cdp.connected).toBe(true);
});

test("a CDP protocol error rejects only its request and later traffic still succeeds", async () => {
  const f = await transport();
  const rejected = f.cdp.send("Page.navigate", { url: "invalid:" }).then(
    () => {
      throw new Error("Expected protocol rejection");
    },
    (error: Error) => error,
  );
  const successful = f.cdp.send("Browser.getVersion");
  const bad = await f.received(1);
  const good = await f.received(2);
  f.send({
    id: bad.id,
    error: { code: -32602, message: "Invalid navigation URL" },
  });
  f.send({ id: good.id, result: { product: "Fixture/1" } });
  expect((await rejected).message).toContain("Invalid navigation URL");
  expect(await successful).toEqual({ product: "Fixture/1" });
  expect(f.cdp.connected).toBe(true);
});

test("CDP ignores malformed JSON and unknown replies while routing events and unsubscribe by method", async () => {
  const f = await transport();
  const events: unknown[] = [];
  const other: unknown[] = [];
  const first = (params: unknown, session?: string) =>
    events.push([params, session]);
  const off = f.cdp.on("Runtime.consoleAPICalled", first);
  const offOther = f.cdp.on("Page.loadEventFired", (params) =>
    other.push(params),
  );
  f.socket.send("{not json");
  f.send({ id: 999_999, result: { ignored: true } });
  f.send({ method: "Unsubscribed.event", params: {} });
  f.send({
    method: "Runtime.consoleAPICalled",
    params: { type: "log" },
    sessionId: "session-a",
  });
  f.send({ method: "Page.loadEventFired", params: { timestamp: 12 } });
  // A response following the events is a transport-order barrier, not a sleep.
  const barrier = f.cdp.send("Browser.getVersion");
  const request = await f.received(1);
  f.send({ id: request.id, result: {} });
  await barrier;
  expect(events).toEqual([[{ type: "log" }, "session-a"]]);
  expect(other).toEqual([{ timestamp: 12 }]);
  off();
  off();
  f.send({
    method: "Runtime.consoleAPICalled",
    params: { type: "error" },
    sessionId: "session-b",
  });
  f.send({ method: "Page.loadEventFired", params: { timestamp: 13 } });
  const next = f.cdp.send("Browser.getVersion");
  const nextRequest = await f.received(2);
  f.send({ id: nextRequest.id, result: {} });
  await next;
  expect(events).toHaveLength(1);
  expect(other).toEqual([{ timestamp: 12 }, { timestamp: 13 }]);
  offOther();
});

test.each(["local", "remote"] as const)(
  "%s CDP close rejects every pending request and prevents new sends",
  async (side) => {
    const f = await transport();
    const pending = Promise.allSettled([
      f.cdp.send("Page.captureScreenshot"),
      f.cdp.send("Runtime.evaluate", { expression: "never resolves" }),
    ]);
    await f.received(2);
    if (side === "local") f.cdp.close();
    else f.socket.close(1000, "browser exited");
    const results = await pending;
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason.message).toContain(
          side === "local" ? "closed" : "disconnected",
        );
    }
    expect(f.cdp.connected).toBe(false);
    await expect(f.cdp.send("Browser.getVersion")).rejects.toThrow(
      "not connected",
    );
    expect(f.requests).toHaveLength(2);
    f.cdp.close();
  },
);

test("CDP connection failure rejects instead of returning a disconnected transport", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("not a websocket", { status: 403 }),
  });
  try {
    await expect(
      Cdp.connect(`ws://127.0.0.1:${server.port}/denied`),
    ).rejects.toThrow("Could not connect");
  } finally {
    server.stop(true);
  }
});
