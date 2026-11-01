# Local Code Review

Review local Git changes and annotate a running web app. Feedback stays in Markdown, ready for any coding agent.

![Git diff review with an anchored code comment](docs/local-code-review.png)

## Install

Download the [latest release](https://github.com/cjvnjde/local-code-review/releases/latest), extract it, and put `lcr` (`lcr.exe` on Windows) on your `PATH`. Git is required; no runtime or package install is needed.

On macOS, the binary is unsigned. After verifying the release checksum, remove quarantine if needed:

```sh
xattr -d com.apple.quarantine ./lcr
```

## Review code

Run inside a Git repository:

```sh
lcr                           # Working-tree, staged, and untracked changes vs HEAD
lcr --staged                  # Staged changes only
lcr origin/main               # Compare with origin/main, including local changes
lcr main...HEAD               # Committed branch changes since the merge base with main
lcr HEAD~3                    # Compare with three commits ago
lcr -- src/                   # Limit the review to a path
lcr --id checkout              # Continue a named review, even after commits or rebases
```

The browser opens at `http://localhost:7777`; if the port is taken, lcr prints the next available address.

1. Click a line, drag a range, or select part of a line to comment. Use a file's **Comment** or the header's **Comment** for broader feedback.
2. Save notes, then **Save review** to write `.review/review-<timestamp>.md`. The output directory is ignored by Git.
3. Ask your agent to address that file. Replies and status changes appear live; keep the conversation going under each note.

## Annotate a web app

Start your app's development server, then run:

```sh
lcr --web http://localhost:3000 --id checkout-ui
lcr --web http://localhost:3000 main...HEAD  # Visual feedback alongside an explicit diff
```

![Live web annotation with a captured selection and review note](docs/web-annotation.png)

Click an element or drag an area to comment. Click the **lcr** circle to switch between annotation and normal browsing; hold **Alt** to interact temporarily. Click a capture to draw arrows, boxes, or text on it.

Visual and code notes share the same Markdown review. Captures include screenshots and element metadata; **Capture after** records the result after a fix. Requires an installed Chrome, Chromium, or Edge. [Web annotation guide →](docs/web-ui.md)

## Hand feedback to an agent

Any agent can read the review directly:

```text
Address the newest lcr review in .review/.
```

Optionally install the included skill:

```sh
npx skills add cjvnjde/local-code-review --skill apply-lcr
```

Then ask “Apply the newest lcr review” or use `/apply-lcr` if supported.

### Connect an agent

The setup below works with the downloaded `lcr` executable; no source checkout is needed.
Choose one agent and keep its credentials in its own authentication store, not in these files.
The optional agents and adapters have their own runtime requirements.

Create your user configuration directory:

```sh
lcr_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/lcr"
mkdir -p "$lcr_config_dir/agents"
```

The paths below use `~/.config/lcr`. If you set `XDG_CONFIG_HOME`, it must be an absolute path;
use `$XDG_CONFIG_HOME/lcr` instead.

#### Codex

Install [Bun](https://bun.sh/) and [Codex CLI](https://developers.openai.com/codex/cli), then
authenticate Codex by running `codex` and completing its sign-in flow.

Put this in `~/.config/lcr/agents/codex.json`:

```json
{
  "name": "Codex ACP",
  "command": "bunx",
  "args": ["@agentclientprotocol/codex-acp@2.5.0"],
  "env": {
    "CODEX_PATH": "codex"
  }
}
```

`bunx` downloads and runs the ACP adapter; `CODEX_PATH` selects your installed `codex`.
The first run needs network access to fetch the adapter.

#### Claude

Install [Node.js 22 or later](https://nodejs.org/) and
[Claude Code](https://code.claude.com/docs/en/quickstart), then run `claude` and sign in.
Install the [Claude ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp):

```sh
npm install -g @agentclientprotocol/claude-agent-acp
```

Put this in `~/.config/lcr/agents/claude.json`:

```json
{
  "name": "Claude ACP",
  "command": "claude-agent-acp",
  "args": []
}
```

Make sure `claude-agent-acp` is on your `PATH`. No Claude MCP registration or channel flag is needed.

#### OMP

Install and authenticate OMP with your chosen provider first. Its `omp` executable must be on your `PATH`.
Put this in `~/.config/lcr/agents/omp.json`:

```json
{
  "name": "OMP",
  "command": "omp",
  "args": ["acp"]
}
```

OMP provides ACP directly; no separate adapter is needed.

#### Select your default

Put this in `~/.config/lcr/config.json`, or add the `acp` field to your existing settings:

```json
{
  "acp": "agents/codex.json"
}
```

Use `"agents/claude.json"` for Claude or `"agents/omp.json"` for OMP instead. Profile paths resolve
relative to this settings file. Plain `lcr` uses whichever profile you configured; no agent is built
in as the default.

Run inside the project you want to review:

```sh
lcr                                                # Use the configured agent
lcr --acp "$lcr_config_dir/agents/omp.json" --id ui   # Override it for this run
lcr --no-agent                                     # Review manually
```

These connections start managed agent sessions; they do not attach to an already-running agent terminal.
See [ACP connections and queue](docs/agent-connections.md) for other agents, configuration fields,
permissions and restart recovery.

Saving a comment starts the selected agent; further comments queue until that turn ends. Queue state
survives restarts, and permissions appear in the page's **Queue** control.

With an ACP configuration, **Save & ask AI** saves and queues that note immediately. Without one,
**Save note** keeps the manual Markdown workflow.

## Other options

| Command | Purpose |
| --- | --- |
| `lcr --no-agent` | Review manually, ignoring the default agent |
| `lcr --no-open` | Start without opening a browser |
| `lcr --port 8080` | Choose a starting port (`0` picks a free one) |
| `lcr --out .feedback` | Change the review output directory |
| `lcr --context 8` | Show more surrounding lines |
| `lcr --help` | List options and examples |
| `lcr --version` | Print the build stamp |

Unrecognized arguments pass through to `git diff`. Working-tree comparisons include untracked files; commit-to-commit ranges do not.

## Documentation

- [Review workflow and controls](docs/usage.md) — notes, images, search, history, shortcuts, and saved conversations.
- [Web annotation](docs/web-ui.md) — selection tools, drawings, before/after captures, and browser requirements.
- [Agent connections and sequential queue](docs/agent-connections.md).
- [Development](docs/development.md) — run from source, checks, and standalone builds.

## License

[MIT](LICENSE)
