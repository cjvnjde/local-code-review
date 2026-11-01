import type { ReviewNote } from "../review/thread.ts";

export interface AgentDelivery {
  state: "queued" | "unchanged" | "failed";
  count: number;
  error?: string;
}

export interface AgentConnection {
  agent: string;
  state: "checking" | "ready" | "unavailable";
  detail: string;
}

/** A saved reviewer action can wake an agent; file-watch events never do. */
export interface AgentAdapter {
  agent: string;
  snapshot?: () => any;
  control?: (action: string, id?: string, option?: string) => Promise<void>;
  withdraw?: (review: string, ids?: string[]) => Promise<void>;
  revise?: (review: string, note: ReviewNote) => Promise<void>;
  close?: () => void | Promise<void>;
  status?: () => AgentConnection;
  check?: () => Promise<void>;
  publish(
    review: string,
    notes: ReviewNote[],
  ): AgentDelivery | Promise<AgentDelivery>;
}
