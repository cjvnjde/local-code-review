import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiffFile, ReviewNote } from "../../../shared/review-types.ts";
import type { AgentLaunchSummary } from "../../../shared/agent-types.ts";
import { toast } from "sonner";
import { useUi } from "./ui-preferences.tsx";

export interface AgentState {
  agent?: string;
  connection?: {
    state: string;
    detail: string;
    agent: string;
    launch?: AgentLaunchSummary;
  };
  queue?: {
    review?: string;
    paused: boolean;
    activity?: string;
    tasks: {
      id: string;
      noteId: string;
      review: string;
      state: string;
      detail?: string;
      target: string;
    }[];
    permissions: {
      id: string;
      toolCall: { title?: string };
      options: { optionId: string; name: string; kind: string }[];
    }[];
  };
}
export interface DiffResponse extends AgentState {
  repo: string;
  range: string;
  branch: string;
  id: string;
  context: number;
  files: DiffFile[];
  web?: { url: string; state?: string };
}
export interface ReviewResponse extends AgentState {
  file: string;
  notes: ReviewNote[];
}

export async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export function useDiff() {
  return useQuery({
    queryKey: ["diff"],
    queryFn: () => request<DiffResponse>("/api/diff"),
  });
}
export function useReview() {
  return useQuery({
    queryKey: ["review"],
    queryFn: () => request<ReviewResponse>("/api/review"),
  });
}
export function useAction() {
  const client = useQueryClient();
  const { settings } = useUi();
  return useMutation({
    mutationFn: ({
      url,
      method,
      body,
    }: {
      url: string;
      method?: string;
      body?: unknown;
    }) => request<unknown>(url, method, body),
    onError: (_error, variables) => {
      if (!settings.toast) return;
      const saved = savedItem(variables);
      toast.error(saved ? `Could not save ${saved}` : "Action failed", {
        description: saved
          ? "Your changes have not been saved. Try again."
          : "The action could not be completed. Try again.",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["review"] }),
        client.invalidateQueries({ queryKey: ["reviews"] }),
        client.invalidateQueries({ queryKey: ["ghosts"] }),
      ]);
    },
  });
}

function savedItem({
  url,
  method = "GET",
  body,
}: {
  url: string;
  method?: string;
  body?: unknown;
}): "note" | "reply" | undefined {
  if (
    url === "/api/note" &&
    method === "POST" &&
    !(body && typeof body === "object" && "retry" in body && body.retry)
  )
    return "note";
  if (url === "/api/reply" && (method === "POST" || method === "PUT"))
    return "reply";
}

export function useLive() {
  const client = useQueryClient();
  useEffect(() => {
    const events = new EventSource("/api/events");
    // Every connection (including reconnects) catches up with changes missed while offline.
    events.onopen = () => {
      void client.invalidateQueries({ queryKey: ["diff"] });
      void client.invalidateQueries({ queryKey: ["review"] });
    };
    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "diff")
          void client.invalidateQueries({ queryKey: ["diff"] });
        else if (data.type === "settings")
          void client.invalidateQueries({ queryKey: ["settings"] });
        else {
          void client.invalidateQueries({ queryKey: ["review"] });
          void client.invalidateQueries({ queryKey: ["ghosts"] });
        }
      } catch {
        /* A heartbeat carries no state. */
      }
    };
    return () => events.close();
  }, [client]);
}
