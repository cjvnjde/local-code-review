import {
  Ban,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pause,
  ShieldQuestion,
} from "lucide-react";
import { cn } from "../components/ui/button.tsx";
import { useDiff, useReview, type AgentState } from "./api.ts";
import {
  agentActivity,
  noteAgentActivity,
  type AgentActivityStatus,
} from "./agent-activity-model.ts";

export type { AgentActivityStatus } from "./agent-activity-model.ts";

export function useNoteAgentActivity(
  noteId: string,
): AgentActivityStatus | null {
  const diff = useDiff();
  const review = useReview();
  return noteAgentActivity({ ...diff.data, ...review.data }, noteId);
}

export function AgentActivityView({
  activity,
  className,
}: {
  activity: AgentActivityStatus;
  className?: string;
}) {
  const Icon = activity.spinning
    ? LoaderCircle
    : activity.state === "approval"
      ? ShieldQuestion
      : activity.state === "queued"
        ? Clock3
        : activity.state === "paused"
          ? Pause
          : activity.state === "completed"
            ? Check
            : activity.state === "cancelled"
              ? Ban
              : activity.tone === "warning" || activity.tone === "error"
                ? CircleAlert
                : Bot;
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={activity.detail || activity.label}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        activity.tone === "working" && "text-primary",
        activity.tone === "warning" && "text-amber-600 dark:text-amber-400",
        activity.tone === "success" && "text-emerald-600 dark:text-emerald-400",
        activity.tone === "error" && "text-destructive",
        activity.tone === "muted" && "text-muted-foreground",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", activity.spinning && "animate-spin")}
      />
      <span className="min-w-0 truncate">
        {activity.label}
        {activity.spinning && activity.detail && ` · ${activity.detail}`}
      </span>
    </span>
  );
}

// Button content only: the caller retains the footer's existing agent-panel action.
export function AgentActivity({
  agent,
  className,
}: {
  agent: AgentState;
  className?: string;
}) {
  return (
    <AgentActivityView
      activity={agentActivity(agent)}
      className={cn("max-w-64", className)}
    />
  );
}

export function NoteAgentActivity({
  activity,
  className,
}: {
  activity: AgentActivityStatus | null;
  className?: string;
}) {
  if (!activity) return null;
  return (
    <AgentActivityView
      activity={activity}
      className={cn("max-w-full text-xs", className)}
    />
  );
}
