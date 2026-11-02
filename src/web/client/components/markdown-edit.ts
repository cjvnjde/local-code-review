export type MarkdownFormat = "bold" | "italic" | "code" | "block" | "link";

function backtickFence(text: string, minimum: number) {
  let length = minimum;
  for (const match of text.matchAll(/`+/g))
    length = Math.max(length, match[0].length + 1);
  return "`".repeat(length);
}

/** Insert ordinary Markdown while keeping the useful part selected for the next keystroke. */
export function formatMarkdown(
  text: string,
  from: number,
  to: number,
  format: MarkdownFormat,
) {
  const selected = text.slice(from, to);
  let body = selected,
    prefix = "",
    suffix = "";
  if (format === "link") {
    body = (selected || "link text").replace(/[\\[\]]/g, "\\$&");
    prefix = "[";
    suffix = "](https://)";
  } else if (format === "block") {
    body ||= "code";
    const fence = backtickFence(body, 3);
    const head = text.slice(0, from),
      tail = text.slice(to);
    prefix =
      (head && !head.endsWith("\n\n")
        ? head.endsWith("\n")
          ? "\n"
          : "\n\n"
        : "") +
      fence +
      "\n";
    suffix =
      "\n" +
      fence +
      (tail && !tail.startsWith("\n\n")
        ? tail.startsWith("\n")
          ? "\n"
          : "\n\n"
        : "");
  } else if (format === "code") {
    body ||= "code";
    const fence = backtickFence(body, 1);
    const pad = body.startsWith("`") || body.endsWith("`") ? " " : "";
    prefix = fence + pad;
    suffix = pad + fence;
  } else {
    body ||= format === "bold" ? "bold text" : "italic text";
    prefix = suffix = format === "bold" ? "**" : "*";
  }
  const value = text.slice(0, from) + prefix + body + suffix + text.slice(to);
  const start =
    from + prefix.length + (format === "link" ? body.length + 2 : 0);
  return {
    value,
    from: start,
    to: start + (format === "link" ? 8 : body.length),
  };
}
