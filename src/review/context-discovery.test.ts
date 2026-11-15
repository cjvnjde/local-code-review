import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveContext } from "./context.ts";
import { discoverContexts } from "./context-discovery.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-context-index-"));
  roots.push(root);
  return root;
}

test("discovery reads only historical manifests, preserving absent and partial evidence", async () => {
  const root = await directory();
  const ref = await saveContext(root, ".", {
    label: "Checkout",
    source: { target: "button · Save · Checkout" },
    parts: [
      {
        name: "layout",
        label: "Layout neighborhood",
        type: "application/json",
        data: '{"private":"payload must not enter the prompt"}',
        truncated: true,
      },
      {
        name: "diagnostics",
        label: "Recent failures",
        type: "application/json",
        status: "excluded",
        detail: "Recording was disabled.",
      },
    ],
  });
  // An inventory must neither open nor pretend to verify payloads.
  await rm(path.join(root, "context", ref.id, "layout.part"));
  const result = await discoverContexts(path.join(root, "review.md"), [
    ref.id,
    "0".repeat(64),
    ref.id,
  ]);
  expect(result.entries[0]?.target).toBe("button · Save · Checkout");
  expect(result.entries[0]?.parts).toMatchObject([
    { name: "layout", status: "available", truncated: true },
    { name: "diagnostics", status: "excluded", bytes: 0 },
  ]);
  expect(JSON.stringify(result)).not.toContain(
    "payload must not enter the prompt",
  );
  expect(result.entries[1]?.unavailable).toContain("Manifest missing");
  expect(result.omittedContexts).toBe(0);
});

test("large inventories stay bounded and tell the agent what remains undiscovered", async () => {
  const root = await directory();
  const refs = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      saveContext(root, ".", {
        label: `Capture ${index}`,
        parts: Array.from({ length: 64 }, (_, part) => ({
          name: `part-${part}`,
          label: "Evidence ".repeat(20),
          type: "text/plain",
          data: "Do not eagerly read this evidence.",
          detail: "Scope description ".repeat(20),
        })),
      }),
    ),
  );
  const result = await discoverContexts(
    path.join(root, "review.md"),
    refs.map((ref) => ref.id),
  );
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(6000);
  expect(result.entries[0]?.parts?.[0]?.name).toBe("part-0");
  expect(result.entries.some((entry) => (entry.omittedParts ?? 0) > 0)).toBe(
    true,
  );
  expect(result.omittedContexts).toBeGreaterThan(0);
  expect(result.entries.length + result.omittedContexts).toBe(refs.length);
});
