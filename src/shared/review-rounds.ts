export interface RoundNoteReference {
  review: string;
  noteId: string;
  /** Empty for a conversation about the review as a whole. */
  file: string;
  label?: string;
}

export interface ReviewRound {
  id: string;
  created: string;
  source: "agent" | "manual";
  review: string;
  taskId?: string;
  notes: RoundNoteReference[];
  baseline: "ready" | "partial" | "failed";
  issues: string[];
}

export interface RoundFileChange {
  path: string;
  from?: string;
  kind: "added" | "deleted" | "modified" | "renamed" | "unavailable";
  binary: boolean;
  beforeHash?: string;
  currentHash?: string;
  patch?: string;
  detail?: string;
}

export interface RoundComparison {
  round: ReviewRound;
  /** Content identity, not a hash of diff formatting. Pass back when verifying. */
  fingerprint: string;
  complete: boolean;
  issues: string[];
  files: RoundFileChange[];
  affectedNotes: RoundNoteReference[];
  verification: {
    state: "unverified" | "verified" | "stale";
    at?: string;
  };
}

export interface CaptureRoundInput {
  source: "agent" | "manual";
  review: string;
  taskId?: string;
  notes: RoundNoteReference[];
}
