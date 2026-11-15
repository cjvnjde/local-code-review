import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const directory = process.env.LCR_DOCTOR_FIXTURE!;
writeFileSync(path.join(directory, "pid"), String(process.pid));
const decoder = new TextDecoder();
let buffer = "";
for await (const bytes of Bun.stdin.stream()) {
  buffer += decoder.decode(bytes, { stream: true });
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    appendFileSync(path.join(directory, "methods"), message.method + "\n");
    if (message.method !== "initialize") process.exit(23);
    const flushed = Promise.withResolvers<void>();
    process.stderr.write(
      "PRIVATE_PREFIX" + "x".repeat(20_000) + "\nPRIVATE_TAIL\u001b[31m\n",
      () => flushed.resolve(),
    );
    await flushed.promise;
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        ...(process.env.LCR_DOCTOR_MODE === "init-error"
          ? {
              error: {
                code: -32000,
                message: "External authentication required",
              },
            }
          : {
              result: {
                protocolVersion: 1,
                agentCapabilities: {
                  loadSession: true,
                  promptCapabilities: { image: true },
                },
                authMethods: [],
              },
            }),
      }) + "\n",
    );
  }
}
