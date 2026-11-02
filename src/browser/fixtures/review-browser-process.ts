// A real child process exposing only the CDP lifecycle needed by launch tests.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const profile = args
  .find((arg) => arg.startsWith("--user-data-dir="))!
  .slice("--user-data-dir=".length);
const mode =
  args
    .find((arg) => arg.startsWith("--fixture-mode="))
    ?.slice("--fixture-mode=".length) ?? "ready";
const active = path.join(profile, "DevToolsActivePort");
writeFileSync(
  path.join(profile, "launch.json"),
  JSON.stringify({ args, staleEndpoint: existsSync(active) }),
);
process.on("SIGTERM", () => {
  writeFileSync(path.join(profile, "terminated"), "");
  process.exit(0);
});
if (mode === "exit") process.exit(7);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response("WebSocket required", { status: 400 });
  },
  websocket: {
    message(socket, raw) {
      const message = JSON.parse(String(raw));
      if (message.method === "Browser.getVersion")
        socket.send(
          JSON.stringify({
            id: message.id,
            result: { product: "LifecycleFixture/1" },
          }),
        );
      if (message.method === "Browser.close") {
        writeFileSync(path.join(profile, "browser-close"), "");
        socket.send(JSON.stringify({ id: message.id, result: {} }));
        setTimeout(() => process.exit(0), 20);
      }
    },
  },
});
if (mode === "refused") {
  const port = server.port;
  server.stop(true);
  writeFileSync(active, `${port}\n/devtools/browser/fixture\n`);
  setInterval(() => {}, 1000);
} else {
  writeFileSync(active, `${server.port}\n/devtools/browser/fixture\n`);
}
