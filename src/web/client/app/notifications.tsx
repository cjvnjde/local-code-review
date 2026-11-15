import { useEffect, useRef, type CSSProperties } from "react";
import { Toaster, toast, useSonner, type ToastT } from "sonner";
import type { ReviewNote } from "../../../shared/review-types.ts";
import { useDiff, type ReviewResponse } from "./api.ts";
import { useUi } from "./ui-preferences.tsx";
import { ReplyNotificationsTracker } from "./reply-notifications-model.ts";
import { embedToken } from "../web-review/embedded.tsx";

const replyToast = "agent-replies";

export function Notifications() {
  if (embedToken) return <EmbeddedNotifications />;
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

/** The reviewed page owns notification placement, independently of the note iframe. */
function EmbeddedNotifications() {
  const { data: diff } = useDiff();
  const { toasts } = useSonner();
  const sent = useRef(new Map<string | number, ToastT>());
  const origin = diff?.web ? new URL(diff.web.url).origin : "";
  useEffect(() => {
    if (!origin) return;
    for (const item of toasts) {
      if (sent.current.get(item.id) === item) continue;
      sent.current.set(item.id, item);
      window.parent.postMessage(
        {
          type: "lcr:ui",
          token: embedToken,
          action: "notification",
          id: item.id,
          title: typeof item.title === "string" ? item.title : "",
          description:
            typeof item.description === "string" ? item.description : "",
          kind: item.type,
          duration: item.duration ?? 6000,
        },
        origin,
      );
    }
    for (const id of sent.current.keys()) {
      if (toasts.some((item) => item.id === id)) continue;
      sent.current.delete(id);
      window.parent.postMessage(
        {
          type: "lcr:ui",
          token: embedToken,
          action: "notification-dismiss",
          id,
        },
        origin,
      );
    }
  }, [origin, toasts]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== origin ||
        event.data?.type !== "lcr:ui" ||
        event.data.token !== embedToken ||
        event.data.action !== "notification-dismiss"
      )
        return;
      const item = sent.current.get(event.data.id);
      if (!item) return;
      if (event.data.automatic) item.onAutoClose?.(item);
      else item.onDismiss?.(item);
      toast.dismiss(item.id);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin]);
  return null;
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
