import type { ReviewNote } from "./thread.ts";

export interface ChannelDelivery {
  state: "forwarded" | "queued" | "unchanged" | "failed";
  count: number;
  error?: string;
}

/** A saved reviewer action can wake an agent; file-watch events never do. */
export interface AgentChannel {
  agent: "claude" | "codex";
  publish(review: string, notes: ReviewNote[]): ChannelDelivery | Promise<ChannelDelivery>;
}
