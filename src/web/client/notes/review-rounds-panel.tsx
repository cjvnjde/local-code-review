import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ReviewRound,
  RoundComparison,
  RoundNoteReference,
} from "../../../shared/review-rounds.ts";
import { request } from "../app/api.ts";
import { Button } from "../components/ui/button.tsx";

/** Routes use the existing authenticated request transport, never a separate fetch client. */
export function ReviewRoundsPanel({
  onOpenNote,
}: {
  onOpenNote?: (note: RoundNoteReference) => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState<string>();
  const rounds = useQuery({
    queryKey: ["review-rounds", "list", archived, offset],
    queryFn: () =>
      request<{ rounds: ReviewRound[] }>(
        `/api/review-rounds?archived=${archived ? "1" : "0"}&offset=${offset}`,
      ),
    refetchInterval: 10000,
  });
  const id = selected ?? rounds.data?.rounds[0]?.id;
  const comparison = useQuery({
    queryKey: ["review-rounds", id],
    queryFn: () =>
      request<RoundComparison>(`/api/review-rounds/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const capture = useMutation({
    mutationFn: () => request<ReviewRound>("/api/review-rounds", "POST", {}),
    onSuccess: async (round) => {
      setArchived(false);
      setOffset(0);
      setSelected(round.id);
      await client.invalidateQueries({ queryKey: ["review-rounds"] });
    },
  });
  const verify = useMutation({
    mutationFn: ({ id, fingerprint }: { id: string; fingerprint: string }) =>
      request<RoundComparison>(
        `/api/review-rounds/${encodeURIComponent(id)}/verify`,
        "POST",
        { fingerprint },
      ),
    onSuccess: (data) => {
      client.setQueryData(["review-rounds", data.round.id], data);
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ["review-rounds", id] });
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) =>
      request<{ ok: boolean }>(
        `/api/review-rounds/${encodeURIComponent(id)}/archive`,
        "POST",
        {},
      ),
    onSuccess: async () => {
      setConfirmArchive(undefined);
      setSelected(undefined);
      await client.invalidateQueries({ queryKey: ["review-rounds"] });
    },
  });
  const data = comparison.data;
  const error =
    rounds.error ??
    comparison.error ??
    capture.error ??
    verify.error ??
    archive.error;
  return (
    <section
      className="space-y-3 rounded-md border p-3"
      aria-label="Review rounds"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Review rounds</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={capture.isPending}
            onClick={() => capture.mutate()}
          >
            {capture.isPending ? "Capturing…" : "Capture manual baseline"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={rounds.isFetching || comparison.isFetching}
            onClick={() => {
              void rounds.refetch();
              if (id) void comparison.refetch();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Compare actual files with an immutable handoff snapshot. Reviewer
        verification is independent of agent completion, note status, and
        resolution. Manual baselines capture files now, before work starts.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Round collection">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={!archived}
          onClick={() => {
            setArchived(false);
            setOffset(0);
            setSelected(undefined);
            setConfirmArchive(undefined);
          }}
        >
          Active
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={archived}
          onClick={() => {
            setArchived(true);
            setOffset(0);
            setSelected(undefined);
            setConfirmArchive(undefined);
          }}
        >
          Archived
        </Button>
        {archived && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={!offset || rounds.isFetching}
              onClick={() => {
                setOffset(offset - 32);
                setSelected(undefined);
              }}
            >
              Previous page
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={rounds.data?.rounds.length !== 32 || rounds.isFetching}
              onClick={() => {
                setOffset(offset + 32);
                setSelected(undefined);
              }}
            >
              Next page
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {rounds.isPending && <p role="status">Loading review rounds…</p>}
      {rounds.data?.rounds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {archived
            ? "No archived rounds on this page."
            : "No active baseline yet. Capture one before manual work, or hand a note to the managed agent."}
        </p>
      )}
      {!!rounds.data?.rounds.length && (
        <label className="flex flex-col gap-1 text-sm">
          Round
          <select
            className="rounded border bg-background p-2"
            value={id}
            onChange={(event) => {
              setSelected(event.target.value);
              verify.reset();
            }}
          >
            {rounds.data.rounds.map((round) => (
              <option key={round.id} value={round.id}>
                {round.created} · {round.source} · {round.baseline}
                {round.taskId ? ` · task ${round.taskId}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {id && comparison.isPending && (
        <p role="status">Comparing current file contents…</p>
      )}
      {data && (
        <>
          <p className="break-all text-xs text-muted-foreground">
            Review: {data.round.review || "Unsaved review"}
            {data.round.taskId ? ` · Task: ${data.round.taskId}` : ""}
          </p>
          {!archived && (
            <Button
              size="sm"
              variant="outline"
              disabled={archive.isPending}
              onClick={() => setConfirmArchive(data.round.id)}
            >
              Archive round
            </Button>
          )}
          {confirmArchive === data.round.id && (
            <div role="alert" className="space-y-2 rounded border p-2 text-sm">
              <p>
                Archive this round? Its baseline and verification remain
                available in Archived. This frees an active slot without
                changing queue tasks, note status, or replaying work.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(data.round.id)}
                >
                  {archive.isPending ? "Archiving…" : "Confirm archive"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={archive.isPending}
                  onClick={() => setConfirmArchive(undefined)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm">
              Reviewer verification: <strong>{data.verification.state}</strong>
              {data.verification.at ? ` (${data.verification.at})` : ""}
            </p>
            <Button
              size="sm"
              disabled={
                !data.complete ||
                data.verification.state === "verified" ||
                verify.isPending ||
                comparison.isFetching
              }
              onClick={() =>
                verify.mutate({
                  id: data.round.id,
                  fingerprint: data.fingerprint,
                })
              }
            >
              {verify.isPending ? "Verifying…" : "Verify reviewed changes"}
            </Button>
          </div>
          {data.verification.state === "stale" && (
            <p className="text-sm text-destructive">
              Files changed or evidence became unavailable after verification.
              Review the current changes and verify again.
            </p>
          )}
          {!data.complete && (
            <p className="text-sm text-destructive">
              Evidence is incomplete. This round cannot be verified.
            </p>
          )}
          {!!data.issues.length && (
            <details>
              <summary className="cursor-pointer text-sm">
                Evidence limitations ({data.issues.length})
              </summary>
              <ul className="max-h-40 list-disc overflow-auto pl-5 text-xs">
                {data.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
          <h3 className="text-sm font-medium">
            Changes since handoff ({data.files.length})
          </h3>
          {!data.files.length && (
            <p className="text-sm text-muted-foreground">
              {data.complete
                ? "No file contents or executable permissions changed."
                : "No changes can be established from the available evidence."}
            </p>
          )}
          <div className="max-h-96 space-y-2 overflow-auto">
            {data.files.map((file) => (
              <details key={file.path} className="rounded border p-2">
                <summary className="cursor-pointer break-all text-sm">
                  {file.kind}: {file.from ? `${file.from} → ` : ""}
                  {file.path}
                  {file.binary ? " (binary)" : ""}
                </summary>
                {file.detail && (
                  <p className="my-2 text-xs text-muted-foreground">
                    {file.detail}
                  </p>
                )}
                {file.patch && (
                  <pre
                    className="overflow-auto whitespace-pre text-xs"
                    tabIndex={0}
                    aria-label={`Changes in ${file.path}`}
                  >
                    {file.patch}
                  </pre>
                )}
                {file.binary && (
                  <dl className="break-all text-xs">
                    <dt>Before SHA-256</dt>
                    <dd>{file.beforeHash ?? "No available before content"}</dd>
                    <dt>Current SHA-256</dt>
                    <dd>
                      {file.currentHash ?? "No available current content"}
                    </dd>
                  </dl>
                )}
              </details>
            ))}
          </div>
          <h3 className="text-sm font-medium">
            Affected conversations ({data.affectedNotes.length})
          </h3>
          <ul className="space-y-1 text-sm">
            {data.affectedNotes.map((note) => (
              <li key={`${note.review}#${note.noteId}`}>
                {onOpenNote ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenNote(note)}
                  >
                    {note.file || "Overall note"}
                    {note.label ? `:${note.label}` : ""} · {note.noteId}
                  </Button>
                ) : (
                  <span className="break-all">
                    {note.file || "Overall note"}
                    {note.label ? `:${note.label}` : ""} · {note.review}#
                    {note.noteId}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-xs">
              Conversations associated at handoff ({data.round.notes.length})
            </summary>
            <ul className="space-y-1 text-xs">
              {data.round.notes.map((note) => (
                <li className="break-all" key={`${note.review}#${note.noteId}`}>
                  {note.review}#{note.noteId}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
