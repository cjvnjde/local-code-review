import { describe, expect, test } from "bun:test";
import { createHub } from "./events.ts";

describe("createHub", () => {
  test("emits one server-sent event to every connected page", () => {
    const hub = createHub();
    const first: string[] = [];
    const second: string[] = [];
    hub.add((chunk) => first.push(chunk));
    hub.add((chunk) => second.push(chunk));

    hub.emit({ type: "review", file: ".review/review-1.md" });

    const expected = [
      'data: {"type":"review","file":".review/review-1.md"}\n\n',
    ];
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(hub.size).toBe(2);
  });

  test("the detach callback stops future events for that page", () => {
    const hub = createHub();
    const chunks: string[] = [];
    const detach = hub.add((chunk) => chunks.push(chunk));

    detach();
    hub.emit({ type: "diff" });

    expect(chunks).toEqual([]);
    expect(hub.size).toBe(0);
  });

  test("a failed page is evicted without blocking the other pages", () => {
    const hub = createHub();
    const chunks: string[] = [];
    hub.add(() => {
      throw new Error("page closed");
    });
    hub.add((chunk) => chunks.push(chunk));

    hub.emit({ type: "diff" });
    hub.emit({ type: "diff" });

    expect(chunks).toEqual([
      'data: {"type":"diff"}\n\n',
      'data: {"type":"diff"}\n\n',
    ]);
    expect(hub.size).toBe(1);
  });

  test("pings connected pages and evicts a page that cannot receive one", () => {
    const hub = createHub();
    const chunks: string[] = [];
    hub.add((chunk) => chunks.push(chunk));
    hub.add(() => {
      throw new Error("page closed");
    });

    hub.ping();

    expect(chunks).toEqual([": ping\n\n"]);
    expect(hub.size).toBe(1);
  });
});

describe("hub subscription transitions", () => {
  test("subscribers added during delivery start with the next event, while a page may detach itself", () => {
    const hub = createHub();
    const first: string[] = [];
    const stable: string[] = [];
    const later: string[] = [];
    let detachFirst: () => void;
    const receiveLater = (chunk: string) => {
      later.push(chunk);
    };
    detachFirst = hub.add((chunk) => {
      first.push(chunk);
      hub.add(receiveLater);
      detachFirst();
    });
    const detachStable = hub.add((chunk) => stable.push(chunk));
    hub.emit({ type: "diff" });
    expect(first).toEqual(['data: {"type":"diff"}\n\n']);
    expect(stable).toEqual(first);
    expect(later).toEqual([]);
    expect(hub.size).toBe(2);
    hub.emit({ type: "settings" });
    expect(first).toHaveLength(1);
    expect(stable).toHaveLength(2);
    expect(later).toEqual(['data: {"type":"settings"}\n\n']);
    detachFirst();
    detachStable();
    detachStable();
    expect(hub.size).toBe(1);
  });

  test("a heartbeat failure evicts a page permanently even if its next write would succeed", () => {
    const hub = createHub();
    let attempts = 0;
    const chunks: string[] = [];
    hub.add(() => {
      if (++attempts === 1) throw new Error("disconnected during heartbeat");
    });
    hub.add((chunk) => chunks.push(chunk));
    hub.ping();
    hub.emit({ type: "review", file: "review.md" });
    hub.ping();
    expect(attempts).toBe(1);
    expect(chunks).toEqual([
      ": ping\n\n",
      'data: {"type":"review","file":"review.md"}\n\n',
      ": ping\n\n",
    ]);
    expect(hub.size).toBe(1);
  });
});
