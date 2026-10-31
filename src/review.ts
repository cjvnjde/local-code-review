import { type ReviewDoc, type ReviewNote, renderNote } from "./thread.ts";

/**
 * Writes the review file. It is one running conversation, not a report: the notes carry whatever the
 * agent has already replied and recorded, and the footer tells it how to keep answering in place.
 */
export function renderMarkdown(doc: ReviewDoc): string {
  const byFile = new Map<string, ReviewNote[]>();
  const global: ReviewNote[] = [];
  for (const note of doc.notes) {
    if (note.scope === "global") {
      global.push(note);
      continue;
    }
    if (!byFile.has(note.file)) byFile.set(note.file, []);
    byFile.get(note.file)!.push(note);
  }

  const output: string[] = [
    "# Review notes",
    "",
    `Diff under review: \`${doc.range}\``,
  ];
  // A named review says its name first: that name, not the diff, is what a restart matches it by.
  if (doc.id) output.push(`Review id: \`${doc.id}\``);
  // The context the review was opened in, written so a restart can tell this conversation is its own.
  if (doc.branch) output.push(`Branch: \`${doc.branch}\``);
  if (doc.base) output.push(`Base: \`${doc.base}\``);
  output.push("");

  // Notes about the review as a whole lead the file, in the order they were written: they are the
  // frame the rest is read in, and each is answered exactly like a note on a line.
  if (global.length) {
    output.push("## Overall", "");
    for (const note of global) output.push(...renderNote(note));
  }

  for (const [file, notes] of byFile) {
    output.push(`## ${file}`, "");
    // A note on the file as a whole leads its section: it is the frame for every line note under it.
    notes.sort((a, b) =>
      Number(b.scope === "file") - Number(a.scope === "file") ||
      a.start - b.start || (a.ca ?? -1) - (b.ca ?? -1));
    for (const note of notes) output.push(...renderNote(note));
  }

  output.push(...FOOTER, "");
  return output.join("\n");
}

/**
 * The working agreement, kept at the end of every review file. It is written for an agent that works
 * one note at a time and answers as it goes, because the reviewer is watching the file for replies.
 */
const FOOTER = [
  // Marked, so the working agreement is out of reach of a fence a reply left open above it.
  "<!-- lcr:end -->",
  "",
  "---",
  "",
  "## How to work through this file",
  "",
  "This file is a conversation. Take the notes one at a time, in file order, and finish each one " +
    "before starting the next: make the change, then write your reply and your status into this " +
    "file straight away. The reviewer is reading it while you work.",
  "",
  "For each note, the last message in its thread is what you are answering. Everything above it is " +
    "history. A note with no thread yet is asking about its captured code or UI evidence.",
  "",
  "A note may point at another note of this review using `#mk1a`, a local comment URL ending in " +
    "`#note=mk1a`, or the older link `[src/app.ts:12](lcr:mk1a)`. " +
    "It names the note in this file whose `<!-- lcr:... -->` marker ends with `#mk1a`: read that one " +
    "too before you answer, and leave the link exactly as it stands.",
  "Every reply must answer its own note fully. Never replace an explanation with 'see above', " +
    "'same as another answer', or a reference alone. You may add `#<ref>` as supporting context, " +
    "using the exact suffix of the target note's marker; the page previews that note and its replies.",
  "To attach visual evidence, write a uniquely named image in `assets/` beside this review file, " +
    "then include `![What the image shows](assets/<name>.png)` in your appended reply. " +
    "`images/<name>.png` or a filename directly beside this review also works. Use a path relative " +
    "to this file, without a `.review/` prefix, and letters, digits, dots, underscores or hyphens " +
    "in the filename. Create and inspect the image first, explain it in the reply, and never " +
    "overwrite or delete existing pictures.",
  "",
  "A note headed `### Overall note`, under `## Overall`, is about the review as a whole rather than " +
    "about one place in it, so it carries no path and no `diff` block. Answer it exactly like the " +
    "rest: it has its own `Status:` line and its own thread.",
  "",
  "A UI note carries a `lcr:web` metadata block, its page URL, viewport, element or area details, " +
    "and immutable before/after screenshots linked relative to this file. Inspect both the page and " +
    "selected-area images. Component names and source locations are best-effort runtime hints; verify " +
    "them in the project. Preserve this evidence when answering. The reviewer can capture the result " +
    "with Capture after once the original route and relevant page state are restored.",
  "",
  "A screenshot-region note includes its before/after side, a rectangle in original image pixels " +
    "measured from the top-left, and a cropped capture linked relative to this file. Open that " +
    "capture to see the area the reviewer means. The capture records the image as it was when " +
    "commented on, even if the current file has changed. Leave the capture and its metadata intact.",
  "",
  "Fix what you agree with. If a note is wrong or would break something, say so instead of " +
    "implementing it. A note that only asks a question about the code has two outcomes: fix the " +
    "code when the question exposes a real problem, or leave the code alone and answer the " +
    "question when it is already correct.",
  "",
  "Record the outcome by replacing that note's `Status:` line with `Status: applied — <what " +
    "changed>`, `Status: answered — <short answer>`, `Status: skipped — <technical reason>`, or " +
    "`Status: needs-input — <question>`, and by appending your reply to the end of that note's " +
    "section:",
  "",
  "```",
  "**Agent** <!-- lcr:m -->",
  "",
  "What you did, or your answer to the question.",
  "```",
  "",
  "Append; never insert, reorder, or edit an earlier message. Leave every heading, `<!-- lcr:... -->` " +
    "marker, `diff` block, and reviewer message byte-identical. A `**Reviewer**` message that appears " +
    "under a note you already handled is a follow-up: answer it the same way, and update the " +
    "`Status:` line to the new outcome.",
];
