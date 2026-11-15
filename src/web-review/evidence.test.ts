import { expect, test } from "bun:test";
import { browserEvidence, cssEvidence, safeEvidenceUrl } from "./evidence.ts";
import { DiagnosticsEvidence } from "./diagnostics-evidence.ts";

class ProtocolFixture {
  listeners = new Map<
    string,
    Set<(event: Record<string, unknown>, session?: string) => void>
  >();
  calls: string[] = [];
  matched: unknown[] = [];
  async send(
    method: string,
    _params?: Record<string, unknown>,
    _session?: string,
  ): Promise<Record<string, unknown>> {
    this.calls.push(method);
    if (method === "CSS.enable")
      this.emit("CSS.styleSheetAdded", {
        header: {
          styleSheetId: "sheet",
          sourceURL:
            "https://user:password@example.test/site.css?secret=value#token",
        },
      });
    if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
    if (method === "DOM.querySelector") return { nodeId: 2 };
    if (method === "CSS.getMatchedStylesForNode")
      return { matchedCSSRules: this.matched };
    return {};
  }
  on(
    method: string,
    callback: (event: Record<string, unknown>, session?: string) => void,
  ) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(callback);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(callback);
    };
  }
  emit(method: string, event: Record<string, unknown>, session = "target") {
    for (const callback of this.listeners.get(method) ?? [])
      callback(event, session);
  }
}
const node = {
  id: "n1",
  selector: "#selected",
  targets: ["#selected"],
  relation: "target",
  tag: "div",
  rect: { x: 0, y: 0, width: 20, height: 10 },
  styles: { display: "flex" },
};
const layout = (nodes: unknown[]) => ({
  data: JSON.stringify({
    version: 1,
    coordinateSpace: "capture viewport CSS pixels",
    nodes,
  }),
  truncated: false,
});

test("browser selectors require valid bounded JSON and an entirely valid layout graph", () => {
  expect(browserEvidence({ contextLayout: layout([node]) }).nodes).toEqual([
    { id: "n1", selector: "#selected", targets: ["#selected"] },
  ]);
  for (const payload of [
    { data: "not JSON", truncated: false },
    layout([node, node]),
    layout([{ ...node, selector: { toString: "#secret" } }]),
    layout([{ ...node, targets: [42] }]),
    layout([{ ...node, rect: { x: null, y: 0, width: 20, height: 10 } }]),
    { data: " ".repeat(128 * 1024 + 1), truncated: false },
  ]) {
    const result = browserEvidence({ contextLayout: payload });
    expect(result.nodes).toEqual([]);
    expect(result.parts[0]!.status).toBe("unavailable");
  }
});

test("CSS provenance is bounded and does not persist URLs, CSS payloads or unrelated custom properties", async () => {
  const protocol = new ProtocolFixture();
  protocol.matched = [
    {
      rule: {
        styleSheetId: "sheet",
        origin: "regular",
        selectorList: {
          text: "#selected",
          selectors: [{ range: { startLine: 12, startColumn: 3 } }],
        },
        style: {
          cssProperties: [
            { name: "display", value: "grid" },
            { name: "gap", value: "var(--gap)", important: true },
            { name: "--gap", value: "8px" },
            { name: "--private", value: "SECRET" },
            { name: "content", value: "SECRET" },
            { name: "background-image", value: "url(https://secret.test)" },
            { name: "color", value: "u\\72l(https://secret.test)" },
          ],
        },
      },
    },
  ];
  const nodes = Array.from({ length: 20 }, (_, index) => ({
    id: `n${index}`,
    selector: `#n${index}`,
    targets: ["#selected"],
  }));
  const part = await cssEvidence(protocol, "target", nodes);
  const json = JSON.parse(String(part.data));
  expect(
    protocol.calls.filter((method) => method === "DOM.querySelector"),
  ).toHaveLength(12);
  expect(json.unqueriedNodeIds).toHaveLength(8);
  expect(part.truncated).toBe(true);
  expect(json.nodes[0].rules[0].source).toEqual({
    url: "https://example.test/site.css",
    line: 12,
    column: 3,
  });
  expect(json.nodes[0].rules[0].properties).toEqual([
    { name: "display", value: "grid" },
    { name: "gap", value: "var(--gap)", important: true },
    { name: "--gap", value: "8px" },
  ]);
  expect(String(part.data)).not.toMatch(
    /SECRET|password|secret\.test|secret=value/,
  );
  expect(protocol.listeners.get("CSS.styleSheetAdded")?.size).toBe(0);
  expect(protocol.calls.at(-1)).toBe("CSS.disable");
});

test("unsupported CSS is unavailable rather than failing the primary capture", async () => {
  const protocol = new ProtocolFixture();
  protocol.send = async () => {
    throw new Error("SECRET protocol payload");
  };
  const part = await cssEvidence(protocol, "target", [
    { id: node.id, selector: node.selector, targets: node.targets },
  ]);
  expect(part.status).toBe("unavailable");
  expect(part.detail).not.toContain("SECRET");
});

test("diagnostics opt-in retains only safe session metadata and clears across lifecycle boundaries", async () => {
  const protocol = new ProtocolFixture();
  const recorder = new DiagnosticsEvidence(protocol, "target");
  await recorder.configure(false);
  expect(protocol.calls).toEqual([]);
  expect(recorder.snapshot(false).status).toBe("excluded");
  await recorder.configure(true);
  protocol.emit("Runtime.consoleAPICalled", {
    type: "error",
    args: [{ value: "SECRET" }],
    stackTrace: { description: "SECRET" },
  });
  protocol.emit(
    "Runtime.consoleAPICalled",
    { type: "warning", args: ["SECRET"] },
    "other-target",
  );
  protocol.emit("Runtime.exceptionThrown", {
    exceptionDetails: { text: "SECRET" },
  });
  protocol.emit("Network.requestWillBeSent", {
    requestId: "req",
    type: "Fetch",
    request: {
      method: "POST",
      url: "https://user:password@example.test/api?secret=value#token",
      headers: { token: "SECRET" },
      postData: "SECRET",
    },
  });
  protocol.emit("Network.responseReceived", {
    requestId: "req",
    response: {
      status: 503,
      url: "https://user:password@example.test/api?secret=value#token",
      statusText: "SECRET",
      headers: { token: "SECRET" },
    },
  });
  const saved = recorder.snapshot(true);
  const events = JSON.parse(String(saved.data)).events;
  expect(events).toHaveLength(3);
  expect(events[2]).toMatchObject({
    type: "http-error",
    method: "POST",
    resourceType: "Fetch",
    status: 503,
    url: "https://example.test/api",
  });
  expect(String(saved.data)).not.toMatch(/SECRET|password|secret=value/);
  recorder.clear();
  protocol.emit("Network.loadingFailed", {
    requestId: "req",
    errorText: "SECRET",
  });
  expect(JSON.parse(String(recorder.snapshot(true).data)).events).toEqual([]);
  expect(JSON.parse(String(saved.data)).events).toHaveLength(3);
  await recorder.configure(false);
  protocol.emit("Runtime.consoleAPICalled", { type: "error" });
  await recorder.configure(true);
  expect(JSON.parse(String(recorder.snapshot(true).data)).events).toEqual([]);
  for (let index = 0; index < 70; index++)
    protocol.emit("Runtime.consoleAPICalled", { type: "warning" });
  const bounded = recorder.snapshot(true);
  expect(JSON.parse(String(bounded.data)).events).toHaveLength(50);
  expect(bounded.truncated).toBe(true);
  recorder.dispose();
  expect(recorder.snapshot(true).status).toBe("unavailable");
  expect(
    [...protocol.listeners.values()].every((listeners) => listeners.size === 0),
  ).toBe(true);
});

test("diagnostics pending requests are bounded and unsafe URL schemes excluded", async () => {
  const protocol = new ProtocolFixture();
  const recorder = new DiagnosticsEvidence(protocol, "target");
  await recorder.configure(true);
  for (let index = 0; index < 110; index++)
    protocol.emit("Network.requestWillBeSent", {
      requestId: `r${index}`,
      request: { method: "SECRET", url: "data:text/plain,SECRET" },
      type: "SECRET",
    });
  protocol.emit("Network.loadingFailed", {
    requestId: "r0",
    errorText: "SECRET",
  });
  protocol.emit("Network.loadingFailed", {
    requestId: "r109",
    errorText: "SECRET",
  });
  const snapshot = recorder.snapshot(true);
  expect(JSON.parse(String(snapshot.data)).events).toHaveLength(1);
  expect(String(snapshot.data)).not.toContain("SECRET");
  expect(snapshot.truncated).toBe(true);
  expect(safeEvidenceUrl("file:///private/secret")).toBeUndefined();
  recorder.dispose();
});

test("late diagnostic enable completion cannot restore recording after disable", async () => {
  const protocol = new ProtocolFixture();
  const enabled = Promise.withResolvers<Record<string, unknown>>();
  const send = protocol.send.bind(protocol);
  protocol.send = (method, params, session) =>
    method === "Network.enable"
      ? enabled.promise
      : send(method, params, session);
  const recorder = new DiagnosticsEvidence(protocol, "target");
  const pending = recorder.configure(true);
  await recorder.configure(false);
  enabled.resolve({});
  await pending;
  protocol.emit("Runtime.consoleAPICalled", {
    type: "error",
    args: ["SECRET"],
  });
  expect(recorder.snapshot(true).status).toBe("unavailable");
  expect(
    [...protocol.listeners.values()].every((listeners) => listeners.size === 0),
  ).toBe(true);
  recorder.dispose();
});

test("CSS retains ancestor variable definitions and inline declarations without inventing activation or sources", async () => {
  const protocol = new ProtocolFixture();
  const send = protocol.send.bind(protocol);
  protocol.send = async (method, params, session) => {
    if (method === "DOM.querySelector")
      return { nodeId: params?.selector === "html" ? 3 : 2 };
    if (method === "CSS.getMatchedStylesForNode" && params?.nodeId === 3)
      return {
        matchedCSSRules: [
          {
            rule: {
              origin: "regular",
              selectorList: { text: ":root" },
              style: {
                cssProperties: [
                  { name: "--space", value: "var(--base)" },
                  { name: "--base", value: "24px" },
                  { name: "--unreferenced", value: "12px" },
                  { name: "--private", value: "SECRET" },
                ],
              },
            },
          },
        ],
      };
    if (method === "CSS.getMatchedStylesForNode")
      return {
        inlineStyle: {
          cssProperties: [
            { name: "margin-top", value: "var(--space)" },
            { name: "background-image", value: "url(SECRET)" },
          ],
        },
        matchedCSSRules: [
          {
            rule: {
              origin: "regular",
              selectorList: { text: "#target" },
              style: {
                cssProperties: [
                  { name: "gap", value: "var(--space)" },
                  { name: "color", value: "var(--private)" },
                ],
              },
              media: [
                { text: "(min-width: 1000px)", mediaList: [{ active: false }] },
              ],
              containerQueries: [{ text: "(width > 400px)" }],
            },
          },
        ],
      };
    return send(method, params, session);
  };
  const part = await cssEvidence(protocol, "target", [
    { id: "target", selector: "#target", targets: ["#target"] },
    { id: "root", selector: "html", targets: ["#target"] },
  ]);
  const data = JSON.parse(String(part.data));
  expect(data.nodes[0].rules[0]).toMatchObject({
    origin: "inline",
    sourceStatus: "unavailable",
    properties: [{ name: "margin-top", value: "var(--space)" }],
  });
  expect(data.nodes[0].rules[0].source).toBeUndefined();
  expect(data.nodes[0].rules[1].media).toEqual([
    { text: "(min-width: 1000px)", queries: [{ active: false }] },
  ]);
  expect(data.nodes[0].rules[1].containerQueries).toEqual([
    { text: "(width > 400px)", activation: "unknown" },
  ]);
  expect(data.nodes[1].rules[0].properties).toEqual([
    { name: "--space", value: "var(--base)" },
    { name: "--base", value: "24px" },
  ]);
  expect(String(part.data)).not.toMatch(/SECRET|--unreferenced/);
});
