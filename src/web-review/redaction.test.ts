import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { redactScreenshot, cropScreenshot } from "./redaction.ts";
import {
  privateCapture,
  redactionRegions,
  REDACTION_OMISSION,
} from "../shared/redaction.ts";
import {
  compactWebCapture,
  webCapture,
  type WebCapture,
} from "../shared/web-review.ts";
import { saveAttachment } from "../review/attach.ts";
import { saveWebContext } from "../review/web-context.ts";
import { readContext, readContextPart } from "../review/context.ts";

const viewport = { width: 4, height: 3, dpr: 2 };
const region = { x: 1.25, y: 0.25, width: 1.25, height: 1.25 };
function source() {
  const png = new PNG({ width: 8, height: 6 });
  for (let i = 0; i < png.data.length; i += 4)
    png.data.set([197, 83, 41, 71], i);
  return PNG.sync.write(png);
}

test("redaction covers fractional CSS edges at DPR, destroys underlying RGB and alpha, and crops only sanitized pixels", () => {
  const original = source();
  const bytes = redactScreenshot(original, viewport, [region]);
  const decoded = PNG.sync.read(bytes);
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 8; x++) {
      expect([
        ...decoded.data.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4),
      ]).toEqual(x >= 2 && x < 5 && y < 3 ? [0, 0, 0, 255] : [197, 83, 41, 71]);
    }
  expect(bytes.equals(original)).toBe(false);
  const crop = PNG.sync.read(cropScreenshot(bytes, viewport, region));
  expect([crop.width, crop.height]).toEqual([3, 3]);
  for (let i = 0; i < crop.data.length; i += 4)
    expect([...crop.data.subarray(i, i + 4)]).toEqual([0, 0, 0, 255]);
  expect([...PNG.sync.read(original).data.subarray(0, 4)]).toEqual([
    197, 83, 41, 71,
  ]);
});

test("invalid masks, oversized dimensions and mismatched DPR fail closed", () => {
  for (const invalid of [
    null,
    {},
    [null],
    [{ ...region, x: -1 }],
    [{ ...region, width: NaN }],
    [{ ...region, height: 0 }],
    [{ ...region, x: 4 }],
    Array(101).fill(region),
  ])
    expect(() => redactionRegions(invalid, viewport)).toThrow();
  expect(() =>
    redactScreenshot(source(), { ...viewport, dpr: 1 }, [region]),
  ).toThrow("dimensions");
  expect(() =>
    redactScreenshot(source(), { ...viewport, dpr: Infinity }, [region]),
  ).toThrow();
  expect(() =>
    redactScreenshot(Buffer.from("not png"), viewport, [region]),
  ).toThrow();
  expect(() => redactScreenshot(source(), viewport, [])).toThrow();
  const forged = Buffer.from(source());
  forged.writeUInt32BE(100_000, 16);
  expect(() => redactScreenshot(forged, viewport, [region])).toThrow(
    "dimensions",
  );
});

test("only masked PNGs and explicitly omitted context reach disk; compact captures retain privacy provenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-private-capture-"));
  try {
    const masks = [{ x: 0, y: 0, width: 4, height: 3 }];
    const masked = redactScreenshot(source(), viewport, masks);
    const page =
      "images/" + (await saveAttachment(root, ".review", masked, "image/png"));
    const area =
      "images/" +
      (await saveAttachment(
        root,
        ".review",
        cropScreenshot(masked, viewport, region),
        "image/png",
      ));
    const raw: WebCapture = {
      url: "http://localhost:3000/SECRET?token=SECRET#SECRET",
      title: "SECRET",
      at: "2026-11-15T00:00:00.000Z",
      mode: "area",
      rect: region,
      viewport,
      scroll: { x: 0, y: 0 },
      page,
      area,
      selector: "#SECRET",
      element: {
        tag: "p",
        text: "SECRET",
        attributes: { title: "SECRET" },
        styles: { content: "SECRET" },
      },
      components: [{ framework: "React", name: "SECRET" }],
    };
    const safe = privateCapture(raw, masks);
    const capture = await saveWebContext(
      root,
      ".review",
      safe,
      [
        "selected-html",
        "diagnostics",
        "layout",
        "environment",
        "css-rules",
        "interactions",
        "full-page",
      ].map((name) => ({
        name,
        label: name,
        type: "text/plain",
        data: "SECRET",
      })),
    );
    expect(webCapture(compactWebCapture(capture))?.redaction).toEqual({
      regions: masks,
      omissionReason: REDACTION_OMISSION,
    });
    const manifest = await readContext(root, ".review", capture.context!.id);
    expect(manifest).not.toBeNull();
    for (const part of manifest!.parts) {
      if (!["capture", "viewport", "selected-area"].includes(part.name)) {
        expect(part.status).toBe("excluded");
        expect(part.detail).toBe(REDACTION_OMISSION);
        expect(
          await readContextPart(
            root,
            ".review",
            capture.context!.id,
            part.name,
          ),
        ).toBeNull();
      }
    }
    for (const file of await readdir(path.join(root, ".review"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!file.isFile()) continue;
      const bytes = await readFile(path.join(file.parentPath, file.name));
      expect(bytes.includes(Buffer.from("SECRET"))).toBe(false);
      if (file.name.endsWith(".png")) {
        expect(bytes.equals(source())).toBe(false);
        const png = PNG.sync.read(bytes);
        for (let i = 0; i < png.data.length; i += 4)
          expect([...png.data.subarray(i, i + 4)]).toEqual([0, 0, 0, 255]);
      }
    }
    expect(
      webCapture({ ...safe, redaction: { regions: [{ ...region, x: -1 }] } }),
    ).toBeNull();
    expect(privateCapture(raw, [])).toBe(raw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
