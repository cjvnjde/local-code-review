/** Explicit profile launch options, not verified effective session settings. */
export interface AgentLaunchSummary {
  adapter: "omp" | "codex" | "other";
  model?: string;
  thinking?: string;
  permissions?: string;
}
