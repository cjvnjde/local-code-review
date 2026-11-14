import type { ReviewNote } from "../review/thread.ts";
import type { AgentLaunchSummary } from "../shared/agent-types.ts";

export interface AgentDelivery {
  state: "queued" | "unchanged" | "failed";
  count: number;
  error?: string;
}

export interface AgentConnection {
  agent: string;
  state: "checking" | "ready" | "unavailable";
  detail: string;
  launch?: AgentLaunchSummary;
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
  /** Run-local delivery preferences and access; never part of the adapter's durable identity. */
  contextMode?: (enabled: boolean) => void;
  contextAccess?: (access: { url: string; token: string }) => void;
  publish(
    review: string,
    notes: ReviewNote[],
  ): AgentDelivery | Promise<AgentDelivery>;
}
