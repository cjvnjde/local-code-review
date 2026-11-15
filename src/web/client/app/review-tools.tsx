import { useState } from "react";
import { Accessibility, History } from "lucide-react";
import type { RoundNoteReference } from "../../../shared/review-rounds.ts";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "../components/ui/dialog.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { ReviewRoundsPanel } from "../notes/review-rounds-panel.tsx";
import { AccessibilityPanel } from "../web-review/accessibility-panel.tsx";

export function ReviewTools({
  hasWeb,
  onOpenNote,
}: {
  hasWeb: boolean;
  onOpenNote?: (note: RoundNoteReference) => void;
}) {
  const [roundsOpen, setRoundsOpen] = useState(false);
  return (
    <>
      <Dialog open={roundsOpen} onOpenChange={setRoundsOpen}>
        <Tooltip label="Review rounds">
          <DialogTrigger
            render={
              <Button size="icon" variant="ghost" aria-label="Review rounds" />
            }
          >
            <History className="size-4" />
          </DialogTrigger>
        </Tooltip>
        <DialogContent
          title="Review rounds"
          description="Review changes since a handoff, then explicitly verify them."
          className="max-w-5xl"
        >
          <ReviewRoundsPanel
            onOpenNote={
              onOpenNote
                ? (note) => {
                    setRoundsOpen(false);
                    onOpenNote(note);
                  }
                : undefined
            }
          />
        </DialogContent>
      </Dialog>
      {hasWeb && (
        <Dialog>
          <Tooltip label="Check page accessibility">
            <DialogTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Check page accessibility"
                />
              }
            >
              <Accessibility className="size-4" />
            </DialogTrigger>
          </Tooltip>
          <DialogContent
            title="Page accessibility"
            description="Run a local accessibility check and choose which findings to save."
            className="max-w-4xl"
          >
            <AccessibilityPanel />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
