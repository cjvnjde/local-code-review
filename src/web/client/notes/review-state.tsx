import { createContext, useContext, useMemo } from "react";
import type { ReviewNote } from "../../../shared/review-types.ts";
import { useStored } from "../app/preferences.ts";
import {
  isResolved,
  reviewRevision,
  unreadAgentMessages,
} from "./review-state-model.ts";
const empty = {
  resolved: (_note: ReviewNote) => false,
  unread: (_note: ReviewNote) => 0,
  read: (_note: ReviewNote) => {},
  toggle: (_note: ReviewNote) => {},
};
export const NoteState = createContext(empty);
export const useNoteState = () => useContext(NoteState);
export const canResolve = (note: ReviewNote) => !!note.id;
export function useReviewState(scope: string) {
  const [resolved, setResolved] = useStored<Record<string, string>>(
    `lcr:v2:resolved:${scope}`,
    {},
  );
  const [seen, setSeen] = useStored<Record<string, number>>(
    `lcr:v2:seen:${scope}`,
    {},
  );
  return useMemo(
    () => ({
      resolved: (note: ReviewNote) => isResolved(note, resolved[note.id]),
      unread: (note: ReviewNote) => unreadAgentMessages(note, seen[note.id]),
      read: (note: ReviewNote) =>
        setSeen((current) =>
          current[note.id] === note.messages.length
            ? current
            : { ...current, [note.id]: note.messages.length },
        ),
      toggle: (note: ReviewNote) =>
        setResolved((current) => ({
          ...current,
          [note.id]: isResolved(note, current[note.id])
            ? ""
            : reviewRevision(note),
        })),
    }),
    [resolved, seen],
  );
}
