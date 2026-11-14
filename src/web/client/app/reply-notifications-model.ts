import type { ReviewNote } from "../../../shared/review-types.ts";

type ReviewSnapshot = { file: string; notes: ReviewNote[] };

export interface NewAgentReplies {
  note: ReviewNote;
  count: number;
}

/** Track identities, never message bodies: an edit is not another reply. */
export class ReplyNotificationsTracker {
  private scope: string | undefined;
  private file: string | undefined;
  private seen = new Map<string, Map<string, number>>();

  update(scope: string, review?: ReviewSnapshot): NewAgentReplies[] {
    if (!review) return [];
    const baseline = this.scope !== scope || this.file !== review.file;
    if (baseline) {
      this.scope = scope;
      this.file = review.file;
      this.seen.clear();
    }
    const added: NewAgentReplies[] = [];
    for (const note of review.notes) {
      const seen = this.seen.get(note.id) ?? new Map<string, number>();
      const counts = new Map<string, number>();
      let count = 0;
      for (const message of note.messages) {
        if (message.role !== "agent") continue;
        // Unstamped or repeated stamps have no unique ID. Retain a high-water
        // occurrence count so deletions/restoration cannot reannounce them.
        const occurrence = (counts.get(message.at) ?? 0) + 1;
        counts.set(message.at, occurrence);
        if (occurrence > (seen.get(message.at) ?? 0)) count++;
      }
      for (const [stamp, count] of counts)
        seen.set(stamp, Math.max(count, seen.get(stamp) ?? 0));
      this.seen.set(note.id, seen);
      if (!baseline && count) added.push({ note, count });
    }
    return added;
  }
}
