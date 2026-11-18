import { expect, test } from "bun:test";
import { waitForPageOverlay } from "./overlay-readiness.ts";

test("the startup deadline expires even if the renderer never answers its first probe", async () => {
  const renderer = Promise.withResolvers<boolean>();
  let probes = 0;
  await expect(
    waitForPageOverlay(
      () => {
        probes++;
        return renderer.promise;
      },
      undefined,
      25,
    ),
  ).rejects.toThrow("did not start in time");
  expect(probes).toBe(1);
});

test("a navigation or loading document can become ready before the deadline", async () => {
  let probes = 0;
  await waitForPageOverlay(async () => {
    probes++;
    if (probes === 1) throw new Error("Execution context was destroyed.");
    return probes === 3;
  });
  expect(probes).toBe(3);
});

test("closing a connection interrupts an outstanding startup probe", async () => {
  const connection = new AbortController();
  const renderer = Promise.withResolvers<boolean>();
  const ready = waitForPageOverlay(() => renderer.promise, connection.signal);
  connection.abort();
  await expect(ready).rejects.toThrow("connection is closing");
});
