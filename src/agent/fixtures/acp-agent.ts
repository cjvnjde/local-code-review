// Deterministic ACP peer for lifecycle tests. This is not a real coding agent.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
const directory = process.env.LCR_ACP_FIXTURE!;
const mode = process.env.LCR_ACP_MODE ?? "";
const log = (value: any) =>
  appendFileSync(
    path.join(directory, "rpc.jsonl"),
    JSON.stringify(value) + "\n",
  );
const send = (value: any) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
const result = (id: any, value: any) => send({ id, result: value });
let session = "";
let cancelled = false;
let turns = 0;
const permissions = new Map<any, (value: any) => void>();
async function receive(message: any) {
  log(message);
  if (message.method === "initialize")
    result(message.id, {
      protocolVersion: mode === "version" ? 2 : 1,
      agentCapabilities: {
        loadSession: mode !== "no-load",
        promptCapabilities: { image: false },
      },
      authMethods: [],
    });
  if (message.method === "session/new" && mode === "auth") {
    send({
      id: message.id,
      error: {
        code: -32000,
        message: "Authentication required; log in externally.",
      },
    });
    return;
  }
  if (message.method === "session/new") {
    session = "fixture-session";
    result(message.id, { sessionId: session });
  }
  if (message.method === "session/load") {
    session = message.params.sessionId;
    send({
      method: "session/update",
      params: {
        sessionId: session,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "HISTORY REPLAY MUST NOT BECOME A REPLY",
          },
        },
      },
    });
    result(message.id, {});
  }
  if (message.method === "session/cancel") cancelled = true;
  if (!message.method && permissions.has(message.id)) {
    permissions.get(message.id)!(message.result);
    permissions.delete(message.id);
  }
  if (message.method === "session/prompt") {
    cancelled = false;
    const turn = ++turns;
    writeFileSync(path.join(directory, "started-" + turn), "");
    if (mode === "crash") process.exit(7);
    let permission: any;
    if (mode === "permission") {
      const id = "approval-" + turn;
      const waiting = new Promise((resolve) => permissions.set(id, resolve));
      send({
        id,
        method: "session/request_permission",
        params: {
          sessionId: session,
          toolCall: {
            toolCallId: "write",
            title: "Write fixture file",
            rawInput: { path: "fixture.txt" },
          },
          options: [
            { optionId: "yes", name: "Allow once", kind: "allow_once" },
            { optionId: "no", name: "Reject once", kind: "reject_once" },
          ],
        },
      });
      permission = await waiting;
      writeFileSync(
        path.join(directory, "permission-" + turn),
        JSON.stringify(permission),
      );
    }
    while (!cancelled && !existsSync(path.join(directory, "release-" + turn)))
      await Bun.sleep(10);
    const final = JSON.stringify({
      status:
        permission?.outcome?.optionId === "no" ? "needs-input" : "answered",
      body: "Fixture answer " + turn,
    });
    send({
      method: "session/update",
      params: {
        sessionId: session,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: final },
        },
      },
    });
    result(message.id, {
      stopReason: cancelled
        ? "cancelled"
        : mode === "blocked"
          ? "max_tokens"
          : "end_turn",
    });
  }
}
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line) void receive(JSON.parse(line));
  }
}
