import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { contextRequestAllowed, contextRoute } from "./context.ts";
import { saveAttachment } from "../review/attach.ts";
import { CONTEXT_MAX_BYTES, CONTEXT_TEXT_MAX } from "../shared/context.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "lcr-context-http-"));
  roots.push(repoRoot);
  const options = {
    repoRoot,
    outDir: ".review",
    saveAttachment: (bytes: Uint8Array, type: string) =>
      saveAttachment(repoRoot, ".review", bytes, type),
  };
  const request = (route: string, init: RequestInit = {}) =>
    contextRoute(
      new Request(`http://localhost:7777/api/ai-context${route}`, {
        ...init,
        headers: {
          host: "localhost:7777",
          authorization: "Bearer run-token",
          ...init.headers,
        },
      }),
      options,
      "run-token",
      7777,
    );
  return { repoRoot, request };
}

test("token, host, and origin checks deny foreign access without CORS", async () => {
  const { request } = await fixture();
  for (const headers of [
    { authorization: "" },
    { authorization: "Bearer stale-token" },
    { host: "attacker.test:7777" },
    { origin: "http://attacker.test" },
    { origin: "null" },
  ]) {
    const response = await request("/" + "a".repeat(64), { headers });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }
  expect(
    contextRequestAllowed(
      new Request("http://evil.test:7777/api/settings", {
        headers: { host: "evil.test:7777" },
      }),
      7777,
    ),
  ).toBe(false);
  expect(
    contextRequestAllowed(
      new Request("http://localhost:7777/api/settings", {
        headers: { host: "localhost:7777", origin: "http://localhost:7777" },
      }),
      7777,
    ),
  ).toBe(true);
});

test("JSON upload returns a durable reference and bounded text continuation", async () => {
  const { request } = await fixture();
  const response = await request("", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Details", text: "a🙂éz" }),
  });
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.ref).toBe(`context/${saved.context.id}/manifest.json`);
  expect(saved.markdown).toContain(saved.ref);
  const manifestResponse = await request(`/${saved.context.id}`);
  expect(manifestResponse.status).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest.id).toBe(saved.context.id);
  expect(manifest.parts[0].name).toBe("content");
  const route = `/${saved.context.id}/parts/content`;
  const first = await (await request(route + "?offset=0&limit=4")).json();
  expect(first.content).toBe("a");
  expect(first.nextOffset).toBe(1);
  const second = await (await request(route + "?offset=1&limit=4")).json();
  expect(second.content).toBe("🙂");
  expect(second.nextOffset).toBe(5);
  expect(
    (await (await request(route + "?offset=5")).json()).nextOffset,
  ).toBeNull();
  for (const query of [
    "?offset=-1",
    "?offset=2",
    "?offset=100",
    "?limit=0",
    `?limit=${CONTEXT_TEXT_MAX + 1}`,
    "?offset=1.5",
  ])
    expect((await request(route + query)).status).toBe(400);
  expect((await request(`/${saved.context.id}/parts/missing`)).status).toBe(
    404,
  );
  expect((await request("/" + "b".repeat(64))).status).toBe(404);
});

test("multipart HTML is inert text, arbitrary files and SVG are inert binary", async () => {
  const { request } = await fixture();
  for (const [type, text] of [
    ["text/html", "<script>alert(1)</script>"],
    ["application/pdf", "%PDF-1.0"],
    ["image/svg+xml", "<svg onload='alert(1)'/>"],
  ]) {
    const form = new FormData();
    form.set(
      "file",
      new File([new TextEncoder().encode(text!)], "evidence", { type }),
    );
    form.set("type", type!);
    const uploaded = await request("", { method: "POST", body: form });
    expect(uploaded.status).toBe(200);
    const saved = await uploaded.json();
    const response = await request(`/${saved.context.id}/parts/content`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    if (type === "text/html") {
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect((await response.json()).content).toBe(text);
    } else {
      expect(response.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
      expect(response.headers.get("content-disposition")).toContain(
        "attachment",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "sandbox",
      );
      expect(await response.text()).toBe(text);
    }
  }
});

test("image upload reuses images storage without a duplicate bundle payload", async () => {
  const { repoRoot, request } = await fixture();
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([137, 80, 78, 71])], "picture.png", {
      type: "image/png",
    }),
  );
  const response = await request("", { method: "POST", body: form });
  expect(response.status).toBe(200);
  const saved = await response.json();
  const manifest = await (await request(`/${saved.context.id}`)).json();
  expect(manifest.parts[0].attachment).toMatch(/^images\/[a-f0-9]{16}\.png$/);
  expect(
    await readdir(path.join(repoRoot, ".review/context", saved.context.id)),
  ).toEqual(["manifest.json"]);
  const image = await request(`/${saved.context.id}/parts/content`);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
});

test("uploads reject unsupported shapes, oversized bodies and invalid JSON content", async () => {
  const { request } = await fixture();
  for (const payload of [
    { label: "JSON", text: "{", type: "application/json" },
    { label: "HTML", text: "x", type: "text/html" },
    { label: "", text: "x" },
    { label: "Missing text" },
  ]) {
    expect(
      (
        await request("", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(400);
  }
  expect(
    (
      await request("", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await request("", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(CONTEXT_MAX_BYTES * 6 + 65537),
        },
        body: "{}",
      })
    ).status,
  ).toBe(413);
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([0xff])], "invalid.txt", { type: "text/plain" }),
  );
  expect((await request("", { method: "POST", body: form })).status).toBe(400);
});

test("JSON framing does not shrink the saved-text byte limit", async () => {
  const { request } = await fixture();
  const text = "\n".repeat(CONTEXT_MAX_BYTES / 2 + 65536);
  const response = await request("", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Escaped text", text }),
  });
  expect(response.status).toBe(200);
  const saved = await response.json();
  const manifest = await (await request(`/${saved.context.id}`)).json();
  expect(manifest.parts[0].bytes).toBe(text.length);
});
