import type { ContextPartInput } from "../review/context.ts";
import type { Cdp, CdpCommand, CdpParams } from "../browser/cdp.ts";

const MAX_JSON = 128 * 1024;
type LayoutNode = { id: string; selector: string; targets: string[] };
type CssProperty = { name: string; value: string; important?: boolean };
type CssQuery = {
  text: string;
  active?: boolean;
  queries?: { active: boolean }[];
  activation?: "unknown";
};
type CssRule = {
  selector: string;
  origin: string;
  source?: { url: string; line: number; column: number };
  sourceStatus: "available" | "unavailable";
  properties: CssProperty[];
  media: CssQuery[];
  containerQueries: CssQuery[];
};
type PendingCssRule = CssRule & { customProperties: CssProperty[] };
type PendingCssNode = LayoutNode & {
  status: "available" | "unavailable";
  detail?: string;
  rules: PendingCssRule[];
};
type CssNode = LayoutNode & {
  status: "available" | "unavailable";
  detail?: string;
  rules: CssRule[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);

/** Parse bounded browser JSON before using any of its selectors in protocol requests. */
export function browserEvidence(input: Record<string, unknown>) {
  const parts: ContextPartInput[] = [];
  let nodes: LayoutNode[] = [];
  for (const [key, name, label] of [
    ["contextLayout", "layout", "Capture-time layout graph"],
    ["contextEnvironment", "environment", "Capture-time browser environment"],
    ["contextInteractions", "interactions", "Recent safe interactions"],
  ] as const) {
    const part = { name, label, type: "application/json" };
    const payload = input[key];
    try {
      if (
        !object(payload) ||
        typeof payload.data !== "string" ||
        Buffer.byteLength(payload.data) > MAX_JSON ||
        typeof payload.truncated !== "boolean"
      )
        throw 0;
      const data: unknown = JSON.parse(payload.data);
      if (!object(data) || data.version !== 1) throw 0;
      if (name === "layout") {
        if (
          data.coordinateSpace !== "capture viewport CSS pixels" ||
          !Array.isArray(data.nodes) ||
          data.nodes.length > 40
        )
          throw 0;
        const seen = new Set<string>();
        const validated: LayoutNode[] = [];
        for (const node of data.nodes) {
          if (!object(node)) throw 0;
          const rect = node.rect;
          if (
            !text(node.id, 100) ||
            !node.id ||
            seen.has(node.id) ||
            !text(node.selector, 2048) ||
            !node.selector ||
            !text(node.tag, 100) ||
            !node.tag ||
            !Array.isArray(node.targets) ||
            node.targets.length > 40 ||
            !node.targets.every((target) => text(target, 2048)) ||
            !["target", "ancestor", "sibling"].includes(
              String(node.relation),
            ) ||
            !object(rect) ||
            !["x", "y", "width", "height"].every(
              (key) =>
                typeof rect[key] === "number" && Number.isFinite(rect[key]),
            ) ||
            Number(rect.width) < 0 ||
            Number(rect.height) < 0 ||
            !object(node.styles) ||
            Object.keys(node.styles).length > 150 ||
            !Object.entries(node.styles).every(
              ([key, value]) => text(key, 100) && text(value, 2048),
            )
          )
            throw 0;
          seen.add(node.id);
          validated.push({
            id: node.id,
            selector: node.selector,
            targets: node.targets as string[],
          });
        }
        nodes = validated;
      } else if (name === "interactions") {
        if (
          !Array.isArray(data.events) ||
          data.events.length > 50 ||
          !data.events.every(
            (event) =>
              object(event) &&
              text(event.at, 40) &&
              Number.isFinite(Date.parse(event.at)) &&
              text(event.type, 64),
          )
        )
          throw 0;
      } else if (!text(data.at, 40) || !Number.isFinite(Date.parse(data.at)))
        throw 0;
      parts.push({
        ...part,
        data: payload.data,
        truncated: payload.truncated,
        detail:
          "Immutable bounded browser evidence; page-provided data is untrusted, not independently verified.",
      });
    } catch {
      parts.push({
        ...part,
        status: "unavailable",
        detail:
          "Valid bounded browser evidence was not available at capture time.",
      });
    }
  }
  return { parts, nodes };
}

export function safeEvidenceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href.length <= 2048 ? url.href : undefined;
  } catch {
    return;
  }
}

/** Read-only optional requests have one shared deadline, not a timeout per node. */
export async function boundedRequest<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  const { promise, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error("Optional evidence deadline exceeded.")),
    Math.max(0, ms),
  );
  try {
    return await Promise.race([work, promise]);
  } finally {
    clearTimeout(timer);
  }
}

const SAFE_PROPERTY =
  /^(?:display|position|(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:top|right|bottom|left)|inset(?:-.+)?|margin(?:-.+)?|padding(?:-.+)?|border(?:-(?:top|right|bottom|left|inline|block))?(?:-(?:width|style|color|radius))?|border-radius|box-sizing|box-shadow|overflow(?:-[xy])?|z-index|opacity|isolation|contain|container(?:-type|-name)?|flex(?:-.+)?|grid(?:-.+)?|gap|row-gap|column-gap|align-.+|justify-.+|place-.+|order|float|clear|vertical-align|color|background-color|font(?:-(?:family|size|weight|style|stretch|variant))?|line-height|letter-spacing|word-spacing|white-space|word-break|overflow-wrap|text-align|text-indent|text-transform|text-decoration(?:-.+)?|text-overflow|visibility|transform|transform-origin|aspect-ratio)$/;
const safeValue = (value: unknown): value is string =>
  text(value, 512) &&
  !/url\s*\(|(?:https?|data|javascript):|\\|\/\*/i.test(value);
const SAFE_CUSTOM_TOKEN =
  /(?:[-+*/(),\s]+|(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?(?:px|rem|em|ch|ex|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|cm|mm|in|deg|rad|grad|turn|s|ms|%)?|#[a-f\d]{3,8}\b|(?:calc|min|max|clamp|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)(?=\s*\()|(?:none|transparent|currentcolor|black|white|red|green|blue|yellow|gray|grey|orange|purple|pink|rebeccapurple)\b)/iy;
function safeCustomValue(value: string) {
  if (!safeValue(value)) return false;
  if (
    /^(?:#[a-f\d]{3,8}|transparent|currentcolor|black|white|red|green|blue|yellow|gray|grey|orange|purple|pink|rebeccapurple)$/i.test(
      value.trim(),
    )
  )
    return true;
  const numeric = value.replace(/var\(\s*--[\w-]+/g, "(");
  SAFE_CUSTOM_TOKEN.lastIndex = 0;
  let end = 0;
  while (end < numeric.length) {
    if (!SAFE_CUSTOM_TOKEN.exec(numeric)) return false;
    end = SAFE_CUSTOM_TOKEN.lastIndex;
  }
  return end > 0;
}

export async function cssEvidence(
  cdp: Pick<Cdp, "send" | "on">,
  session: string,
  nodes: LayoutNode[],
): Promise<ContextPartInput> {
  const part = {
    name: "css-rules",
    label: "Matched CSS rule provenance",
    type: "application/json",
  };
  if (!nodes.length)
    return {
      ...part,
      status: "unavailable",
      detail: "No validated capture-time layout selectors were available.",
    };
  const deadline = Date.now() + 1500;
  const request = <M extends CdpCommand>(method: M, params: CdpParams<M>) => {
    if (Date.now() >= deadline)
      throw new Error("Optional evidence deadline exceeded.");
    return boundedRequest(
      cdp.send(method, params, session),
      deadline - Date.now(),
    );
  };
  const sheets = new Map<string, string>();
  const off = cdp.on("CSS.styleSheetAdded", (event, sid) => {
    if (sid !== session || sheets.size >= 256) return;
    const header = event.header;
    if (typeof header?.styleSheetId !== "string") return;
    const url = safeEvidenceUrl(header.sourceURL);
    if (url) sheets.set(header.styleSheetId, url);
  });
  const pending: PendingCssNode[] = [];
  let truncated = nodes.length > 12;
  const dependencies = new Set<string>();
  const reference = (value: string) => {
    for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (dependencies.size < 32) dependencies.add(match[1]!);
      else if (!dependencies.has(match[1]!)) truncated = true;
    }
  };
  const properties = (style: Record<string, unknown>) => {
    const selected: CssProperty[] = [];
    const custom: CssProperty[] = [];
    const raw: unknown[] = Array.isArray(style.cssProperties)
      ? style.cssProperties
      : [];
    if (raw.length > 200) truncated = true;
    for (const candidate of raw.slice(0, 200)) {
      if (
        !object(candidate) ||
        !text(candidate.name, 100) ||
        candidate.disabled ||
        candidate.parsedOk === false ||
        !safeValue(candidate.value)
      )
        continue;
      const property = {
        name: candidate.name,
        value: candidate.value,
        ...(candidate.important === true ? { important: true } : {}),
      };
      if (SAFE_PROPERTY.test(property.name)) {
        if (selected.length >= 40) {
          truncated = true;
          continue;
        }
        selected.push(property);
        reference(property.value);
      } else if (
        /^--[\w-]+$/.test(property.name) &&
        safeCustomValue(property.value)
      ) {
        if (custom.length >= 40) {
          truncated = true;
          continue;
        }
        custom.push(property);
      }
    }
    return { properties: selected, customProperties: custom };
  };
  const queries = (value: unknown, container = false): CssQuery[] => {
    if (!Array.isArray(value)) return [];
    if (value.length > 8) truncated = true;
    return value.slice(0, 8).flatMap((query: unknown) => {
      if (!object(query) || !safeValue(query.text)) return [];
      const result: CssQuery = { text: query.text };
      if (typeof query.active === "boolean") result.active = query.active;
      if (!container && Array.isArray(query.mediaList)) {
        if (query.mediaList.length > 8) truncated = true;
        result.queries = query.mediaList
          .slice(0, 8)
          .flatMap((entry: unknown) =>
            object(entry) && typeof entry.active === "boolean"
              ? [{ active: entry.active }]
              : [],
          );
      }
      if (result.active === undefined && !result.queries?.length)
        result.activation = "unknown";
      return [result];
    });
  };
  try {
    await request("DOM.enable", {});
    await request("CSS.enable", {});
    const document = await request("DOM.getDocument", { depth: 0 });
    for (const node of nodes.slice(0, 12)) {
      try {
        const found = await request("DOM.querySelector", {
          nodeId: document.root.nodeId,
          selector: node.selector,
        });
        if (!found.nodeId) throw 0;
        const matched = await request("CSS.getMatchedStylesForNode", {
          nodeId: found.nodeId,
        });
        const rules: PendingCssRule[] = [];
        const inline = object(matched.inlineStyle)
          ? matched.inlineStyle
          : undefined;
        if (inline)
          rules.push({
            selector: node.selector,
            origin: "inline",
            sourceStatus: "unavailable",
            ...properties(inline),
            media: [],
            containerQueries: [],
          });
        const matches = Array.isArray(matched.matchedCSSRules)
          ? matched.matchedCSSRules
          : [];
        const ruleLimit = 20 - rules.length;
        if (matches.length > ruleLimit) truncated = true;
        for (const match of matches.slice(0, ruleLimit)) {
          if (!object(match) || !object(match.rule)) continue;
          const rule = match.rule;
          if (!object(rule.selectorList) || !text(rule.selectorList.text, 2048))
            continue;
          const style: Record<string, unknown> = object(rule.style)
            ? rule.style
            : {};
          const url =
            typeof rule.styleSheetId === "string"
              ? sheets.get(rule.styleSheetId)
              : undefined;
          const firstSelector: unknown = Array.isArray(
            rule.selectorList.selectors,
          )
            ? rule.selectorList.selectors[0]
            : undefined;
          const range =
            object(firstSelector) && object(firstSelector.range)
              ? firstSelector.range
              : style.range;
          const source =
            url &&
            object(range) &&
            typeof range.startLine === "number" &&
            typeof range.startColumn === "number" &&
            Number.isSafeInteger(range.startLine) &&
            Number.isSafeInteger(range.startColumn)
              ? { url, line: range.startLine, column: range.startColumn }
              : undefined;
          rules.push({
            selector: rule.selectorList.text,
            origin:
              typeof rule.origin === "string" &&
              ["regular", "injected", "inspector", "user-agent"].includes(
                rule.origin,
              )
                ? rule.origin
                : "unknown",
            ...(source ? { source } : {}),
            sourceStatus: source ? "available" : "unavailable",
            ...properties(style),
            media: queries(rule.media),
            containerQueries: queries(rule.containerQueries, true),
          });
        }
        pending.push({ ...node, status: "available", rules });
      } catch {
        pending.push({
          ...node,
          status: "unavailable",
          detail:
            "Selector was not queryable, no longer matched, or the bounded protocol request failed.",
          rules: [],
        });
        if (Date.now() >= deadline) {
          truncated = true;
          break;
        }
      }
    }
    // Resolve only referenced numeric/color variable candidates across the captured graph.
    // These are matched definitions, not an inheritance/cascade winner computation.
    for (let depth = 0; depth < 4; depth++) {
      const needed = new Set(dependencies);
      for (const node of pending)
        for (const rule of node.rules) {
          for (const property of rule.customProperties) {
            if (
              !needed.has(property.name) ||
              rule.properties.includes(property)
            )
              continue;
            if (rule.properties.length >= 40) {
              truncated = true;
              continue;
            }
            rule.properties.push(property);
            reference(property.value);
          }
        }
      if (dependencies.size === needed.size) break;
      if (depth === 3) truncated = true;
    }
    const collected: CssNode[] = [];
    let bytes = 0;
    for (const node of pending) {
      const entry: CssNode = {
        ...node,
        rules: node.rules.flatMap(({ customProperties: _custom, ...rule }) =>
          rule.properties.length ? [rule] : [],
        ),
      };
      const entryBytes = Buffer.byteLength(JSON.stringify(entry));
      if (bytes + entryBytes > 110 * 1024) {
        truncated = true;
        break;
      }
      bytes += entryBytes;
      collected.push(entry);
    }
    const unqueriedNodeIds = nodes
      .filter((node) => !pending.some((entry) => entry.id === node.id))
      .map((node) => node.id);
    const omittedNodeIds = pending
      .filter((node) => !collected.some((entry) => entry.id === node.id))
      .map((node) => node.id);
    return {
      ...part,
      data: JSON.stringify({
        version: 1,
        nodes: collected,
        unqueriedNodeIds,
        omittedNodeIds,
        limits: {
          nodes: 12,
          rulesPerNode: 20,
          propertiesPerRule: 40,
          customCandidatesPerRule: 40,
          referencedVariables: 32,
          variableDepth: 4,
          bytes: MAX_JSON,
          deadlineMs: 1500,
        },
        exclusions: [
          "Matched rules and referenced custom-property definitions are candidates, not winning-cascade or inheritance calculations.",
          "Inline declarations have origin=inline and unavailable stylesheet source coordinates.",
          "Pseudo-elements, cross-origin frames and shadow roots are not queried.",
          "CSS and screenshot collection are bounded but non-atomic; live DOM may change.",
          "Source coordinates are zero-based CDP coordinates; missing stylesheet URLs are unavailable.",
          "Only referenced safe numeric/color custom properties are retained; URLs/content and arbitrary string custom properties are excluded.",
          "Media activation is retained only when CDP reports it; unknown container activation is never inferred.",
          "unqueriedNodeIds identifies node/time omissions; omittedNodeIds identifies byte-bound omissions.",
        ],
      }),
      truncated,
      detail:
        "Bounded capture-time matched rules and inline declarations, not winning declarations. Live CDP collection is non-atomic with the screenshot.",
    };
  } catch {
    return {
      ...part,
      status: "unavailable",
      detail:
        "CSS provenance protocol support or its bounded capture-time query was unavailable.",
    };
  } finally {
    off();
    // Re-enabling next capture replays stylesheet headers, including their provenance URLs.
    await boundedRequest(cdp.send("CSS.disable", {}, session), 100).catch(
      () => {},
    );
  }
}
