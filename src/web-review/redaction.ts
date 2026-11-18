import { PNG } from "pngjs";
import { redactionRegions, type RedactionRect } from "../shared/redaction.ts";
import type { WebCapture } from "../shared/web-review.ts";

function viewportPng(bytes: Uint8Array, viewport: WebCapture["viewport"]) {
  if (
    bytes.length < 24 ||
    bytes.length > 64 * 1024 * 1024 ||
    Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("Invalid screenshot PNG.");
  redactionRegions([], viewport);
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.readUInt32BE(16),
    height = header.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width * height > 64_000_000 ||
    Math.abs(width - viewport.width * viewport.dpr) > 1 ||
    Math.abs(height - viewport.height * viewport.dpr) > 1
  )
    throw new Error(
      "Screenshot dimensions do not match the redaction viewport and DPR.",
    );
  const png = PNG.sync.read(header, { checkCRC: true });
  if (png.width !== width || png.height !== height)
    throw new Error("Invalid screenshot dimensions.");
  return png;
}

/** Decode and freshly encode pixels only: no original IDAT, text, EXIF or editable masks survive. */
export function redactScreenshot(
  bytes: Uint8Array,
  viewport: WebCapture["viewport"],
  masks: RedactionRect[],
): Buffer {
  const regions = redactionRegions(masks, viewport);
  if (!regions.length)
    throw new Error("At least one pre-capture redaction is required.");
  const png = viewportPng(bytes, viewport);
  const sx = png.width / viewport.width,
    sy = png.height / viewport.height;
  for (const r of regions) {
    const left = Math.floor(r.x * sx),
      top = Math.floor(r.y * sy);
    const right = Math.min(png.width, Math.ceil((r.x + r.width) * sx));
    const bottom = Math.min(png.height, Math.ceil((r.y + r.height) * sy));
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) {
        const at = (y * png.width + x) * 4;
        png.data[at] = png.data[at + 1] = png.data[at + 2] = 0;
        png.data[at + 3] = 255;
      }
  }
  const sanitized = new PNG();
  sanitized.width = png.width;
  sanitized.height = png.height;
  sanitized.data = png.data;
  return PNG.sync.write(sanitized);
}

/** Crop the captured frame after any privacy masks have been applied. */
export function cropScreenshot(
  bytes: Uint8Array,
  viewport: WebCapture["viewport"],
  rect: RedactionRect,
): Buffer {
  const png = viewportPng(bytes, viewport);
  const clipped = {
    x: rect.x,
    y: rect.y,
    width: Math.min(rect.width, viewport.width - rect.x),
    height: Math.min(rect.height, viewport.height - rect.y),
  };
  redactionRegions([clipped], viewport);
  const sx = png.width / viewport.width,
    sy = png.height / viewport.height;
  const left = Math.floor(clipped.x * sx),
    top = Math.floor(clipped.y * sy);
  const width =
    Math.min(png.width, Math.ceil((clipped.x + clipped.width) * sx)) - left;
  const height =
    Math.min(png.height, Math.ceil((clipped.y + clipped.height) * sy)) - top;
  const crop = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    png.data.copy(
      crop.data,
      y * width * 4,
      ((top + y) * png.width + left) * 4,
      ((top + y) * png.width + left + width) * 4,
    );
  return PNG.sync.write(crop);
}
