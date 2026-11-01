// A stdio peer with independent server-initiated requests and deliberately faulty frames.
const held: { id: number; name: string }[] = [];
const decisions: unknown[] = [];
let unsupportedRequest: number | undefined;
function send(value: unknown) {
  process.stdout.write(JSON.stringify(value) + "\n");
}
function result(id: unknown, value: unknown) {
  send({ jsonrpc: "2.0", id, result: value });
}
interface Message {
  id: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}
async function receive(message: Message) {
  switch (message.method) {
    case "initialize":
      result(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: process.env.LCR_ACP_MODE !== "no-load",
        },
      });
      break;
    case "session/new":
      result(message.id, {
        sessionId:
          process.env.LCR_ACP_MODE === "invalid-session"
            ? ""
            : "created-session",
      });
      break;
    case "session/load":
      result(message.id, {});
      break;
    case "fixture/hold":
      if (
        typeof message.id === "number" &&
        typeof message.params?.name === "string"
      )
        held.push({ id: message.id, name: message.params.name });
      break;
    case "fixture/finish":
      for (const request of held.splice(0).reverse())
        result(request.id, { value: request.name === "one" ? 11 : 22 });
      result(message.id, {});
      break;
    case "fixture/error":
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32042, message: "Sandbox denied access" },
      });
      break;
    case "fixture/events":
      process.stdout.write("\n \n");
      send({ jsonrpc: "2.0", id: 999999, result: {} });
      send({ jsonrpc: "2.0", method: "vendor/ignored", params: {} });
      {
        const bytes = Buffer.from(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "created-session",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "résumé 🦊" },
              },
            },
          }) + "\n",
        );
        const split = bytes.indexOf(Buffer.from("🦊")) + 2;
        process.stdout.write(bytes.subarray(0, split));
        // Separate real stdio writes inside a UTF-8 code point to exercise the streaming decoder.
        await Bun.sleep(1);
        process.stdout.write(bytes.subarray(split));
      }
      result(message.id, {});
      break;
    case "fixture/permission":
      send({
        jsonrpc: "2.0",
        id: "permission-" + message.params?.sessionId,
        method: "session/request_permission",
        params: {
          sessionId: message.params?.sessionId,
          toolCall: { title: "Read protected file" },
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "deny", name: "Reject once", kind: "reject_once" },
          ],
        },
      });
      result(message.id, {});
      break;
    case "session/cancel":
      decisions.push({ method: "session/cancel", params: message.params });
      break;
    case "fixture/decisions":
      result(message.id, decisions);
      break;
    case "fixture/unsupported":
      if (typeof message.id === "number") unsupportedRequest = message.id;
      send({
        jsonrpc: "2.0",
        id: "client-request",
        method: "fs/read_text_file",
        params: { path: "/private/secret" },
      });
      break;
    case "fixture/bad":
      if (message.params?.kind === "json")
        process.stdout.write("{invalid json\n");
      else if (message.params?.kind === "version")
        send({ jsonrpc: "1.0", id: message.id, result: {} });
      else
        send({
          jsonrpc: "2.0",
          id: "bad-permission",
          method: "session/request_permission",
          params: {
            sessionId: "created-session",
            options: [{ optionId: 7, name: "Invalid" }],
          },
        });
      break;
    case "fixture/exit":
      process.exit(9);
    default:
      if (!message.method) {
        if (message.id === "client-request")
          result(unsupportedRequest, message);
        else decisions.push({ id: message.id, result: message.result });
      }
  }
}
let buffer = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line) void receive(JSON.parse(line));
  }
}
