/** Bounded subprocesses for optional parser discovery, setup, and highlighting. */
export async function runParserCommand(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) {
  const child = Bun.spawn(args, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let bytes = 0;
  const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) return output + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024)
        throw new Error("Parser command output too large");
      output += decoder.decode(value, { stream: true });
    }
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
    for (const reader of readers) void reader.cancel().catch(() => {});
  }, options.timeoutMs ?? 3000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      read(readers[0]!),
      read(readers[1]!),
      child.exited,
    ]);
    if (timedOut) throw new Error("Parser command timed out");
    return { stdout, stderr, code };
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})));
    await child.exited;
  }
}
