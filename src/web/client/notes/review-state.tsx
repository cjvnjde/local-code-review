import { createContext, useContext, useMemo } from "react";
import type { ReviewNote } from "../../../shared/review-types.ts";
import { useStored } from "../app/preferences.ts";
const revision = (note: ReviewNote) =>
  JSON.stringify([note.body, note.messages, note.status, note.detail]);
const empty = {
  resolved: (_note: ReviewNote) => false,
  unread: (_note: ReviewNote) => 0,
  read: (_note: ReviewNote) => {},
  toggle: (_note: ReviewNote) => {},
  showResolved: false,
  setShowResolved: (_value: boolean) => {},
};
export const NoteState = createContext(empty);
export const useNoteState = () => useContext(NoteState);
export const canResolve = (note: ReviewNote) =>
  ["answered", "applied", "skipped"].includes(note.status) ||
  note.messages.at(-1)?.role === "agent";
export function useReviewState(scope: string) {
  const [resolved, setResolved] = useStored<Record<string, string>>(
    `lcr:v2:resolved:${scope}`,
    {},
  );
  const [seen, setSeen] = useStored<Record<string, number>>(
    `lcr:v2:seen:${scope}`,
    {},
  );
  const [showResolved, setShowResolved] = useStored(
    "lcr:v2:show-resolved",
    false,
  );
  return useMemo(
    () => ({
      showResolved,
      setShowResolved,
      resolved: (note: ReviewNote) => resolved[note.id] === revision(note),
      unread: (note: ReviewNote) =>
        Math.max(0, note.messages.length - (seen[note.id] || 0)),
      read: (note: ReviewNote) =>
        setSeen((current) =>
          current[note.id] === note.messages.length
            ? current
            : { ...current, [note.id]: note.messages.length },
        ),
      toggle: (note: ReviewNote) =>
        setResolved((current) => ({
          ...current,
          [note.id]: current[note.id] === revision(note) ? "" : revision(note),
        })),
    }),
    [resolved, seen, showResolved],
  );
}
