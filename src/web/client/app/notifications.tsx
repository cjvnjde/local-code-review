import { useEffect, useRef, type CSSProperties } from "react";
import { Toaster, toast } from "sonner";
import type { ReviewNote } from "../../../shared/review-types.ts";
import type { ReviewResponse } from "./api.ts";
import { useUi } from "./ui-preferences.tsx";
import { ReplyNotificationsTracker } from "./reply-notifications-model.ts";

const replyToast = "agent-replies";

export function Notifications() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      duration={6000}
      containerAriaLabel="Notifications"
      style={
        {
          // Follow the app's class-based theme, not the OS color scheme.
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      toastOptions={{
        descriptionClassName: "!text-muted-foreground",
        actionButtonStyle: {
          background: "var(--primary)",
          color: "var(--primary-foreground)",
        },
      }}
    />
  );
}

/** Mount once below UiPreferences; disabled notifications still consume snapshots. */
export function useReplyNotifications(
  review: ReviewResponse | undefined,
  scope: string,
  onView?: (note: ReviewNote) => void,
) {
  const { settings } = useUi();
  const tracker = useRef<ReplyNotificationsTracker | null>(null);
  tracker.current ??= new ReplyNotificationsTracker();
  useEffect(() => {
    toast.dismiss(replyToast);
  }, [scope, review?.file]);
  useEffect(() => {
    const added = tracker.current!.update(scope, review);
    if (!settings.toast || !added.length) return;
    const count = added.reduce((total, entry) => total + entry.count, 0);
    const latest = added[added.length - 1]!.note;
    toast(count === 1 ? "New agent reply" : `${count} new agent replies`, {
      id: replyToast,
      ...(onView
        ? { action: { label: "View", onClick: () => onView(latest) } }
        : {}),
    });
  }, [review, scope, settings.toast, onView]);
}
