import {
  converter,
  modeRgb,
  modeHwb,
  modeLab,
  modeLch,
  modeOklab,
  modeOklch,
  modeP3,
  parse,
  useMode as registerMode,
} from "culori/fn";

for (const mode of [
  modeRgb,
  modeHwb,
  modeLab,
  modeLch,
  modeOklab,
  modeOklch,
  modeP3,
])
  registerMode(mode);
const toRgb = converter("rgb");

export interface ColorLiteral {
  from: number;
  to: number;
  value: string;
  /** Clipped sRGB preview, not a replacement for the original color space. */
  hex: string;
  css: string;
  outOfGamut: boolean;
  modern: boolean;
}

const NUMBER = /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?(%?)$/i;
const ANGLE =
  /^([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i;
const clamp = (n: number, max = 1) => Math.max(0, Math.min(max, n));
const byte = (n: number) =>
  Math.round(clamp(n, 255)).toString(16).padStart(2, "0");
function number(value: string, scale: number, none: boolean): number | null {
  if (none && value === "none") return 0;
  const match = NUMBER.exec(value);
  if (!match) return null;
  const n = Number(match[1] ? value.slice(0, -1) : value);
  return Number.isFinite(n) ? (match[1] ? (n * scale) / 100 : n) : null;
}

/** CSS literal syntax only: no named colors, variables, URLs, calc(), or arbitrary style text. */
function parseLegacyColor(value: string): string | null {
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const body = hex[1]!.toLowerCase();
    return (
      "#" + (body.length < 5 ? [...body].map((c) => c + c).join("") : body)
    );
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/i.exec(value);
  if (!fn) return null;
  const body = fn[2]!.trim().toLowerCase(),
    legacy = body.includes(",");
  let parts: string[], alpha: string | undefined;
  if (legacy) {
    if (body.includes("/")) return null;
    parts = body.split(",").map((p) => p.trim());
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const split = body.split("/");
    if (split.length > 2) return null;
    parts = split[0]!.trim().split(/\s+/);
    if (split.length === 2) alpha = split[1]!.trim();
  }
  if (parts.length !== 3) return null;
  const opacity = alpha === undefined ? 1 : number(alpha, 1, !legacy);
  if (opacity === null) return null;
  let rgb: number[];
  if (fn[1]!.toLowerCase().startsWith("rgb")) {
    if (
      legacy &&
      parts.some((p) => p.endsWith("%")) &&
      !parts.every((p) => p.endsWith("%"))
    )
      return null;
    const channels = parts.map((p) => number(p, 255, !legacy));
    if (channels.some((n) => n === null)) return null;
    rgb = channels as number[];
  } else {
    const angle = ANGLE.exec(parts[0]!);
    if (!angle && (legacy || parts[0] !== "none")) return null;
    const hue = angle ? Number(angle[1]) : 0;
    if (!Number.isFinite(hue)) return null;
    const unit = angle?.[2]?.toLowerCase();
    const period =
      unit === "grad"
        ? 400
        : unit === "rad"
          ? 2 * Math.PI
          : unit === "turn"
            ? 1
            : 360;
    const degrees = ((hue % period) / period) * 360;
    if (
      parts.slice(1).some((p) => !p.endsWith("%") && (legacy || p !== "none"))
    )
      return null;
    const s = number(parts[1]!, 1, !legacy),
      l = number(parts[2]!, 1, !legacy);
    if (s === null || l === null) return null;
    const saturation = clamp(s),
      light = clamp(l),
      h = (((degrees % 360) + 360) % 360) / 30;
    const a = saturation * Math.min(light, 1 - light);
    rgb = [0, 8, 4].map((n) => {
      const k = (n + h) % 12;
      return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    });
  }
  return (
    "#" +
    rgb.map(byte).join("") +
    (alpha === undefined ? "" : byte(clamp(opacity) * 255))
  );
}
export interface ColorPreview {
  hex: string;
  css: string;
  outOfGamut: boolean;
  modern: boolean;
}

/** Restrict input before Culori parsing: never accept CSS expressions or custom profiles. */
export function colorPreview(value: string): ColorPreview | null {
  const legacy = parseLegacyColor(value);
  if (legacy)
    return { hex: legacy, css: value, outOfGamut: false, modern: false };
  const fn = /^(oklch|oklab|lab|lch|hwb|color)\(([^()]*)\)$/i.exec(value);
  if (!fn) return null;
  const name = fn[1]!.toLowerCase();
  let body = fn[2]!.trim().toLowerCase();
  if (name === "color") {
    if (!/^display-p3\s/.test(body)) return null;
    body = body.replace(/^display-p3\s+/, "");
  }
  const split = body.split("/");
  if (split.length > 2) return null;
  const channels = split[0]!.trim().split(/\s+/);
  if (channels.length !== 3) return null;
  const hueIndex =
    name === "hwb" ? 0 : name === "lch" || name === "oklch" ? 2 : -1;
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i]!;
    if (channel === "none") continue;
    if (i === hueIndex) {
      const angle = ANGLE.exec(channel);
      if (!angle || !Number.isFinite(Number(angle[1]))) return null;
    } else if (number(channel, 1, false) === null) return null;
  }
  if (
    name === "hwb" &&
    channels.slice(1).some((v) => v !== "none" && !v.endsWith("%"))
  )
    return null;
  if (split.length === 2 && number(split[1]!.trim(), 1, true) === null)
    return null;
  // Missing CSS channels resolve to zero for a standalone swatch, not interpolation.
  const parsed = parse(value.toLowerCase().replace(/\bnone\b/g, "0"));
  if (!parsed) return null;
  if (
    Object.values(parsed).some(
      (n) => typeof n === "number" && !Number.isFinite(n),
    )
  )
    return null;
  const rgb = toRgb(parsed);
  if (!rgb || ![rgb.r, rgb.g, rgb.b, rgb.alpha ?? 1].every(Number.isFinite))
    return null;
  const outOfGamut = [rgb.r, rgb.g, rgb.b].some(
    (n) => n < -0.00001 || n > 1.00001,
  );
  return {
    hex:
      "#" +
      [rgb.r, rgb.g, rgb.b].map((n) => byte(n * 255)).join("") +
      (split.length === 2 ? byte(clamp(rgb.alpha ?? 1) * 255) : ""),
    css: value,
    outOfGamut,
    modern: true,
  };
}

/** Validates a literal and returns its (possibly gamut-clipped) sRGB preview. */
export function parseColor(value: string): string | null {
  return colorPreview(value)?.hex ?? null;
}

/** An opacity edit must not silently convert a modern color to sRGB. */
export function colorWithAlpha(value: string, alpha: number): string | null {
  const preview = colorPreview(value);
  if (!preview || !Number.isFinite(alpha) || alpha < 0 || alpha > 1)
    return null;
  if (!preview.modern) return preview.hex.slice(0, 7) + byte(alpha * 255);
  return (
    value.slice(0, value.indexOf("(") + 1) +
    value
      .slice(value.indexOf("(") + 1, -1)
      .split("/")[0]!
      .trim() +
    ` / ${Number(alpha.toFixed(4))})`
  );
}

/** Offsets refer to the unmodified input, including fenced code and Markdown punctuation. */
export function findColors(source: string): ColorLiteral[] {
  const result: ColorLiteral[] = [];
  const candidates =
    /#[\da-z]+|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = candidates.exec(source))) {
    const from = match.index,
      to = from + match[0].length;
    // Do not mistake identifiers, URL fragments or longer malformed hex strings for colors.
    if (
      /[\p{L}\p{N}_/#\\-]/u.test(source[from - 1] || "") ||
      /[\p{L}\p{N}_-]/u.test(source[to] || "")
    )
      continue;
    const prefix = source.slice(0, from);
    if (
      /(?:https?:\/\/|mailto:|lcr:)[^\s<>`]*$/i.test(prefix) ||
      /\]\([ \t]*<?[^\s)]*$/.test(prefix) ||
      /url\([ \t]*["']?$/i.test(prefix)
    )
      continue;
    const preview = colorPreview(match[0]);
    if (preview) result.push({ from, to, value: match[0], ...preview });
  }
  return result;
}

/** Refuse stale offsets: another action may have changed the draft while a picker was open. */
export function replaceColor(
  source: string,
  target: Pick<ColorLiteral, "from" | "to" | "value">,
  value: string,
) {
  if (
    !parseColor(value) ||
    (target.value !== "" && !parseColor(target.value)) ||
    !Number.isInteger(target.from) ||
    !Number.isInteger(target.to) ||
    target.from < 0 ||
    target.to < target.from ||
    target.to > source.length ||
    source.slice(target.from, target.to) !== target.value
  )
    return null;
  const head = source.slice(0, target.from),
    tail = source.slice(target.to);
  // An insert at a word boundary must remain a literal, not become "#abcword" or "word#abc".
  const lead =
    target.value === "" && /[\p{L}\p{N}_/#\\-]$/u.test(head) ? " " : "";
  const trail =
    target.value === "" && /^[\p{L}\p{N}_#-]/u.test(tail) ? " " : "";
  return {
    value: head + lead + value + trail + tail,
    from: target.from + lead.length,
    to: target.from + lead.length + value.length,
  };
}
