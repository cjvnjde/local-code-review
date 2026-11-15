import { expect, test } from "bun:test";
import { contextTextSlice } from "./context.ts";
import {
  ContextQueryError,
  projectContext,
  type ContextQuery,
} from "./context-query.ts";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const project = (value: unknown, query: ContextQuery) =>
  JSON.parse(
    new TextDecoder().decode(
      projectContext(encode(value), "application/json", query).bytes,
    ),
  );

const layout = {
  version: 1,
  nodes: [
    {
      id: "target",
      selector: "#card",
      targets: ["#card"],
      styles: { display: "flex", gap: "8px", "--space": "8px" },
    },
    {
      id: "parent",
      selector: "main",
      targets: ["#card", "#other"],
      styles: { display: "grid", gap: "16px" },
    },
    {
      id: "other",
      selector: "#other",
      targets: ["#other"],
      styles: { display: "block", gap: "0px" },
    },
  ],
  exclusions: ["No form values"],
};

test("exact target filtering retains associated ancestors and narrows only requested styles", () => {
  expect(project(layout, { selector: "#card", property: "gap" })).toEqual({
    ...layout,
    nodes: [
      { ...layout.nodes[0], styles: { gap: "8px" } },
      { ...layout.nodes[1], styles: { gap: "16px" } },
    ],
  });
  expect(project(layout, { selector: "#car" }).nodes).toEqual([]);
  expect(
    project(layout, {
      selector: "#card",
      property: "--space",
      select: "/nodes/0/styles",
    }),
  ).toEqual({ "--space": "8px" });
  expect(
    project(layout, { property: "margin" }).nodes.every(
      (node: { styles: object }) => Object.keys(node.styles).length === 0,
    ),
  ).toBe(true);
});

test("CSS rules retain sources but not unrelated properties or rules", () => {
  const source = { url: "https://example.test/app.css", line: 3, column: 1 };
  const value = {
    nodes: [
      {
        selector: "main",
        targets: ["#card"],
        rules: [
          {
            selector: "main",
            source,
            properties: [
              { name: "gap", value: "8px", important: true },
              { name: "color", value: "red" },
            ],
          },
          { selector: "*", properties: [{ name: "margin", value: "0" }] },
        ],
      },
    ],
  };
  expect(
    project(value, {
      selector: "#card",
      property: "gap",
      select: "/nodes/0/rules",
    }),
  ).toEqual([
    {
      selector: "main",
      source,
      properties: [{ name: "gap", value: "8px", important: true }],
    },
  ]);
});

test("event windows are inclusive instants and selection runs afterward", () => {
  const events = [
    { at: "2026-11-15T11:00:00.000Z", type: "click" },
    { at: "2026-11-15T11:00:01.000Z", type: "request-failure" },
    { at: "2026-11-15T11:00:02.000Z", type: "warning" },
  ];
  const value = { version: 1, events, windowMs: 60000 };
  expect(
    project(value, {
      since: "2026-11-15T12:00:01+01:00",
      until: events[2]!.at,
      select: "/events",
    }),
  ).toEqual(events.slice(1));
  expect(project(value, { until: events[0]!.at }).events).toEqual(
    events.slice(0, 1),
  );
  expect(project(value, { since: "2026-11-16T00:00:00Z" }).events).toEqual([]);
  for (const since of [
    "2026-11-15",
    "2026-11-15T00:00:00",
    "2026-02-30T00:00:00Z",
    "2026-11-15T24:00:00Z",
    "yesterday",
  ])
    expect(() => project(value, { since })).toThrow(ContextQueryError);
  expect(() =>
    project(value, { since: events[2]!.at, until: events[0]!.at }),
  ).toThrow("since must not");
  expect(() =>
    project({ events: [{ type: "warning" }] }, { since: events[0]!.at }),
  ).toThrow("events.at");
});

test("JSON Pointer escaping, root, scalars and own-key boundaries", () => {
  const value = JSON.parse(
    '{"a/b":{"~key":[null,"🙂"],"":false},"__proto__":{"safe":true}}',
  );
  expect(project(value, { select: "/a~1b/~0key/1" })).toBe("🙂");
  expect(project(value, { select: "/a~1b/~0key/0" })).toBeNull();
  expect(project(value, { select: "/a~1b/" })).toBe(false);
  expect(project(value, { select: "/__proto__/safe" })).toBe(true);
  expect(project(value, { select: "" })).toEqual(value);
  for (const select of ["a/b", "/a~2b", "/a~"])
    expect(() => project(value, { select })).toThrow("JSON Pointer");
  for (const select of [
    "/constructor",
    "/toString",
    "/a~1b/__proto__",
    "/a~1b/~0key/length",
    "/a~1b/~0key/01",
    "/a~1b/~0key/-",
    "/a~1b/~0key/0/x",
    "/missing",
  ])
    expect(() => project(value, { select })).toThrow("does not exist");
});

test("unsupported shapes, malformed JSON, and non-JSON filters never return the original", () => {
  for (const value of [
    null,
    [],
    {},
    { nodes: {} },
    { nodes: [null] },
    { nodes: [{ selector: "x", targets: "x" }] },
  ])
    expect(() => project(value, { selector: "x" })).toThrow(ContextQueryError);
  for (const value of [
    { nodes: [{}] },
    { nodes: [{ styles: "gap: 8px" }] },
    { nodes: [{ styles: { gap: 8 } }] },
    { nodes: [{ rules: [{}] }] },
    { nodes: [{ rules: [{ properties: [{ name: "gap" }] }] }] },
  ])
    expect(() => project(value, { property: "gap" })).toThrow(
      ContextQueryError,
    );
  expect(() => project(layout, { since: "2026-11-15T00:00:00Z" })).toThrow(
    "events array",
  );
  expect(() => project(layout, { selector: "" })).toThrow("non-empty");
  expect(() => project(layout, { property: "gap;color" })).toThrow(
    "CSS property",
  );
  expect(() =>
    projectContext(new TextEncoder().encode("not json"), "application/json", {
      select: "",
    }),
  ).toThrow("valid UTF-8 JSON");
  expect(() =>
    projectContext(new Uint8Array([255]), "application/json", { select: "" }),
  ).toThrow("valid UTF-8 JSON");
  for (const type of [
    "text/plain",
    "text/html",
    "application/octet-stream",
    "image/png",
  ])
    expect(() => projectContext(encode(layout), type, { select: "" })).toThrow(
      "application/json part",
    );
});

test("pagination uses only deterministic projected bytes and rejects source-view offsets", () => {
  const bytes = encode({ private: "excluded".repeat(40), public: "a🙂éz" });
  const view = projectContext(bytes, "application/json", { select: "/public" });
  expect(view.projection).toMatchObject({
    select: "/public",
    order: "filters-then-select",
  });
  expect(contextTextSlice(view.bytes, 0, 4).content).toBe('"a');
  expect(contextTextSlice(view.bytes, 2, 4).content).toBe("🙂");
  expect(contextTextSlice(view.bytes, view.bytes.length).nextOffset).toBeNull();
  expect(() => contextTextSlice(view.bytes, 3)).toThrow("UTF-8");
  expect(() => contextTextSlice(view.bytes, 2, 3)).toThrow("too small");
  expect(() => contextTextSlice(view.bytes, bytes.length)).toThrow("within");
  let content = "";
  let offset: number | null = 0;
  while (offset !== null) {
    const slice = contextTextSlice(view.bytes, offset, 4);
    content += slice.content;
    offset = slice.nextOffset;
  }
  expect(JSON.parse(content)).toBe("a🙂éz");
  expect(content).not.toContain("excluded");
  expect(
    projectContext(bytes, "application/json", { select: "/public" }).bytes,
  ).toEqual(view.bytes);
  expect(projectContext(bytes, "application/json").bytes).toBe(bytes);
  expect(projectContext(bytes, "text/plain").projection).toBeUndefined();
});
