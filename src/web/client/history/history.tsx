import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HistoryStore } from "./history-store.ts";
import {
  historyScope,
  historySnapshot,
  historySummary,
} from "./history-model.ts";
import type { DiffResponse, ReviewResponse } from "../app/api.ts";
import { Markdown } from "../components/markdown.tsx";
import { Button } from "../components/ui/button.tsx";

const store = new HistoryStore();
export function useHistoryCapture(diff: DiffResponse, review?: ReviewResponse) {
  const client = useQueryClient();
  useEffect(() => {
    if (!review) return;
    const input = {
      scope: historyScope(diff.repo, diff.range, diff.id),
      repo: diff.repo,
      source: "file" as const,
      snapshot: historySnapshot(review.file, review.notes),
    };
    void store
      .append(input)
      .then(() => client.invalidateQueries({ queryKey: ["history"] }))
      .catch((error) => client.setQueryData(["history-error"], String(error)));
  }, [diff.repo, diff.range, diff.id, review, client]);
}
export function History({ diff }: { diff: DiffResponse }) {
  const recording = useQuery<string>({
    queryKey: ["history-error"],
    queryFn: () => "",
    enabled: false,
  });
  const entries = useQuery({
    queryKey: ["history", diff.repo, diff.range, diff.id],
    queryFn: () => store.list(historyScope(diff.repo, diff.range, diff.id)),
  });
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(entries.data, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "lcr-history.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="space-y-4 overflow-auto">
      <p className="text-xs text-muted-foreground">
        Review states observed by this browser. History is read-only and stays
        after notes are deleted.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={!entries.data?.length}
        onClick={download}
      >
        Export history
      </Button>
      {recording.data && (
        <p role="alert" className="text-destructive">
          {recording.data}
        </p>
      )}
      {entries.error && (
        <p role="alert" className="text-destructive">
          {entries.error.message}
        </p>
      )}
      {entries.data?.map((entry) => (
        <details key={entry.id} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">
            {new Date(entry.at).toLocaleString()}
            <span className="ml-3 text-xs text-muted-foreground">
              {entry.reason || historySummary(entry)}
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {entry.snapshot.notes.map((note) => (
              <div key={note.id} className="border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {note.file || "Overall"} · {note.status}
                </p>
                <Markdown body={note.body} />
                {note.messages.map((message, i) => (
                  <div key={i} className="mt-3 border-l pl-3">
                    <span className="text-xs text-muted-foreground">
                      {message.role}
                    </span>
                    <Markdown body={message.body} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      ))}
      {entries.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No observed changes yet.
        </p>
      )}
    </div>
  );
}
