import type { ReviewNote } from "./thread.ts";

export interface ChannelDelivery {
  state: "forwarded" | "queued" | "unchanged" | "failed";
  count: number;
  error?: string;
}

export interface AgentConnection {
  agent: string;
  state: "checking" | "ready" | "unavailable";
  detail: string;
  mode?: "managed" | "attachment";
}

/** A saved reviewer action can wake an agent; file-watch events never do. */
export interface AgentChannel {
  agent: string;
  managed?: boolean;
  snapshot?: () => any;
  control?: (action: string, id?: string, option?: string) => Promise<void>;
  withdraw?: (review: string, ids?: string[]) => Promise<void>;
  revise?: (review: string, note: ReviewNote) => Promise<void>;
  close?: () => void | Promise<void>;
  available?: () => boolean;
  status?: () => AgentConnection;
  check?: (force?: boolean) => Promise<void>;
  publish(review: string, notes: ReviewNote[]): ChannelDelivery | Promise<ChannelDelivery>;
}
