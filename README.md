# Local Code Review

Review local Git changes and annotate a running web app. Feedback stays in Markdown, ready for any coding agent.

This `v2` branch experiments with React, Tailwind, Base UI primitives, TanStack
Query/Virtual, Konva/react-konva, react-markdown, highlight.js, and jsdiff. It replaces the handwritten
browser UI while keeping the terminal CLI and standalone executable. See
[development](docs/development.md) for the architecture and current feature scope.
The screenshots and older releases on the default branch show the previous UI.

## Install

Each release contains one standalone executable, compiled and minified with Bun, with the browser assets embedded. Git is required to review code; Bun and Node.js are not required to run the downloaded executable.

### Install with mise

With [mise installed and activated in your shell](https://mise.jdx.dev/getting-started.html), install globally:

```sh
mise use -g github:cjvnjde/local-code-review@latest
lcr --version
```

Mise downloads the archive for your platform from GitHub Releases, verifies its checksum, and makes `lcr` available on your `PATH`. Releases cover Linux x64/ARM64, macOS x64/ARM64, and Windows x64. The full `github:cjvnjde/local-code-review` identifier works without a registry entry or a custom plugin. See the [mise GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html).

Update to the latest release:

```sh
mise upgrade github:cjvnjde/local-code-review
```

To pin a release for a project, run this in that project's directory:

```sh
mise use github:cjvnjde/local-code-review@1.9.0
```

This writes the version to `mise.toml`; others can run `mise install` to install it. The version is the release tag without its leading `v`. `lcr --version` prints the executable's source build stamp, which is separate from the release version.

If you previously installed `lcr` in `~/.local/bin`, check `which lcr` (or `where.exe lcr` on Windows) after switching. An older executable earlier on `PATH` can still take precedence. `mise exec github:cjvnjde/local-code-review@latest -- lcr --version` explicitly runs the mise-managed version. Restart running lcr instances after updating.

### Download directly

Download the [latest release](https://github.com/cjvnjde/local-code-review/releases/latest), extract it, and put `lcr` (`lcr.exe` on Windows) on your `PATH`. Each archive contains just that executable; a matching `.sha256` file is published alongside it.

On macOS, the binary is unsigned. After verifying the release checksum, remove quarantine if needed:

```sh
xattr -d com.apple.quarantine ./lcr
```

### Install or update from source

With Bun installed, run from the repository root to replace your local executable:

```sh
bun install --frozen-lockfile
bun run build
mkdir -p ~/.local/bin
mv lcr ~/.local/bin/lcr
~/.local/bin/lcr --version
```

Keep `~/.local/bin` on your `PATH` to run it as `lcr`. Restart any running lcr instances to use the updated build.

To name the executable `lcr2`, use `bun run build -- --outfile lcr2`.
The build script compiles Tailwind CSS before embedding the browser assets. Direct
`bun build ./src/index.ts --compile` skips the Tailwind plugin, causing CSS warnings
and missing styles. The output remains one standalone executable.

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

1. Select a file, then click the plus beside a code line. Click a line number and Shift-click another to comment on a range. Use the file header or **Overall note** for broader feedback.
2. **Save note** writes that note to `.review/review-<timestamp>.md` without starting an agent. The output directory is ignored by Git.
3. Ask your agent to address that file. Replies and status changes appear live; keep the conversation going under each note.

## Annotate a web app

```sh
lcr --web http://localhost:3000 --id checkout-ui
```

Select an element or area in the running app and write feedback in the embedded
React editor. Captures and code notes share one Markdown conversation. Requires
installed Chrome, Chromium, or Edge. See the [web capture guide](docs/web-ui.md)
for profiles, existing-browser attachment, and capture context.

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

Copy the shell block for your agent into a terminal. Each block creates its configuration directory
and writes the profile file, replacing that profile if it already exists. These commands work in
POSIX shells on macOS and Linux and respect `XDG_CONFIG_HOME`, which must be an absolute path if set.

#### Codex

Install [Bun](https://bun.sh/) and [Codex CLI](https://developers.openai.com/codex/cli), then
authenticate Codex by running `codex` and completing its sign-in flow.

Create the Codex profile:

```sh
lcr_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/lcr"
mkdir -p "$lcr_config_dir/agents" &&
cat > "$lcr_config_dir/agents/codex.json" <<'JSON'
{
  "name": "Codex ACP",
  "command": "bunx",
  "args": ["@agentclientprotocol/codex-acp@2.5.0"],
  "env": {
    "CODEX_PATH": "codex"
  }
}
JSON
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

Create the Claude profile:

```sh
lcr_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/lcr"
mkdir -p "$lcr_config_dir/agents" &&
cat > "$lcr_config_dir/agents/claude.json" <<'JSON'
{
  "name": "Claude ACP",
  "command": "claude-agent-acp",
  "args": []
}
JSON
```

Make sure `claude-agent-acp` is on your `PATH`. No Claude MCP registration or channel flag is needed.

#### OMP

Install and authenticate OMP with your chosen provider first. Its `omp` executable must be on your `PATH`.
Create the OMP profile:

```sh
lcr_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/lcr"
mkdir -p "$lcr_config_dir/agents" &&
cat > "$lcr_config_dir/agents/omp.json" <<'JSON'
{
  "name": "OMP",
  "command": "omp",
  "args": ["acp"]
}
JSON
```

OMP provides ACP directly; no separate adapter is needed.

Choose OMP's model and thinking level through its profile's `args`, for example
`["--model", "<provider>/<model-id>", "--thinking", "high", "acp"]`.
Replace the model placeholder with an ID from `omp models`. lcr does not have a model picker;
each adapter owns these options. See [model and thinking configuration](docs/agent-connections.md#model-and-thinking-level).

#### Select your default

Copy this block to select Codex, preserving any other settings in `config.json`. It uses Bun or
Node.js from your `PATH`. For Claude or OMP, change the first line to `LCR_PROFILE=agents/claude.json`
or `LCR_PROFILE=agents/omp.json`.

```sh
LCR_PROFILE=agents/codex.json \
"$(command -v bun || command -v node)" -e '
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, ".config");
if (!path.isAbsolute(base)) throw new Error("XDG_CONFIG_HOME must be an absolute path");
const directory = path.join(base, "lcr");
const file = path.join(directory, "config.json");
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(file, JSON.stringify({ ...settings, acp: process.env.LCR_PROFILE }, null, 2) + "\n");
'
```

Profile paths resolve relative to this settings file. Plain `lcr` uses whichever profile you
configured; no agent is built in as the default.

Run inside the project you want to review:

```sh
lcr                                                # Use the configured agent
lcr --acp "${XDG_CONFIG_HOME:-$HOME/.config}/lcr/agents/omp.json" --id ui  # Override for this run
lcr --no-agent                                     # Review manually
```

These connections start managed agent sessions; they do not attach to an already-running agent terminal.
See [ACP connections and queue](docs/agent-connections.md) for other agents, configuration fields,
permissions and restart recovery.

**Save & ask AI** saves a comment and queues the selected agent; further requests wait until that turn
ends. **Save only** persists without starting the agent. Without an ACP configuration, the editor offers **Save note**. Queue state survives restarts, and permissions appear in the footer's agent queue.
Queue entries report work and approval states separately from note verdicts.

## Default settings

Use `~/.config/lcr/config.json`, or `$XDG_CONFIG_HOME/lcr/config.json` when
`XDG_CONFIG_HOME` is absolute, for startup and page defaults:

```json
{
  "acp": null,
  "diffArgs": ["origin/main"],
  "port": 7777,
  "open": true,
  "context": 8,
  "browserProfile": "shared",
  "ui": {
    "aiContext": true
  }
}
```

With this example, plain `lcr` reviews against `origin/main` without an automatic
agent and enables on-demand capture context. The revision must exist in the
repository; lcr does not fetch it.

CLI options override configured defaults. Explicit Git arguments replace `diffArgs`;
`lcr --worktree` returns to the built-in comparison against `HEAD`. `--no-web` disables
a configured page URL, and `--open` overrides `"open": false`.

Set `"browserProfile": "existing"` to attach to your running browser by default, or `"project"`
to keep dedicated browser state in each worktree. `--browser-profile` overrides this for one run.
The optional `browserDataDir` setting selects the user data directory for existing-browser attachment;
it resolves beside `config.json`, while `--browser-data-dir` resolves from the repository root.
Both accept `~/` paths. These browser settings apply when `--web` or a configured `web` URL is used.

Settings changes persist in `lcr/config.json` under that configuration directory,
preserving startup options and agent profile paths. **Enable AI answers** turns
new AI dispatches on or off without cancelling existing queued/running work.
Theme, panel visibility, viewed marks, and drafts remain browser-local.

## Other options

| Command               | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `lcr --no-agent`      | Review manually, ignoring the default agent   |
| `lcr --no-open`       | Start without opening a browser               |
| `lcr --port 8080`     | Choose a starting port (`0` picks a free one) |
| `lcr --out .feedback` | Change the review output directory            |
| `lcr --context 8`     | Show more surrounding lines                   |
| `lcr --help`          | List options and examples                     |
| `lcr --version`       | Print the build stamp                         |

Unrecognized arguments pass through to `git diff`. Working-tree comparisons include untracked files; commit-to-commit ranges do not.

## Documentation

- [Review workflow and controls](docs/usage.md) — notes, images, history, and saved conversations.
- [Web annotation](docs/web-ui.md) — page selections, captured evidence, and browser requirements.
- [Agent connections and sequential queue](docs/agent-connections.md).
- [Development](docs/development.md) — run from source, checks, and standalone builds.

## License

[MIT](LICENSE)
