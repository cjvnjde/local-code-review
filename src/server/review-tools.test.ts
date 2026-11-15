import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createReviewRoundStore } from "../review/rounds.ts";
import { createSession } from "../review/session.ts";
import { createHub } from "./events.ts";
import { JSON_LIMITS } from "./request-schemas.ts";
import { reviewToolsRoute } from "./review-tools.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "lcr-review-tools-"));
  roots.push(repoRoot);
  const file = path.join(repoRoot, "page.txt");
  await writeFile(file, "before\n");
  const session = createSession(repoRoot, ".review", "Working tree");
  const rounds = createReviewRoundStore({
    repoRoot,
    outDir: ".review",
    listFiles: async () => ["page.txt"],
  });
  const options = { repoRoot, outDir: ".review", session, hub: createHub() };
  const call = (
    route: string,
    method = "GET",
    body?: unknown,
    origin = "http://localhost:8123",
  ) => {
    const url = new URL(route, "http://localhost:8123");
    const request = new Request(url, {
      method,
      headers: { host: url.host, origin, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return reviewToolsRoute(request, url, options, rounds, 8123);
  };
  return { call, rounds, session, file };
}

test("manual rounds before first note compare, verify, invalidate and archive without creating Markdown", async () => {
  const { call, session, file } = await fixture();
  const response = await call("/api/review-rounds", "POST", {});
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const round = await response.json();
  expect(round.review).toBe("");
  expect(session.file).toBe("");
  await writeFile(file, "after\n");
  const comparison = await (
    await call(`/api/review-rounds/${round.id}`)
  ).json();
  expect(comparison.files[0].patch).toContain("-before");
  expect(comparison.files[0].patch).toContain("+after");
  const verified = await (
    await call(`/api/review-rounds/${round.id}/verify`, "POST", {
      fingerprint: comparison.fingerprint,
    })
  ).json();
  expect(verified.verification.state).toBe("verified");
  await writeFile(file, "new work\n");
  const stale = await (await call(`/api/review-rounds/${round.id}`)).json();
  expect(stale.verification.state).toBe("stale");
  await expect(
    call(`/api/review-rounds/${round.id}/verify`, "POST", {
      fingerprint: comparison.fingerprint,
    }),
  ).rejects.toHaveProperty("status", 409);
  expect(
    (await call(`/api/review-rounds/${round.id}/archive`, "POST", {})).status,
  ).toBe(200);
  expect((await (await call("/api/review-rounds")).json()).rounds).toEqual([]);
  expect(
    (
      await (await call("/api/review-rounds?archived=1&offset=0")).json()
    ).rounds.map((item: { id: string }) => item.id),
  ).toEqual([round.id]);
  expect(
    (await (await call(`/api/review-rounds/${round.id}`)).json()).files[0]
      .patch,
  ).toContain("+new work");
  expect(session.file).toBe("");
});

test("cross-origin evidence reads and baseline writes are denied before mutation", async () => {
  const { call, rounds } = await fixture();
  expect(
    (await call("/api/review-rounds", "POST", {}, "https://untrusted.invalid"))
      .status,
  ).toBe(403);
  expect(
    (
      await call(
        "/api/review-rounds",
        "GET",
        undefined,
        "https://untrusted.invalid",
      )
    ).status,
  ).toBe(403);
  expect(await rounds.list()).toEqual([]);
});

test("review tool envelopes, route IDs and pagination are bounded", async () => {
  const { call, rounds } = await fixture();
  await expect(
    call("/api/review-rounds", "POST", {
      extra: "x".repeat(JSON_LIMITS.control),
    }),
  ).rejects.toHaveProperty("status", 413);
  await expect(
    call("/api/review-rounds", "POST", { extra: true }),
  ).rejects.toHaveProperty("status", 400);
  await expect(call("/api/review-rounds?archived=yes")).rejects.toHaveProperty(
    "status",
    400,
  );
  await expect(
    call("/api/review-rounds?offset=9007199254740992"),
  ).rejects.toHaveProperty("status", 400);
  await expect(call("/api/review-rounds/not-a-round")).rejects.toHaveProperty(
    "status",
    400,
  );
  expect((await call("/api/review-rounds", "DELETE")).status).toBe(405);
  expect((await call("/api/web/accessibility", "POST", {})).status).toBe(404);
  expect(await rounds.list()).toEqual([]);
});
