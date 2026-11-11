export function attachmentSrc(url: string) {
  const raw = url.trim().replace(/^\.\//, "");
  if (
    !/^(?:(?:images|assets)\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|apng)$/i.test(
      raw,
    )
  )
    return "";
  return `/api/attachment?ref=${encodeURIComponent(raw)}`;
}
export async function uploadImage(blob: Blob): Promise<string> {
  const response = await fetch("/api/attach", {
    method: "POST",
    headers: { "content-type": blob.type },
    body: blob,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Image upload failed.");
  if (!attachmentSrc(result.ref || ""))
    throw new Error("The uploaded image has no valid attachment reference.");
  return result.ref;
}
export interface ImageToken {
  ref: string;
  label: string;
  from: number;
  to: number;
}
export function imageTokens(body: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  // The Markdown parser owns display; this bounded scanner owns editable image URLs in the source.
  const image = /!\[([^\]\n]*)\]\(<?([^\s<>]+)>?(?:\s+"[^"\n]*")?\)/g;
  let fence = "";
  let offset = 0;
  for (const line of body.split("\n")) {
    const delimiter = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) fence = delimiter[1]!;
      else if (
        delimiter[1]![0] === fence[0] &&
        delimiter[1]!.length >= fence.length &&
        !delimiter[2]!.trim()
      )
        fence = "";
    } else if (!fence) {
      for (const match of line.matchAll(image)) {
        const inlineCode = [...line.matchAll(/(`+)[\s\S]*?\1(?!`)/g)].some(
          (span) =>
            match.index! >= span.index! &&
            match.index! < span.index! + span[0].length,
        );
        if (
          !attachmentSrc(match[2]!) ||
          inlineCode ||
          /^(?: {4}|\t)/.test(line) ||
          (line.slice(0, match.index).match(/\\+$/)?.[0].length ?? 0) % 2
        )
          continue;
        const start =
          offset +
          match.index! +
          match[0].indexOf("](") +
          2 +
          (match[0].includes("](<") ? 1 : 0);
        tokens.push({
          ref: match[2]!,
          label: match[1] || "Attachment",
          from: start,
          to: start + match[2]!.length,
        });
      }
    }
    offset += line.length + 1;
  }
  return tokens;
}
