import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AcpClient, type Permission } from "./acp.ts";

const clients: AcpClient[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
async function peer(mode = "") {
  const root = mkdtempSync(path.join(tmpdir(), "lcr-acp-protocol-"));
  roots.push(root);
  const updates: { session: string; update: unknown }[] = [];
  const permissions: Permission[] = [];
  const losses: Error[] = [];
  const client = new AcpClient(
    {
      name: "Protocol fixture",
      command: process.execPath,
      args: [path.join(import.meta.dir, "fixtures/acp-protocol.ts")],
      env: { LCR_ACP_MODE: mode },
    },
    root,
    {
      update(session, update: unknown) {
        updates.push({ session, update });
      },
      permission(permission) {
        permissions.push(permission);
      },
      lost(error) {
        losses.push(error);
      },
    },
  );
  clients.push(client);
  await client.start();
  return { client, updates, permissions, losses };
}

test("ACP correlates concurrent out-of-order replies and protocol errors do not poison other requests", async () => {
  const f = await peer();
  const one = f.client.request("fixture/hold", { name: "one" });
  const two = f.client.request("fixture/hold", { name: "two" });
  await expect(f.client.request("fixture/error", {})).rejects.toThrow(
    "ACP -32042: Sandbox denied access",
  );
  await f.client.request("fixture/finish", {});
  expect(await one).toEqual({ value: 11 });
  expect(await two).toEqual({ value: 22 });
  expect(await f.client.session()).toBe("created-session");
  expect(f.losses).toEqual([]);
});

test("ACP routes Unicode session updates and ignores blank lines, unknown responses and notifications", async () => {
  const f = await peer();
  await f.client.request("fixture/events", {});
  expect(f.updates).toEqual([
    {
      session: "created-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "résumé 🦊" },
      },
    },
  ]);
  expect(f.permissions).toEqual([]);
  expect(f.losses).toEqual([]);
  expect(await f.client.session()).toBe("created-session");
});

test("ACP rejects unadvertised server methods rather than granting filesystem access", async () => {
  const f = await peer();
  const response = await f.client.request("fixture/unsupported", {});
  expect(response).toMatchObject({
    jsonrpc: "2.0",
    id: "client-request",
    error: { code: -32601 },
  });
  expect(response).not.toHaveProperty("result");
  expect(f.permissions).toEqual([]);
  expect(await f.client.session()).toBe("created-session");
});

test("permission choices are one-shot and cancellation only dismisses permissions belonging to that session", async () => {
  const f = await peer();
  await f.client.request("fixture/permission", { sessionId: "a" });
  await f.client.request("fixture/permission", { sessionId: "b" });
  const [a, b] = f.permissions;
  expect(a!.id).not.toBe(b!.id);
  expect(() => f.client.decide(a!.id, "invented")).toThrow(
    "no longer available",
  );
  expect(await f.client.request("fixture/decisions", {})).toEqual([]);
  f.client.cancel("a");
  expect(() => f.client.decide(a!.id, "allow")).toThrow("no longer available");
  f.client.decide(b!.id, "deny");
  expect(() => f.client.decide(b!.id, "deny")).toThrow("no longer available");
  expect(await f.client.request("fixture/decisions", {})).toEqual([
    { id: "permission-a", result: { outcome: { outcome: "cancelled" } } },
    { method: "session/cancel", params: { sessionId: "a" } },
    {
      id: "permission-b",
      result: { outcome: { outcome: "selected", optionId: "deny" } },
    },
  ]);
});

test.each(["json", "version", "permission"])(
  "invalid ACP %s frames reject all pending work and report one terminal loss",
  async (kind) => {
    const f = await peer();
    await f.client.request("fixture/permission", { sessionId: "a" });
    const pending = Promise.allSettled([
      f.client.request("fixture/hold", { name: "one" }),
      f.client.request("fixture/bad", { kind }),
    ]);
    const results = await pending;
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(f.losses).toHaveLength(1);
    if (kind === "version") expect(f.losses[0]!.message).toContain("JSON-RPC");
    if (kind === "permission")
      expect(f.losses[0]!.message).toContain("permission options");
    await expect(f.client.request("session/new", {})).rejects.toThrow("closed");
    expect(() => f.client.decide(f.permissions[0]!.id, "allow")).toThrow(
      "no longer available",
    );
    await f.client.close();
    expect(f.losses).toHaveLength(1);
  },
);

test("ACP process exit rejects outstanding requests and intentional close remains silent", async () => {
  const f = await peer();
  const pending = Promise.allSettled([
    f.client.request("fixture/hold", { name: "one" }),
    f.client.request("fixture/exit", {}),
  ]);
  expect((await pending).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  await f.client.close();
  expect(f.losses).toHaveLength(1);
  const healthy = await peer();
  const stopped = healthy.client
    .request("fixture/hold", { name: "one" })
    .catch((error: Error) => error);
  await healthy.client.close();
  expect(await stopped).toBeInstanceOf(Error);
  expect((await stopped).message).toContain("stopped");
  expect(healthy.losses).toEqual([]);
  await expect(healthy.client.request("session/new", {})).rejects.toThrow(
    "closed",
  );
});

test("an ACP request timeout fails the whole connection rather than permitting concurrent uncertain execution", async () => {
  const f = await peer();
  // This is a real subprocess/transport deadline: fake timers cannot drive its stdio.
  const pending = Promise.allSettled([
    f.client.request("fixture/hold", { name: "one" }, 30),
    f.client.request("fixture/hold", { name: "two" }),
  ]);
  for (const result of await pending) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected")
      expect(result.reason.message).toContain("timed out");
  }
  expect(f.losses).toHaveLength(1);
  await expect(f.client.request("fixture/finish", {})).rejects.toThrow(
    "closed",
  );
});

test("ACP session restoration honors negotiated load support and validates new session identifiers", async () => {
  const supported = await peer();
  expect(await supported.client.session("previous-session")).toBe(
    "previous-session",
  );
  const unsupported = await peer("no-load");
  await expect(unsupported.client.session("previous-session")).rejects.toThrow(
    "cannot restore",
  );
  expect(await unsupported.client.session()).toBe("created-session");
  const invalid = await peer("invalid-session");
  await expect(invalid.client.session()).rejects.toThrow("no session id");
});
