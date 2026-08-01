import type { ReviewSubmission } from "./types.ts";

export function renderMarkdown({ general, comments }: ReviewSubmission, range: string): string {
  const byFile = new Map<string, ReviewSubmission["comments"]>();
  for (const comment of comments) {
    if (!byFile.has(comment.file)) byFile.set(comment.file, []);
    byFile.get(comment.file)!.push(comment);
  }

  const output: string[] = [
    "# Review notes",
    "",
    `Diff under review: \`${range}\``,
    `Written: ${new Date().toISOString()}`,
    "",
  ];

  if (general.trim()) {
    output.push("## Overall", "", general.trim(), "");
  }

  for (const [file, commentsForFile] of byFile) {
    output.push(`## ${file}`, "");
    commentsForFile.sort((a, b) => a.start - b.start);
    for (const comment of commentsForFile) {
      const location = comment.label || (
        comment.start === comment.end ? String(comment.start) : `${comment.start}-${comment.end}`
      );
      const side = comment.side === "old" ? " (line numbers before the change)" : "";
      output.push(`### ${file}:${location}${side}`, "");
      if (comment.code && comment.code.trim()) {
        output.push("```diff", comment.code, "```", "");
      }
      output.push(comment.body.trim(), "");
    }
  }

  output.push(
    "---",
    "",
    "Work through every note above. Fix what you agree with. If a note is wrong or " +
      "would break something, say so instead of implementing it. Report what you changed per note.",
    "",
  );
  return output.join("\n");
}
