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
    // A note on the file as a whole leads its section: it is the frame for every line note under it.
    commentsForFile.sort((a, b) =>
      Number(b.scope === "file") - Number(a.scope === "file") ||
      a.start - b.start || (a.ca ?? -1) - (b.ca ?? -1));
    for (const comment of commentsForFile) {
      const marker = comment.id ? ` <!-- lcr:${comment.id.replace(/[<>]/g, "")} -->` : "";
      if (comment.scope === "file") {
        output.push(`### ${file} (whole file)${marker}`, "", comment.body.trim(), "", "Status: pending", "");
        continue;
      }
      const location = comment.label || (
        comment.start === comment.end ? String(comment.start) : `${comment.start}-${comment.end}`
      );
      const side = comment.side === "old" ? " (line numbers before the change)" : "";
      output.push(`### ${file}:${location}${side}${marker}`, "");
      if (comment.code && comment.code.trim()) {
        output.push("```diff", comment.code, "```", "");
      }
      if (comment.snippet) {
        output.push(`Applies to this part of the line only: ${inlineCode(comment.snippet)}`, "");
      }
      output.push(comment.body.trim(), "", "Status: pending", "");
    }
  }

  output.push(
    "---",
    "",
    "Work through every note above. Fix what you agree with. If a note is wrong or " +
      "would break something, say so instead of implementing it. Report what you changed per note.",
    "",
    "A note that only asks a question about the code has two outcomes: fix the code when the " +
      "question exposes a real problem, or leave the code alone and answer the question when it " +
      "is already correct.",
    "",
    "Then record the outcome in this file: replace each note's `Status: pending` line with " +
      "`Status: applied — <what changed>`, `Status: answered — <short answer>`, " +
      "`Status: skipped — <technical reason>`, or " +
      "`Status: needs-input — <question>`. Change nothing else here, and keep the " +
      "`<!-- lcr:... -->` marker on every heading. lcr reads these lines on its next run so " +
      "handled notes can be cleared from the review UI.",
    "",
  );
  return output.join("\n");
}

/** Fences a selected fragment in enough backticks to survive the backticks inside it. */
function inlineCode(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(0, ...runs) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
