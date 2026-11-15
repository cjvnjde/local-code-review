export interface AccessibilityFinding {
  id: string;
  rule: string;
  kind: "violation" | "incomplete";
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  /** axe selector path; nested arrays identify shadow roots or frames. */
  targets: (string | string[])[];
  summary: string;
  savedNoteId?: string;
}

export interface AccessibilityReport {
  id: string;
  at: string;
  url: string;
  engine: { name: string; version: string };
  scope: string;
  privacy: boolean;
  omissionReason?: string;
  findings: AccessibilityFinding[];
}

export interface AccessibilitySaveResult {
  file: string;
  saved: { findingId: string; noteId: string }[];
}
