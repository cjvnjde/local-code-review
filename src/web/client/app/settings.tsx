import { useUi } from "./ui-preferences.tsx";
import { hidePatterns } from "../diff/filters.ts";
import { useQuery } from "@tanstack/react-query";
import type { UiSettings } from "../../../shared/settings.ts";
import { request, useAction, type AgentState } from "./api.ts";
import { Button } from "../components/ui/button.tsx";

export function Settings({
  agent,
  onNewReview,
  onOpenReview,
}: {
  agent: AgentState;
  onNewReview: () => void;
  onOpenReview: (file: string) => void;
}) {
  const ui = useUi();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => request<{ settings: UiSettings }>("/api/settings"),
  });
  const reviews = useQuery({
    queryKey: ["reviews"],
    queryFn: () =>
      request<{
        session: string;
        reviews: { file: string; id: string; range: string; notes: number }[];
      }>("/api/reviews"),
  });
  const action = useAction();
  return (
    <div className="space-y-6 overflow-auto pr-1">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Reading and editing</h3>
        {(
          [
            ["auto", "Mark files viewed as I read"],
            ["back", "Unmark automatically viewed files when scrolling back"],
            ["foldDel", "Fold removed lines by default"],
            ["enterSaves", "Enter saves · Shift+Enter inserts a newline"],
            ["single", "Keep one pending note per selection"],
            ["ghosts", "Show notes from other reviews"],
          ] as const
        ).map(([key, label]) => (
          <label className="flex items-center gap-3 text-sm" key={key}>
            <input
              type="checkbox"
              checked={ui.settings[key]}
              onChange={(event) => ui.update({ [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
        <label className="block text-xs">
          Reading speed threshold
          <select
            aria-label="Reading speed threshold"
            className="ml-3 rounded border bg-background p-2"
            value={ui.settings.limit}
            onChange={(event) => ui.update({ limit: +event.target.value })}
          >
            {[0, 500, 900, 1800].map((value) => (
              <option value={value} key={value}>
                {value ? `${value} px/s` : "No speed limit"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Context expansion
          <select
            aria-label="Context expansion"
            className="ml-3 rounded border bg-background p-2"
            value={ui.settings.expand}
            onChange={(event) => ui.update({ expand: +event.target.value })}
          >
            {[10, 20, 50, 100].map((value) => (
              <option value={value} key={value}>
                {value} lines
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          Sidebar width
          <input
            aria-label="Sidebar width"
            type="range"
            min="180"
            max={Math.max(480, ui.settings.navWidth)}
            value={ui.settings.navWidth || 256}
            onChange={(event) => ui.update({ navWidth: +event.target.value })}
            className="ml-3"
          />
        </label>
        <label className="block text-xs">
          External editor
          <input
            aria-label="External editor"
            value={ui.settings.editor}
            onChange={(event) => ui.update({ editor: event.target.value })}
            placeholder="Default editor"
            className="mt-2 block w-full rounded border bg-background p-2"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          ⌘/Ctrl K: search · Alt J/K: notes · Alt ↑/↓: bookmarks · Alt C: all
          notes · Alt-drag: select text for copying.
        </p>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">File visibility</h3>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={ui.settings.hideEnabled}
            onChange={(event) =>
              ui.update({ hideEnabled: event.target.checked })
            }
          />
          Enable hide patterns
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={ui.settings.hideDeleted}
            onChange={(event) =>
              ui.update({ hideDeleted: event.target.checked })
            }
          />
          Hide deleted files
        </label>
        <textarea
          aria-label="Hide file patterns"
          className="h-24 w-full rounded border bg-background p-3 font-mono text-xs"
          value={ui.settings.hide}
          onChange={(event) => ui.update({ hide: event.target.value })}
          placeholder="*.lock
 dist/
 **/*.snap"
        />
        {hidePatterns(ui.settings.hide).map((pattern) => (
          <label className="flex items-center gap-3 text-xs" key={pattern}>
            <input
              type="checkbox"
              checked={!ui.settings.disabledHide.includes(pattern)}
              onChange={(event) =>
                ui.update({
                  disabledHide: event.target.checked
                    ? ui.settings.disabledHide.filter(
                        (item) => item !== pattern,
                      )
                    : [...ui.settings.disabledHide, pattern],
                })
              }
            />
            <code>{pattern}</code>
          </label>
        ))}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Review files</h3>
        <p className="text-xs text-muted-foreground">
          One Markdown file holds each conversation. Starting a new review
          leaves the current file on disk.
        </p>
        <Button variant="outline" onClick={onNewReview}>
          New review
        </Button>
        {reviews.data?.reviews
          .slice()
          .reverse()
          .map((review) => (
            <button
              key={review.file}
              disabled={action.isPending}
              className="block w-full rounded-lg border p-3 text-left text-xs hover:bg-accent"
              onClick={() => onOpenReview(review.file)}
            >
              <span className="block font-mono">
                {review.file}
                {reviews.data.session === review.file ? " · current" : ""}
              </span>
              <span className="text-muted-foreground">
                {review.id || review.range} · {review.notes} notes
              </span>
            </button>
          ))}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Capture context</h3>
        <p className="text-xs text-muted-foreground">
          Optional evidence for web reviews and agent access.
        </p>
        {(
          [
            ["aiContext", "Save context for on-demand AI reading"],
            ["contextHtml", "Include selected HTML"],
            ["contextFullPage", "Include full-page screenshots"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.data?.settings[key] || false}
              disabled={!settings.data || action.isPending}
              onChange={async (e) => {
                await action
                  .mutateAsync({
                    url: "/api/settings",
                    method: "PUT",
                    body: { [key]: e.target.checked },
                  })
                  .catch(() => {});
                void settings.refetch();
              }}
            />
            {label}
          </label>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Agent connection</h3>
        <p className="text-xs text-muted-foreground">
          {agent.connection
            ? `${agent.connection.agent}: ${agent.connection.state}. ${agent.connection.detail}`
            : "No ACP agent configured. Save notes and ask your coding agent to address the Markdown file."}
        </p>
      </section>
      {(action.error || settings.error || reviews.error) && (
        <p role="alert" className="text-sm text-destructive">
          {action.error?.message ||
            settings.error?.message ||
            reviews.error?.message}
        </p>
      )}
    </div>
  );
}

export function AgentPanel({ agent }: { agent: AgentState }) {
  const action = useAction();
  const control = (name: string, id?: string, option?: string) =>
    action.mutate({
      url: "/api/agent/queue",
      method: "POST",
      body: { action: name, id, option },
    });
  return (
    <div className="space-y-4 overflow-auto">
      <p className="text-sm text-muted-foreground">
        {agent.connection?.detail || "No ACP connection configured."}
      </p>
      {agent.queue && (
        <>
          <Button
            disabled={action.isPending}
            variant="outline"
            onClick={() => control(agent.queue!.paused ? "resume" : "pause")}
          >
            {agent.queue.paused ? "Resume queue" : "Pause queue"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {agent.queue.activity}
          </p>
          {agent.queue.permissions.map((permission) => (
            <div
              key={permission.id}
              className="space-y-3 rounded-lg border border-amber-500/30 p-4"
            >
              <p className="text-sm">
                {permission.toolCall?.title || "Agent requests permission"}
              </p>
              <div className="flex flex-wrap gap-2">
                {permission.options.map((option) => (
                  <Button
                    key={option.optionId}
                    size="sm"
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() =>
                      control("permission", permission.id, option.optionId)
                    }
                  >
                    {option.name}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {agent.queue.tasks
            .slice()
            .reverse()
            .map((task) => (
              <div
                key={task.id}
                className="space-y-2 rounded-lg border p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{task.target}</span>
                  <span className="rounded bg-muted px-2 py-1">
                    {task.state}
                  </span>
                </div>
                {task.detail && (
                  <p className="text-muted-foreground">{task.detail}</p>
                )}
                {["queued", "running", "approval"].includes(task.state) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.isPending}
                    onClick={() => control("cancel", task.id)}
                  >
                    Cancel task
                  </Button>
                )}
                {task.state === "uncertain" && (
                  <>
                    <p>
                      Inspect the working tree before acknowledging this
                      interrupted task.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => control("acknowledge", task.id)}
                    >
                      Acknowledge inspected work
                    </Button>
                  </>
                )}
              </div>
            ))}
        </>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      )}
    </div>
  );
}
