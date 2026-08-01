const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export async function runGit(args: string[], cwd?: string): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readOutput(process.stdout, MAX_GIT_OUTPUT_BYTES),
    readOutput(process.stderr, MAX_GIT_OUTPUT_BYTES),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new GitError(stderr.trim() || `git exited with status ${exitCode}`, args, exitCode);
  }
  return stdout;
}

async function readOutput(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`git output exceeded ${maxBytes} bytes`);
    }
    output += decoder.decode(value, { stream: true });
  }
}

export async function findRepoRoot(): Promise<string> {
  return (await runGit(["rev-parse", "--show-toplevel"])).trim();
}
