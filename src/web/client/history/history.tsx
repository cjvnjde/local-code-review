import { useState } from "react";
import { WebEvidence, ConversationBody } from "../web-review/evidence.tsx";
import { AttachmentImage } from "../components/images.tsx";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HistoryStore } from "./history-store.ts";
import {
  historyScope,
  historySnapshot,
  historySummary,
  historyMatches,
  historyText,
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
  const [query, setQuery] = useState("");
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
      <input
        aria-label="Filter history"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a note, reply, status or deleted content…"
        className="w-full rounded-lg border bg-background p-3 text-xs"
      />
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
      {entries.data
        ?.filter((entry) => historyMatches(entry, query))
        .map((entry) => (
          <details key={entry.id} className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">
              {new Date(entry.at).toLocaleString()}
              <span className="ml-3 text-xs text-muted-foreground">
                {entry.reason || historySummary(entry)}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    historyText(entry, "changes"),
                  )
                }
              >
                Copy changes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    historyText(entry, "snapshot"),
                  )
                }
              >
                Copy snapshot
              </Button>
              {entry.changes.some((change) => !change.after) && (
                <details className="rounded border p-3">
                  <summary className="cursor-pointer text-xs">
                    Removed notes
                  </summary>
                  {entry.changes
                    .filter((change) => !change.after)
                    .map((change) => (
                      <div key={change.id} className="mt-3">
                        <Markdown
                          body={change.before?.body || ""}
                          file={change.before?.file}
                          captured={change.before?.code}
                        />
                        {change.before?.messages.map((message, i) => (
                          <ConversationBody
                            key={i}
                            body={message.body}
                            file={change.before!.file}
                            captured={change.before!.code}
                          />
                        ))}
                      </div>
                    ))}
                </details>
              )}
              {entry.snapshot.notes.map((note) => (
                <div key={note.id} className="border-t pt-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {note.file || "Overall"} · {note.status}
                  </p>
                  {note.code && (
                    <details>
                      <summary className="cursor-pointer text-xs">
                        Captured code
                      </summary>
                      <pre className="max-h-48 overflow-auto text-xs">
                        {note.code}
                      </pre>
                    </details>
                  )}
                  <WebEvidence value={note.web} editable={false} />
                  {note.image && (
                    <AttachmentImage
                      source={note.image.capture}
                      label="Selected screenshot region"
                    />
                  )}
                  <Markdown
                    body={note.body}
                    file={note.file}
                    captured={note.code}
                  />
                  {note.messages.map((message, i) => (
                    <div key={i} className="mt-3 border-l pl-3">
                      <span className="text-xs text-muted-foreground">
                        {message.role}
                      </span>
                      <ConversationBody
                        body={message.body}
                        file={note.file}
                        captured={note.code}
                      />
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
