export const CONTEXT_QUERY_KEYS = [
  "select",
  "selector",
  "property",
  "since",
  "until",
] as const;

export type ContextQuery = Partial<
  Record<(typeof CONTEXT_QUERY_KEYS)[number], string>
>;

export class ContextQueryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown, label: string): number {
  const match =
    typeof value === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match)
    throw new ContextQueryError(
      `${label} must be an ISO timestamp with a timezone.`,
    );
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const parsed = Date.parse(value as string);
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > days[m - 1]! ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== "Z" &&
      (Number(zone!.slice(1, 3)) > 23 || Number(zone!.slice(4)) > 59)) ||
    !Number.isFinite(parsed)
  )
    throw new ContextQueryError(`${label} must be a valid ISO timestamp.`);
  return parsed;
}

function pointer(value: unknown, select: string): unknown {
  if (select === "") return value;
  if (!select.startsWith("/") || /~(?:[^01]|$)/.test(select))
    throw new ContextQueryError(
      "select must be a JSON Pointer with only ~0 and ~1 escapes.",
    );
  for (const encoded of select.slice(1).split("/")) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (
      (!object(value) && !Array.isArray(value)) ||
      !Object.hasOwn(value, key) ||
      (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
    )
      throw new ContextQueryError(
        `JSON Pointer does not exist in the selected view: ${select}.`,
        404,
      );
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function filterNodes(value: unknown, query: ContextQuery): unknown {
  if (!object(value) || !Array.isArray(value.nodes))
    throw new ContextQueryError(
      "selector/property filters require a JSON object with a nodes array.",
    );
  const nodes: Record<string, unknown>[] = [];
  for (const node of value.nodes) {
    if (!object(node))
      throw new ContextQueryError("Every filtered node must be a JSON object.");
    if (
      query.selector !== undefined &&
      (typeof node.selector !== "string" ||
        (node.targets !== undefined &&
          (!Array.isArray(node.targets) ||
            !node.targets.every((target) => typeof target === "string"))))
    )
      throw new ContextQueryError(
        "selector requires node.selector strings and optional node.targets string arrays.",
      );
    let projected = node;
    if (query.property !== undefined) {
      if (!Object.hasOwn(node, "styles") && !Object.hasOwn(node, "rules"))
        throw new ContextQueryError(
          "property requires node.styles or node.rules properties.",
        );
      projected = { ...node };
      if (Object.hasOwn(node, "styles")) {
        if (
          !object(node.styles) ||
          !Object.values(node.styles).every(
            (entry) => typeof entry === "string",
          )
        )
          throw new ContextQueryError(
            "property requires node.styles to contain CSS string values.",
          );
        projected.styles = Object.hasOwn(node.styles, query.property)
          ? { [query.property]: node.styles[query.property] }
          : {};
      }
      if (Object.hasOwn(node, "rules")) {
        if (!Array.isArray(node.rules))
          throw new ContextQueryError(
            "property requires node.rules to be an array.",
          );
        projected.rules = node.rules.flatMap((rule) => {
          if (
            !object(rule) ||
            !Array.isArray(rule.properties) ||
            !rule.properties.every(
              (entry) =>
                object(entry) &&
                typeof entry.name === "string" &&
                typeof entry.value === "string",
            )
          )
            throw new ContextQueryError(
              "property requires rule.properties with CSS name/value strings.",
            );
          const properties = rule.properties.filter(
            (entry) => entry.name === query.property,
          );
          return properties.length ? [{ ...rule, properties }] : [];
        });
      }
    }
    if (
      query.selector === undefined ||
      node.selector === query.selector ||
      (Array.isArray(node.targets) && node.targets.includes(query.selector))
    )
      nodes.push(projected);
  }
  return { ...value, nodes };
}

/** Project only verified saved bytes. Pagination must run on the returned bytes. */
export function projectContext(
  bytes: Uint8Array,
  type: string,
  query: ContextQuery = {},
) {
  const applied: ContextQuery = {};
  for (const key of CONTEXT_QUERY_KEYS) {
    if (query[key] !== undefined) {
      if (typeof query[key] !== "string")
        throw new ContextQueryError(`${key} must be a string.`);
      applied[key] = query[key];
    }
  }
  if (!Object.keys(applied).length) return { bytes };
  if (type !== "application/json")
    throw new ContextQueryError(
      "Context filters require an application/json part, not text or binary.",
      415,
    );
  if (applied.selector !== undefined && !applied.selector.length)
    throw new ContextQueryError(
      "selector must be an exact non-empty capture selector.",
    );
  if (
    applied.property !== undefined &&
    !/^(?:--[A-Za-z0-9_-]+|-?[a-z][a-z0-9-]*)$/.test(applied.property)
  )
    throw new ContextQueryError("property must be a CSS property name.");
  const since =
    applied.since === undefined ? undefined : timestamp(applied.since, "since");
  const until =
    applied.until === undefined ? undefined : timestamp(applied.until, "until");
  if (since !== undefined && until !== undefined && since > until)
    throw new ContextQueryError("since must not be later than until.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ContextQueryError("Context filters require valid UTF-8 JSON.");
  }
  if (applied.selector !== undefined || applied.property !== undefined)
    value = filterNodes(value, applied);
  if (since !== undefined || until !== undefined) {
    if (!object(value) || !Array.isArray(value.events))
      throw new ContextQueryError(
        "since/until filters require a JSON object with an events array.",
      );
    const events = value.events.filter((event) => {
      if (!object(event))
        throw new ContextQueryError(
          "Every filtered event must be a JSON object.",
        );
      const at = timestamp(event.at, "events.at");
      return (
        (since === undefined || at >= since) &&
        (until === undefined || at <= until)
      );
    });
    value = { ...value, events };
  }
  if (applied.select !== undefined) value = pointer(value, applied.select);
  return {
    bytes: new TextEncoder().encode(JSON.stringify(value, null, 2)),
    projection: {
      ...applied,
      order: "filters-then-select",
      timeBounds: "inclusive",
      offsets: "UTF-8 bytes of the projected JSON, not the saved part",
    },
  };
}
