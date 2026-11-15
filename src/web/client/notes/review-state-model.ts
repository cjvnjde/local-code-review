import type { ReviewNote } from "../../../shared/review-types.ts";

/** Browser-local acknowledgement is invalidated by any conversation revision. */
export const reviewRevision = (note: ReviewNote) =>
  JSON.stringify([note.body, note.messages, note.status, note.detail]);

export const isResolved = (note: ReviewNote, acknowledgement?: string) =>
  acknowledgement === reviewRevision(note);

/** Seen positions remain indices into the complete conversation, including our replies. */
export function unreadAgentMessages(note: ReviewNote, seenIndex = 0): number {
  let unread = 0;
  for (let i = Math.max(0, seenIndex); i < note.messages.length; i++) {
    if (note.messages[i]?.role === "agent") unread++;
  }
  return unread;
}
