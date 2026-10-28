import type { ReviewNote } from "./thread.ts";

export interface ChannelDelivery {
  state: "forwarded" | "queued" | "unchanged" | "failed";
  count: number;
  error?: string;
}

export interface AgentConnection {
  agent: "claude" | "codex";
  state: "checking" | "ready" | "unavailable";
  detail: string;
}

/** A saved reviewer action can wake an agent; file-watch events never do. */
export interface AgentChannel {
  agent: "claude" | "codex";
  available?: () => boolean;
  status?: () => AgentConnection;
  check?: (force?: boolean) => Promise<void>;
  publish(review: string, notes: ReviewNote[]): ChannelDelivery | Promise<ChannelDelivery>;
}
