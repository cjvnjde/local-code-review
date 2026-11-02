import type { DiffFile, DiffRow } from "../src/shared/review-types.ts";

export const SHOWCASE_RANGE = "development UI showcase";
export const SHOWCASE_CONTEXT = 5;

const files: DiffFile[] = [
  {
    path: "src/demo/review-flow.ts",
    status: "modified",
    added: 2,
    removed: 2,
    hash: "showcase-review-flow",
    rows: [
      {
        t: "hunk",
        text: "@@ -8,3 +8,3 @@ export function review(change: Change) {",
        head: " export function review(change: Change) {",
      },
      { t: "ctx", o: 8, n: 8, text: "  const draft = capture(change);" },
      { t: "del", o: 9, text: "  return save(draft);" },
      { t: "add", n: 9, text: "  return submit(draft);" },
      { t: "ctx", o: 10, n: 10, text: "}" },
      {
        t: "hunk",
        text: "@@ -40,7 +40,7 @@ function submit(draft: Draft) {",
        head: " function submit(draft: Draft) {",
      },
      { t: "ctx", o: 40, n: 40, text: "  if (!draft.body) return;" },
      { t: "del", o: 41, text: '  queue.push({ kind: "note", draft });' },
      { t: "add", n: 41, text: '  queue.push({ kind: "review", draft });' },
      { t: "ctx", o: 42, n: 42, text: "  announce(draft);" },
      { t: "ctx", o: 43, n: 43, text: "  persist(draft);" },
      { t: "ctx", o: 44, n: 44, text: "  refresh();" },
      { t: "ctx", o: 45, n: 45, text: "  focusNext();" },
      { t: "ctx", o: 46, n: 46, text: "}" },
    ],
  },
  {
    path: "src/demo/new-note.ts",
    status: "added",
    added: 7,
    removed: 0,
    hash: "showcase-new-note",
    rows: [
      { t: "hunk", text: "@@ -0,0 +1,7 @@" },
      { t: "add", n: 1, text: "export interface Note {" },
      { t: "add", n: 2, text: "  id: string;" },
      { t: "add", n: 3, text: "  body: string;" },
      { t: "add", n: 4, text: '  status: "pending" | "applied";' },
      { t: "add", n: 5, text: "}" },
      { t: "add", n: 6, text: "" },
      { t: "add", n: 7, text: "export const notes: Note[] = [];" },
    ],
  },
  {
    path: "src/demo/legacy-adapter.ts",
    status: "deleted",
    added: 0,
    removed: 6,
    hash: "showcase-legacy-adapter",
    rows: [
      { t: "hunk", text: "@@ -1,6 +0,0 @@" },
      { t: "del", o: 1, text: 'import { bridge } from "./bridge.ts";' },
      { t: "del", o: 2, text: "" },
      { t: "del", o: 3, text: "export function legacyAdapter() {" },
      { t: "del", o: 4, text: '  return bridge("legacy");' },
      { t: "del", o: 5, text: "}" },
      { t: "del", o: 6, text: "" },
    ],
  },
  {
    path: "src/demo/current-name.ts",
    from: "src/demo/previous-name.ts",
    status: "renamed",
    added: 0,
    removed: 0,
    hash: "showcase-renamed-file",
    rows: [],
  },
  {
    path: "assets/review-mark.svg",
    status: "modified",
    added: 1,
    removed: 1,
    hash: "showcase-review-mark",
    rows: [
      { t: "hunk", text: "@@ -1,3 +1,3 @@" },
      {
        t: "ctx",
        o: 1,
        n: 1,
        text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120">',
      },
      {
        t: "del",
        o: 2,
        text: '  <circle cx="88" cy="60" r="34" fill="#8aadf4"/>',
      },
      {
        t: "add",
        n: 2,
        text: '  <circle cx="152" cy="60" r="42" fill="#a6da95"/>',
      },
      { t: "ctx", o: 3, n: 3, text: "</svg>" },
    ],
  },
  {
    path: "assets/new-preview.svg",
    status: "added",
    added: 0,
    removed: 0,
    binary: true,
    hash: "showcase-new-preview",
    rows: [],
  },
  {
    path: "audio/review-ready.wav",
    status: "modified",
    added: 0,
    removed: 0,
    binary: true,
    hash: "showcase-review-ready",
    rows: [],
  },
  {
    path: "fixtures/archive.bin",
    status: "modified",
    added: 0,
    removed: 0,
    binary: true,
    hash: "showcase-archive",
    rows: [],
  },
];

const context: Record<string, Record<number, string>> = {
  "src/demo/review-flow.ts": Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => {
      const line = index + 1;
      return [line, `// unchanged example line ${line}`];
    }),
  ),
};

const encoder = new TextEncoder();
const media: Record<string, Uint8Array> = {
  "old:assets/review-mark.svg": encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="240" height="120" rx="18" fill="#24273a"/><circle cx="88" cy="60" r="34" fill="#8aadf4"/></svg>',
  ),
  "new:assets/review-mark.svg": encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="240" height="120" rx="18" fill="#24273a"/><circle cx="152" cy="60" r="42" fill="#a6da95"/></svg>',
  ),
  "new:assets/new-preview.svg": encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><rect width="320" height="160" rx="20" fill="#24273a"/><path d="M30 125 105 45l55 58 42-44 88 66Z" fill="#c6a0f6"/><circle cx="260" cy="42" r="18" fill="#eed49f"/></svg>',
  ),
  "old:audio/review-ready.wav": tone(330),
  "new:audio/review-ready.wav": tone(523),
};

/** Fresh objects keep browser-side context expansion from changing the next API response. */
export function showcaseDiff(): DiffFile[] {
  return structuredClone(files);
}

export function showcaseContext(
  path: string,
  start: number,
  end: number,
): DiffRow[] {
  const lines = context[path];
  if (!lines) return [];
  const rows: DiffRow[] = [];
  for (let line = start; line <= end; line++) {
    const text = lines[line];
    if (text !== undefined) rows.push({ t: "ctx", o: line, n: line, text });
  }
  return rows;
}

export function showcaseBlob(
  side: "old" | "new",
  path: string,
): Uint8Array | null {
  return media[`${side}:${path}`] ?? null;
}

/** Small valid PCM samples make both native audio players inspectable without fixture files. */
function tone(frequency: number): Uint8Array {
  const rate = 8_000;
  const samples = 1_600;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((char, index) =>
      view.setUint8(at + index, char.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) {
    const sample = Math.sin((index * frequency * Math.PI * 2) / rate);
    view.setInt16(44 + index * 2, Math.round(sample * 5_000), true);
  }
  return bytes;
}
