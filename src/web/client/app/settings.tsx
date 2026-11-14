import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useUi } from "./ui-preferences.tsx";
import { hidePatterns } from "../diff/filters.ts";
import { useQuery } from "@tanstack/react-query";
import { request, useAction, type AgentState } from "./api.ts";
import { Button } from "../components/ui/button.tsx";
import { Select } from "../components/ui/select.tsx";

const INSTALL_SKILL_COMMAND =
  "npx skills add cjvnjde/local-code-review --skill apply-lcr";

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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const reviews = useQuery({
    queryKey: ["reviews"],
    queryFn: () =>
      request<{
        session: string;
        reviews: { file: string; id: string; range: string; notes: number }[];
      }>("/api/reviews"),
  });
  return (
    <div className="space-y-6 overflow-auto pr-1">
      <p className="text-xs text-muted-foreground">
        Preferences are saved to your lcr config.json in the user configuration
        directory.
      </p>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Reading and editing</h3>
        {(
          [
            ["auto", "Mark files viewed as I read"],
            ["back", "Unmark automatically viewed files when scrolling back"],
            ["foldDel", "Fold removed lines by default"],
            ["enterSaves", "Enter saves · Shift+Enter inserts a newline"],
            ["lineNumbers", "Show line numbers and gutter controls"],
            ["wrapLines", "Wrap long lines"],
            ["single", "Keep one pending note per selection"],
            ["ghosts", "Show notes from other reviews"],
            ["toast", "Show reply and save notifications"],
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
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>Reading speed threshold</span>
          <Select
            label="Reading speed threshold"
            value={ui.settings.limit}
            onValueChange={(limit) => ui.update({ limit })}
            options={[0, 500, 900, 1800].map((value) => ({
              value,
              label: value ? `${value} px/s` : "No speed limit",
            }))}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>Context expansion</span>
          <Select
            label="Context expansion"
            value={ui.settings.expand}
            onValueChange={(expand) => ui.update({ expand })}
            options={[10, 20, 50, 100].map((value) => ({
              value,
              label: `${value} lines`,
            }))}
          />
        </div>
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
          Enabled by default. Captures may include sensitive page content; turn
          off any evidence you do not want saved locally.
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
              checked={ui.settings[key]}
              onChange={(event) => ui.update({ [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Agent connection</h3>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={ui.settings.aiAnswers}
            onChange={(event) => ui.update({ aiAnswers: event.target.checked })}
          />
          Enable AI answers
        </label>
        <p className="text-xs text-muted-foreground">
          When disabled, notes and replies save without asking the agent.
          Already queued or running work is not cancelled.
        </p>
        <p className="text-xs text-muted-foreground">
          {agent.connection
            ? `${agent.connection.agent}: ${agent.connection.state}. ${agent.connection.detail}`
            : "No ACP agent configured. Save notes and ask your coding agent to address the Markdown file."}
        </p>
        <AgentLaunch agent={agent} />
        <AgentSetup manual={!agent.connection} />
        <h4 className="pt-2 text-xs font-semibold">
          Install the apply-lcr skill
        </h4>
        <p className="text-xs text-muted-foreground">
          Run in your agent's terminal, then ask “Apply the newest lcr review”
          or use <code>/apply-lcr</code> if supported.
        </p>
        <div className="flex items-center border bg-muted/40">
          <pre className="min-w-0 flex-1 overflow-x-auto p-3 text-xs">
            <code>{INSTALL_SKILL_COMMAND}</code>
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="mr-1 shrink-0"
            aria-label="Copy skill installation command"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(INSTALL_SKILL_COMMAND);
                setCopyState("copied");
              } catch {
                setCopyState("error");
              }
            }}
          >
            {copyState === "copied" ? <Check /> : <Copy />}
            {copyState === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        {copyState === "error" && (
          <p role="alert" className="text-xs text-destructive">
            Could not copy. Select the command and copy it manually.
          </p>
        )}
      </section>
      {reviews.error && (
        <p role="alert" className="text-sm text-destructive">
          {reviews.error.message}
        </p>
      )}
    </div>
  );
}

function AgentLaunch({ agent }: { agent: AgentState }) {
  if (!agent.connection) return null;
  const launch = agent.connection.launch;
  return (
    <section className="space-y-2 rounded-lg border p-3 text-xs">
      <h3 className="font-semibold">Configured launch options</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>Model</dt>
        <dd className="break-words">
          {launch?.model || "Agent default / not reported"}
        </dd>
        <dt>Thinking / reasoning</dt>
        <dd className="break-words">
          {launch?.thinking || "Agent default / not reported"}
        </dd>
        <dt>Permissions</dt>
        <dd className="break-words">
          {launch?.permissions || "Agent policy / not reported"}
        </dd>
      </dl>
      <p className="text-muted-foreground">
        Explicit profile values only, not verified active-session settings.
        Inherited environment, agent defaults and restored sessions may differ.
        lcr does not read agent credentials or change models or permissions.
      </p>
    </section>
  );
}

function AgentSetup({ manual }: { manual: boolean }) {
  return (
    <details open={manual} className="rounded-lg border p-3 text-xs">
      <summary className="cursor-pointer font-semibold">
        Set up OMP or Codex · model, thinking and permissions
      </summary>
      <div className="mt-3 space-y-3">
        <p>
          Install and authenticate the agent in your terminal. Save an ACP JSON
          profile outside your review, then restart from the repository root:
        </p>
        <pre className="overflow-x-auto rounded bg-muted p-2">
          <code>lcr --acp /path/to/agent.json</code>
        </pre>
        <h4 className="font-semibold">OMP profile</h4>
        <pre className="overflow-x-auto rounded bg-muted p-2">
          <code>
            {JSON.stringify(
              {
                name: "OMP",
                command: "omp",
                args: [
                  "--model",
                  "<provider>/<model-id>",
                  "--thinking",
                  "high",
                  "acp",
                ],
              },
              null,
              2,
            )}
          </code>
        </pre>
        <p>
          Replace the model placeholder with an ID from <code>omp models</code>.
          Put launch flags before <code>acp</code>. Thinking levels depend on
          the model; check <code>omp --help</code> for your installed version.
        </p>
        <h4 className="font-semibold">Codex ACP profile</h4>
        <pre className="overflow-x-auto rounded bg-muted p-2">
          <code>
            {JSON.stringify(
              {
                name: "Codex ACP",
                command: "bunx",
                args: ["@agentclientprotocol/codex-acp@2.5.0"],
                env: {
                  CODEX_PATH: "codex",
                  CODEX_CONFIG: JSON.stringify({
                    model: "<model-id>",
                    model_reasoning_effort: "high",
                  }),
                },
              },
              null,
              2,
            )}
          </code>
        </pre>
        <p>
          Install Bun and Codex, authenticate with <code>codex login</code>, and
          replace the model placeholder with an available model.{" "}
          <code>CODEX_CONFIG</code> is a JSON-encoded string. Do not put login
          secrets in the profile.
        </p>
        <details className="space-y-2">
          <summary className="cursor-pointer font-semibold">
            Optional full permissions (dangerous)
          </summary>
          <p className="mt-2">
            Only opt in for a trusted task in an externally isolated
            environment. Untrusted repository content can influence an agent.
            These options remove approval protection; lcr never adds them
            automatically.
          </p>
          <p>
            OMP: add <code>--auto-approve</code> before <code>acp</code> in{" "}
            <code>args</code> (for example{" "}
            <code>{'["--auto-approve", "acp"]'}</code>). This skips tool
            approval prompts; it does not grant OS permissions.
          </p>
          <p>
            Codex ACP 2.5.0: add{" "}
            <code>{'"INITIAL_AGENT_MODE": "agent-full-access"'}</code> to{" "}
            <code>env</code>. This requests no approvals and the{" "}
            <code>danger-full-access</code> sandbox policy. Do not pass Codex
            CLI bypass flags to the adapter.
          </p>
        </details>
        <p>
          Finish or cancel queued work before changing profiles, then restart
          lcr. Saved sessions may retain their own settings. To use this profile
          by default, set <code>acp</code> in{" "}
          <code>~/.config/lcr/config.json</code>. Use{" "}
          <code>lcr --no-agent</code> for manual Markdown review.
        </p>
        <a
          className="underline underline-offset-2"
          href="https://github.com/cjvnjde/local-code-review/blob/v2/docs/agent-connections.md"
          target="_blank"
          rel="noreferrer"
        >
          Agent connection guide and permission references
        </a>
      </div>
    </details>
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
      <AgentLaunch agent={agent} />
      <AgentSetup manual={!agent.connection} />
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
