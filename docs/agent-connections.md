# Managed ACP agents and comment queue

`lcr --acp <config.json>` runs an externally installed, authenticated ACP agent or adapter as a
subprocess. lcr owns a persistent FIFO queue and waits for each prompt turn to finish before starting
another. Saving a note starts its work immediately; later comments wait instead of steering or
interrupting that turn. Without a configured agent, manual Markdown review still works.
`--no-agent` always offers a manual run.

## Configure and select an agent

Start with the repository's [Codex](../examples/agents/codex.json) or [OMP](../examples/agents/omp.json)
profile, or create a JSON file outside the files you intend to review:

```json
{
  "name": "My coding agent",
  "command": "/absolute/path/to/agent-acp",
  "args": []
}
```

Run from the repository root:

```sh
lcr --acp /path/to/agent.json --id checkout
```

The name is a display label, not a vendor identifier. Any executable implementing stable ACP v1 over
newline-delimited JSON-RPC on stdio can be selected. `command` is a single executable; `args` is a
string array, with no shell evaluation. Optional `env` is a string-to-string object merged into the
inherited environment. Install and authenticate the agent yourself. lcr never installs an adapter,
reads login secrets, selects a model, or adds permission-bypass flags. Keep credentials out of config
files; use the agent's own authenticated environment. Explicit `--acp` paths are resolved from the
repository root; defaults resolve beside the user settings. Switching agents means restarting lcr
with another config.

For example, use an installed `codex-acp` or `claude-agent-acp` executable as `command`. See the official
[Codex adapter](https://github.com/agentclientprotocol/codex-acp),
[Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp), and
[ACP agent list](https://agentclientprotocol.com/get-started/agents) for installation and authentication.
The standalone lcr binary includes its transport and scheduler; no SDK, runtime package dependency,
or application changes are required. The external agent executable is still required.

ACP creates or loads sessions it manages. It does **not** attach to an arbitrary running terminal.
ACP is the only automatic connection mode; the old agent-specific attachment flags and bridges have
been removed. An agent operating manually can still read and answer the Markdown review directly.

### Default agent for all repositories

Keep profiles in `~/.config/lcr/agents/`, then select one in `~/.config/lcr/config.json`:

```json
{
  "acp": "agents/omp.json"
}
```

With that setting, plain `lcr` starts the selected agent connection and comment queue. If
`XDG_CONFIG_HOME` is an absolute path, settings live at `$XDG_CONFIG_HOME/lcr/config.json` instead.
Profile paths in settings resolve relative to `config.json`; absolute paths and `~/` paths also work.
Only user settings are discovered automatically; repository files never select an executable by themselves.

An explicit `lcr --acp /path/to/another-agent.json` overrides the default. `lcr --no-agent` bypasses user
settings and keeps the review manual. When both flags are given, the last one wins. Set `"acp": null`
or remove the setting to disable the default globally. A missing settings file also means manual mode.
Invalid settings or a missing configured profile produce an error; `--no-agent` and explicit `--acp`
remain available to bypass a broken default. `--help` and `--version` never read user settings.

## Using the queue

- **Save & ask AI** saves only that note and durably accepts its task before dispatch. A configured
  managed queue accepts work while paused or disconnected, so an unavailable agent does not lose it.
- New notes run FIFO. Rewording a queued note updates its pending task without moving it. An edit or
  reviewer follow-up to running work becomes subsequent work. Reviewer reply withdrawal revises pending
  work without starting a new task. An unchanged save does not repeat a completed task.
- Each task records an id, exact absolute review filename, stable note id, submitted reviewer revision,
  submitted content, target configuration, session key/id, and execution state. At execution lcr reads
  the current thread but keeps the accepted reviewer revision. Later edits are never represented as
  already processed. Agent messages, verdict changes, file events, reloads and diff updates enqueue nothing.
- Removing a pending note cancels its work. Removing a running note requests cancellation and pauses
  the queue. Returned messages go through an existence check and cannot recreate a deleted note.
  Starting or opening another review retains queued tasks and routes each answer to its original file.
- The header's **Queue** control shows tasks across reviews, working/approval/error states and exact
  note ids. Note badges show execution state separately from Markdown verdicts. **Pause queue** lets
  the current turn finish and prevents the next turn. **Cancel** cancels pending work or requests an
  active stop, retaining the execution slot until ACP confirms the turn has stopped.
- Permission requests show the agent's tool details and exact choices in **Queue**. Only an explicit
  reviewer choice is sent back. Cancellation answers outstanding permission requests as cancelled.
  lcr neither implements unadvertised filesystem/terminal RPCs nor escalates an agent's permissions.

A normal `end_turn` means **completed**, not “fix applied.” The agent is asked for a final JSON response
containing its own verdict and Markdown answer. lcr appends that answer in the original note's thread.
Plain Markdown responses are also kept but do not set a verdict. Only a recognized, explicit agent
verdict on an unchanged submitted revision can update `Status:`. When a reviewer edits during a turn,
its reply is labelled as answering the earlier revision and leaves the current verdict alone.
`needs-input` pauses the queue; refusal, token/turn limits and unknown stop reasons are **blocked**.
Setup/authentication failures are **error**. Transport failure after prompt dispatch is **uncertain**,
because tools might already have run. Agent tool progress is visible while working; completed replies
use the normal live Markdown update path. Individual response tokens are not rendered as note replies.

## Persistence, restart and recovery

State is private to the working tree under `git rev-parse --git-path lcr-managed`, outside the reviewed
output directory. Writes use an atomic rename and file fsync before dispatch, plus directory fsync on POSIX. A storage failure stops
further dispatch. A lifetime owner lock prevents two managed lcr runs from working on the same tree,
even on different ports or output directories. The queue cannot serialize manual agents working independently on that tree.

On a clean restart, queued tasks resume with their saved pause state. lcr reuses one agent session per
exact review and target configuration. It calls `session/load` only when the agent advertises support.
If loading is unsupported or fails, work pauses with an error. **Use a new session for later tasks**
explicitly abandons the saved session mapping; a follow-up or **Ask AI** can submit the failed work again.
Changing a configuration, including its environment, changes its target fingerprint; queued work is
never silently moved to the new agent. Restart with the original config or cancel those tasks.

A task left running or waiting for approval becomes **uncertain** on restart. It is never automatically
re-executed, and blocks further dispatch until inspected. Check the working tree, review thread and
agent/tool processes, then use **I inspected this work; do not replay**. This acknowledges the ambiguity
without resubmitting it. Resume the queue explicitly afterwards. If work remains, send a follow-up
stating what is still needed. There is no exactly-once execution guarantee across crashes.

If the review server cannot start, lcr releases its queue lock and closes startup resources. Fix the
port or server error and retry; a normal bind failure does not require lock-file recovery.

A hard crash can leave `owner.lock` in that directory. Its JSON records the owner pid and start time.
Only after verifying that the owner **and its agent/tool processes** have stopped, remove that exact
lock file and restart with the same configuration. Do not delete `queue.json`: it holds the recovery
record. Invalid state is preserved and startup fails instead of silently starting an empty queue.
Stopping lcr terminates its managed subprocess; detached agent tools may need separate inspection.
If an agent never acknowledges cancellation, stop lcr and reconcile the resulting uncertain task.

Agents retain their own filesystem tools and security policy. lcr requests that managed agents leave
review Markdown writes to lcr, which performs safe reply routing; it is not a filesystem sandbox for
an independently installed executable. Images and screenshots remain relative links beside the review.
The prompt uses universally supported text content with those exact paths, so it does not send
unsupported image/audio/embedded-resource blocks. Agents need their own tools to inspect those images.

## Protocol and verification

The implementation follows stable ACP v1
[initialization](https://agentclientprotocol.com/protocol/v1/initialization),
[session setup](https://agentclientprotocol.com/protocol/v1/session-setup),
[prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn), and
[tool permissions](https://agentclientprotocol.com/protocol/v1/tool-calls).
It does not use steering, resumable prompt execution, remote transports, or draft extensions.
Authentication is external: an `auth_required` setup error is shown for the user to resolve in the agent.

Regression tests use a deterministic stdio protocol peer to exercise queue transitions and failures.
That fixture is not real-agent integration proof. See the change's validation report for the actual
installed adapter/model and browser smoke checks run in its environment.

### Verification for build 2026-11-01.1

The commands below record that build's layout; the browser workflow now lives at
`src/web-review/browser.test.ts`.

Validated on macOS with Bun 1.4.4:

- `bun test ./src`: 706 passed; the one opt-in browser test skipped by default.
- `LCR_TEST_BROWSER=1 bun test ./src/web-review-browser.test.ts`: that browser test passed separately
  (103 assertions), covering shared visual/diff editors, screenshots, attachments, replies and references.
- `bun build ./src/index.ts --target=bun --outdir /tmp/lcr-check` and
  `bun build ./src/index.ts --compile --minify --outfile /tmp/lcr`: passed.
- A compiled-binary/headless-Chrome smoke used a temporary Git repository containing modified,
  staged, added, deleted and untracked files. Two comments were saved through the UI; the second
  remained queued, both permission choices were made through the UI, both replies appeared live,
  and the browser reported no runtime exceptions.
- A real external `@agentclientprotocol/codex-acp` 2.5.0 adapter used installed Codex CLI 0.166.0
  with its existing ChatGPT authentication. An actual prompt read a temporary repository's file,
  returned the correct exported name/value, ended with `end_turn`, and reached Markdown as an
  `answered` reply. A second real-agent scenario queued an edit and a follow-up question: Codex
  changed the temporary file's constant from `734` to `735`, then read back `735` in the next task.
  Both tasks reused one session; the second started after the first's recorded completion. Their
  explicit verdicts reached Markdown as `applied` and `answered`. File content was checked independently.
  The model was the agent's configured default and was not independently recorded.

Real-agent approval rejection, cancellation, crash recovery and session restoration were not exercised:
those scheduler paths use deterministic protocol tests. No real Claude ACP run or Windows/Linux
runtime check was performed. No
executables, generated reviews, adapter packages or browser profiles are included in this change.

### Verification for build 2026-11-01.2

Agent-specific attachment implementations, CLI options, IPC bridges and setup guides were removed.
ACP is now the sole automatic connection; the manual Markdown workflow remains available.

- `bun test ./src`: 677 passed, with the opt-in browser test skipped by default. Startup regressions
  verify that removed options are absent from help and fail without starting a review server.
- The opt-in browser regression passed separately (103 assertions), and both Bun build commands above passed.
- The compiled ACP queue UI smoke again completed two sequential comments through explicit approval
  choices, with live replies and no browser runtime exceptions.
- A separate compiled manual UI smoke showed **Save note**, saved through **Save review**, exposed no
  agent or queue, and ignored the obsolete bridge-specific project environment variable.

The real-agent integration record above belongs to build 2026-11-01.1; it was not repeated for this removal.

### Verification for build 2026-11-01.3

- `bun test ./src`: 687 passed; the opt-in browser test skipped by default. Added regressions cover
  XDG lookup, profile paths across repositories, overrides, manual opt-out, invalid settings, and
  help/version remaining independent of configuration. Default startup never submits a model prompt.
- Both Bun build commands above passed. The compiled browser smoke selected its profile through user
  settings without `--acp`, completed two sequential comments with explicit approvals, and showed
  live replies without browser runtime exceptions.
- The installed binary selected the existing OMP profile automatically and reached **OMP ready**;
  `--no-agent` returned to manual review. This installed-default check submitted no model prompt.
