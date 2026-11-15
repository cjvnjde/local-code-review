import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { ReviewResponse } from "../app/api.ts";

type Arrivals = {
  notes: Set<string>;
  messages: Map<string, Set<number>>;
};
type Baseline = {
  scope: string;
  file: string;
  seen: Map<string, Map<string, number>>;
};

export const NoteMotion = createContext<Arrivals | null>(null);

/** Observe the complete review once, above filtered and virtualized note cards. */
export function useNoteMotion(
  review: ReviewResponse | undefined,
  scope: string,
  switchingReview = false,
) {
  const baseline = useRef<Baseline | null>(null);
  const snapshot = useMemo(() => {
    const arrivals: Arrivals = { notes: new Set(), messages: new Map() };
    if (!review) return { arrivals, baseline: baseline.current };
    const previous = baseline.current;
    // The first save names an empty review; reopening a review is different.
    // Its mutation stays pending until the refreshed snapshot has arrived.
    const initial =
      switchingReview ||
      !previous ||
      previous.scope !== scope ||
      (!!previous.file && previous.file !== review.file);
    const seen = new Map(initial ? undefined : previous?.seen);
    for (const note of review.notes) {
      const known = seen.get(note.id);
      const stamps = new Map(known);
      const occurrences = new Map<string, number>();
      const messages = new Set<number>();
      if (!initial && !known) arrivals.notes.add(note.id);
      note.messages.forEach((message, index) => {
        // Bodies can stream or be edited; unstamped/repeated messages use a
        // high-water occurrence count, just like reply notifications.
        const identity = JSON.stringify([message.role, message.at]);
        const occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        if (!initial && occurrence > (known?.get(identity) ?? 0))
          messages.add(index);
        stamps.set(identity, Math.max(occurrence, stamps.get(identity) ?? 0));
      });
      seen.set(note.id, stamps);
      if (messages.size) arrivals.messages.set(note.id, messages);
    }
    return { arrivals, baseline: { scope, file: review.file, seen } };
  }, [review, scope, switchingReview]);

  useLayoutEffect(() => {
    baseline.current = snapshot.baseline;
    // Child layout effects consume this commit's arrivals first. Do not retain
    // them for cards revealed later by scrolling, filtering, or changing tabs.
    snapshot.arrivals.notes.clear();
    snapshot.arrivals.messages.clear();
  }, [snapshot]);
  return snapshot.arrivals;
}

export function useNoteEntrance(noteId: string) {
  const arrivals = useContext(NoteMotion);
  const root = useRef<HTMLElement>(null);
  const active = useRef(new Set<Animation>());
  useLayoutEffect(() => {
    const animations = active.current;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      for (const animation of animations) animation.cancel();
      animations.clear();
    };
    const changed = () => {
      if (preference.matches) cancel();
    };
    preference.addEventListener("change", changed);
    return () => {
      preference.removeEventListener("change", changed);
      cancel();
    };
  }, [noteId]);
  useLayoutEffect(() => {
    const element = root.current;
    if (
      !element ||
      !arrivals ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const enter = (target: HTMLElement) => {
      const animation = target.animate(
        [
          { opacity: 0.65, transform: "translateY(3px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 160, easing: "ease-out" },
      );
      active.current.add(animation);
      const finished = () => active.current.delete(animation);
      animation.onfinish = finished;
      animation.oncancel = finished;
    };
    if (arrivals.notes.has(noteId)) {
      enter(element);
      return;
    }
    for (const index of arrivals.messages.get(noteId) ?? []) {
      const message = element.querySelector<HTMLElement>(
        `[data-note-message="${index}"]`,
      );
      if (message) enter(message);
    }
  }, [arrivals, noteId]);
  return root;
}
