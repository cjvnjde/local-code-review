import Fuse, { type Expression } from "fuse.js";
import { rowKey } from "../diff/model.ts";
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export type SearchKind = "file" | "code" | "note" | "reply";
export type SearchDocument = {
  kind: SearchKind;
  path: string;
  text: string;
  label: string;
  noteId?: string;
  row?: string;
  message?: number;
  context?: string;
  location?: string;
};
export type SearchResult = SearchDocument & { ranges: [number, number][] };

/** Search the read itself, including unmounted, hidden and folded rows, never the repository. */
export function searchDocuments(
  files: any[],
  notes: any[],
  messages: Map<string, any[]>,
  statuses: Map<string, any>,
) {
  const docs: SearchDocument[] = [];
  for (const f of files) {
    docs.push({
      kind: "file",
      path: f.path,
      text: f.from && f.from !== f.path ? f.from + " → " + f.path : f.path,
      label: "File",
    });
    f.rows.forEach((r: any, i: number) => {
      if (r.t === "hunk") return;
      let from = i,
        to = i + 1;
      while (from > Math.max(0, i - 2) && f.rows[from - 1].t !== "hunk") from--;
      while (to < Math.min(f.rows.length, i + 3) && f.rows[to].t !== "hunk")
        to++;
      const nearby = f.rows.slice(from, to);
      docs.push({
        kind: "code",
        path: f.path,
        text: r.text,
        row: rowKey(r),
        label:
          (r.t === "add" ? "Added" : r.t === "del" ? "Removed" : "Context") +
          " · " +
          (r.n != null ? "new " + r.n : "old " + r.o),
        context: nearby
          .map(
            (r: any) =>
              (r.t === "add" ? "+" : r.t === "del" ? "-" : " ") + r.text,
          )
          .join("\n"),
      });
    });
  }
  for (const n of notes) {
    const location =
      n.scope === "file" || n.a === "*"
        ? "whole file"
        : n.label ||
          (n.start
            ? n.start === n.end
              ? String(n.start)
              : n.start + "–" + n.end
            : "");
    const base = { path: n.file || "", noteId: n.id, location };
    docs.push({ ...base, kind: "note", text: n.body || "", label: "Note" });
    if (n.web)
      docs.push({
        ...base,
        kind: "note",
        text: JSON.stringify(n.web),
        label: "UI metadata",
      });
    if (n.code)
      docs.push({
        ...base,
        kind: "note",
        text: n.code,
        label: "Captured code",
      });
    const status = statuses.get(n.id);
    if (status)
      docs.push({
        ...base,
        kind: "note",
        text: [status.status, status.detail].filter(Boolean).join(" · "),
        label: "Status",
      });
    (messages.get(n.id) || []).forEach((m: any, i: number) => {
      docs.push({
        ...base,
        kind: "reply",
        text: m.body || "",
        label: m.role === "agent" ? "Agent answer" : "Reviewer reply",
        message: i,
      });
    });
  }
  return docs;
}

const words = (query: string) => [
  ...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean)),
];
/** Literal, case-insensitive terms. All terms must occur in the result or its filename. */
export function matchRanges(text: string, query: string): [number, number][] {
  // The i flag retains offsets in the original text, including Unicode case pairs of different length.
  const terms = words(query).map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  if (!terms.length) return [];
  const re = new RegExp(
    terms.sort((a, b) => b.length - a.length).join("|"),
    "gi",
  );
  return [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length]);
}
// Document arrays are immutable snapshots. Reuse Fuse's index across queries and
// release it with the snapshot when live review data changes.
const indexes = new WeakMap<SearchDocument[], Fuse<SearchDocument>>();

export function searchReview(
  docs: SearchDocument[],
  query: string,
): SearchResult[] {
  const terms = words(query);
  if (!terms.length) return [];
  const exact = docs.filter(
    (document) =>
      terms.every(
        (term) =>
          matchRanges(document.text + "\n" + document.path, term).length > 0,
      ) &&
      (document.kind === "file" ||
        matchRanges(document.text, query).length > 0),
  );
  let index = indexes.get(docs);
  if (!index) {
    index = new Fuse(docs, {
      keys: ["text", "path"],
      threshold: 0.25,
      ignoreLocation: true,
      ignoreFieldNorm: true,
      includeMatches: true,
      includeScore: true,
    });
    indexes.set(docs, index);
  }
  const exactSet = new Set(exact);
  const fuzzy = index.search({
    $and: terms.map((term): Expression => ({
      $or: [{ text: term }, { path: term }],
    })),
  });
  return [
    ...exact.map((document) => ({
      ...document,
      ranges: matchRanges(document.text, query),
    })),
    ...fuzzy
      .filter(({ item, matches }) => {
        if (exactSet.has(item)) return false;
        // Short queries remain literal rather than matching nearly every row.
        if (
          terms.some(
            (term) =>
              term.length < 4 &&
              !matchRanges(item.text + "\n" + item.path, term).length,
          )
        )
          return false;
        if (item.kind === "file") return true;
        // Filename-only hits must never expand into every code row or reply.
        if (terms.every((term) => matchRanges(item.path, term).length))
          return false;
        return matches?.some((match) => match.key === "text");
      })
      .map(({ item, matches }) => ({
        ...item,
        ranges: (matches || [])
          .filter((match) => match.key === "text")
          .flatMap((match) =>
            match.indices.map(([start, end]): [number, number] => [
              start,
              end + 1,
            ]),
          )
          .sort((a, b) => a[0] - b[0]),
      })),
  ];
}
/** Offsets in text joined from syntax/Markdown spans, mapped back to those spans for highlighting. */
export function searchSegments(parts: string[], query: string) {
  const edges: number[] = [];
  let length = 0;
  for (const part of parts) {
    edges.push(length);
    length += part.length;
  }
  const locate = (offset: number, end = false) => {
    let low = 0,
      high = parts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (edges[mid] < offset || (!end && edges[mid] === offset)) low = mid;
      else high = mid - 1;
    }
    return { part: low, offset: offset - edges[low] };
  };
  return parts.length
    ? matchRanges(parts.join(""), query).map(([a, b]) => ({
        start: locate(a),
        end: locate(b, true),
      }))
    : [];
}
export function searchHtml(text: string, query: string) {
  let from = 0,
    html = "";
  for (const [a, b] of matchRanges(text, query)) {
    html +=
      esc(text.slice(from, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>";
    from = b;
  }
  return html + esc(text.slice(from));
}
/** Keep the first match in view even when it is far into a long answer. */
export function searchExcerpt(
  text: string,
  query: string,
  size = 180,
  ranges = matchRanges(text, query),
) {
  const at = ranges[0]?.[0] || 0;
  const from = Math.max(0, at - Math.floor(size / 3)),
    to = Math.min(text.length, from + size);
  return (
    (from ? "…" : "") + text.slice(from, to) + (to < text.length ? "…" : "")
  );
}
