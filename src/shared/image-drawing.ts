import { webAnnotation, type WebAnnotation } from "./web-annotation.ts";

/** Editable marks travel inside the exported PNG, while Markdown stays an ordinary image link. */
export interface ImageDrawing {
  source: string;
  annotation: WebAnnotation;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// Private, ancillary, safe-to-copy PNG chunk. Browsers ignore it when displaying the image.
const CHUNK = "lcRa";
const MAX_METADATA = 4 * 1024 * 1024;
const SOURCE =
  /^(?:(?:images|assets)\/|\.\/)?[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|gif|webp|avif|bmp|svg|apng)$/i;

function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunks(bytes: Uint8Array) {
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: { type: string; start: number; end: number }[] = [];
  for (let start = 8; start + 12 <= bytes.length;) {
    const end = start + 12 + view.getUint32(start);
    if (end > bytes.length) throw new Error("The PNG image is incomplete.");
    const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
    result.push({ type, start, end });
    if (type === "IEND") return result;
    start = end;
  }
  throw new Error("The PNG image is incomplete.");
}

function drawing(value: unknown, image: string): ImageDrawing | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    typeof data.source !== "string" ||
    !SOURCE.test(data.source)
  )
    return null;
  const annotation = webAnnotation({
    ...(data.annotation as object),
    // The displayed file is authoritative; metadata cannot substitute another rendered image.
    image,
  });
  return annotation ? { source: data.source, annotation } : null;
}

/** null means an ordinary image. Damaged drawing data is an error, never silently flattened. */
export function decodeImageDrawing(
  bytes: Uint8Array,
  image: string,
): ImageDrawing | null {
  const chunk = chunks(bytes).find((item) => item.type === CHUNK);
  if (!chunk) return null;
  const { start, end } = chunk;
  if (end - start - 12 > MAX_METADATA)
    throw new Error("This image's drawing data is too large.");
  const expected = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(end - 4);
  if (crc(bytes.subarray(start + 4, end - 4)) !== expected)
    throw new Error("This image's drawing data is damaged.");
  try {
    const result = drawing(
      JSON.parse(new TextDecoder().decode(bytes.subarray(start + 8, end - 4))),
      image,
    );
    if (result) return result;
  } catch {}
  throw new Error("This image's drawing data is unsupported or damaged.");
}

/** Keep the rendered pixels and one validated editable record in the same immutable attachment. */
export function encodeImageDrawing(
  bytes: Uint8Array,
  value: ImageDrawing,
): Uint8Array {
  const data = drawing({ version: 1, ...value }, "images/annotation.png");
  if (!data) throw new Error("Invalid image drawing.");
  const list = chunks(bytes);
  if (!list.length) throw new Error("A drawing must be exported as PNG.");
  const { image: _, ...annotation } = data.annotation;
  const payload = new TextEncoder().encode(
    JSON.stringify({ version: 1, source: data.source, annotation }),
  );
  if (payload.length > MAX_METADATA)
    throw new Error("This drawing's editable data is too large.");
  const chunk = new Uint8Array(payload.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(new TextEncoder().encode(CHUNK), 4);
  chunk.set(payload, 8);
  view.setUint32(chunk.length - 4, crc(chunk.subarray(4, -4)));
  const parts = list.filter((item) => item.type !== CHUNK);
  const output = new Uint8Array(
    8 +
      parts.reduce((size, item) => size + item.end - item.start, 0) +
      chunk.length,
  );
  output.set(bytes.subarray(0, 8));
  let offset = 8;
  for (const item of parts) {
    if (item.type === "IEND") {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    output.set(bytes.subarray(item.start, item.end), offset);
    offset += item.end - item.start;
  }
  return output;
}
