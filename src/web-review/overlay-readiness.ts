/** Navigation can briefly destroy a context, or a blocked renderer can stop replying entirely. */
export async function waitForPageOverlay(
  probe: () => Promise<boolean>,
  closing?: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  const { promise: stopped, reject } = Promise.withResolvers<never>();
  const closed = () => new Error("The browser connection is closing.");
  if (closing?.aborted) throw closed();
  const onClose = () => reject(closed());
  closing?.addEventListener("abort", onClose, { once: true });
  const timer = setTimeout(
    () =>
      reject(
        new Error(
          "The annotation toolbar did not start in time. Check that the local page has loaded and responds, then try Open page again.",
        ),
      ),
    timeoutMs,
  );
  try {
    while (!(await Promise.race([probe().catch(() => false), stopped])))
      await Promise.race([Bun.sleep(100), stopped]);
  } finally {
    clearTimeout(timer);
    closing?.removeEventListener("abort", onClose);
  }
}
