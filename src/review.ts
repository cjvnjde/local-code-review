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
    "",
  ];

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
  "---",
  "",
  "## How to work through this file",
  "",
  "This file is a conversation. Take the notes one at a time, in file order, and finish each one " +
    "before starting the next: make the change, then write your reply and your status into this " +
    "file straight away. The reviewer is reading it while you work.",
  "",
  "For each note, the last message in its thread is what you are answering. Everything above it is " +
    "history. A note with no thread yet is asking about the code under its `diff` block.",
  "",
  "A note headed `### Overall note`, under `## Overall`, is about the review as a whole rather than " +
    "about one place in it, so it carries no path and no `diff` block. Answer it exactly like the " +
    "rest: it has its own `Status:` line and its own thread.",
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
