# Local Code Review

Review local Git changes and annotate a running web app. Feedback stays in Markdown, ready for any coding agent.

![Git diff review with an anchored code comment](docs/local-code-review.png)

## Install

Download the [latest release](https://github.com/cjvnjde/local-code-review/releases/latest), extract it, and put `lcr` (`lcr.exe` on Windows) on your `PATH`. Git is required; no runtime or package install is needed.

On macOS, the binary is unsigned. After verifying the release checksum, remove quarantine if needed:

```sh
xattr -d com.apple.quarantine ./lcr
```

### Install or update from source

With Bun installed, run from the repository root to replace your local executable:

```sh
mkdir -p ~/.local/bin
bun build ./src/index.ts --compile --minify --outfile lcr && mv lcr ~/.local/bin/lcr
~/.local/bin/lcr --version
```

Keep `~/.local/bin` on your `PATH` to run it as `lcr`. Restart any running lcr instances to use the updated build.

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
2. **Save note** writes that note to `.review/review-<timestamp>.md` without starting an agent. The output directory is ignored by Git.
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

For smaller agent prompts, enable **Settings → AI context → Save capture context for on-demand AI reading**. The selected screenshot stays in the review; selectors, styles, and other evidence live in immutable local bundles that agents can read selectively. Selected HTML and full-document screenshots are separate opt-ins. **Formatting options → Add context** also attaches files or text/JSON to any note or reply. [Context storage and retrieval →](docs/usage.md#attach-on-demand-context)

### Choose a browser profile

| `--browser-profile` | Browser and saved state                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared` (default)  | Launch a dedicated browser with logins shared across projects and worktrees. State lives at `~/.config/lcr/browser/`, or `$XDG_CONFIG_HOME/lcr/browser/` when `XDG_CONFIG_HOME` is absolute. |
| `project`           | Launch a dedicated browser using `<output-directory>/.browser/`. Each worktree and output directory keeps separate logins. Existing profiles from older lcr builds remain here.              |
| `existing`          | Attach to your running Chrome session, using its existing logins and app state. Your personal profile is never copied into the project.                                                      |

One run can own a dedicated profile at a time. Use `project` in separate worktrees or output
directories for simultaneous dedicated browsers. Shared state also shares cookies between projects;
choose `project` when you need separate accounts.

### Use your existing Chrome session

1. Start Chrome 144 or newer and enable remote debugging at `chrome://inspect/#remote-debugging`.
2. Open your app at the exact URL you will pass to `--web`, including its path, query, and fragment.
3. Run:

   ```sh
   lcr --web http://localhost:3000 --browser-profile existing
   ```

4. Allow the connection in Chrome's dialog. lcr waits up to one minute for approval.

lcr reuses the matching tab without reloading it, preserving unfinished forms, scroll position,
and in-memory app state. If no tab matches, it opens one; if several match, close duplicates or
use a distinct URL. Each app tab can belong to one lcr review at a time. Stopping lcr removes its
overlay and leaves Chrome and all tabs open. No AI, extension, or MCP server is required.

Chrome stable's user data directory is discovered automatically. For another installation or
compatible browser, pass its user data directory, rather than its `Default` or `Profile 1` subdirectory:

```sh
lcr --web http://localhost:3000 --browser-profile existing --browser-data-dir "/path/to/browser/User Data"
```

`--no-open` defers attachment until you choose **Open page** in lcr. On macOS, your terminal may
need access to Chrome under **Privacy & Security → Files & Folders**. Approving the connection
grants debugging access to your browser; use `shared` or `project` when you prefer a dedicated
development profile. [Setup, troubleshooting, and profile safety →](docs/web-ui.md#attach-to-your-existing-browser)

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
ends. **Save note** persists without starting the agent. Without an ACP configuration, only Save is
offered. Queue state survives restarts, and permissions appear in the page's **Queue** control.
Working indicators appear beside the agent and on the active note; approval waits are shown separately.

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
    "enterSaves": true,
    "foldDel": true
  }
}
```

With this example, plain `lcr` reviews against `origin/main` without an automatic agent,
and Enter saves a note while Shift+Enter inserts a newline. The revision must exist in
the repository; lcr does not fetch it.

CLI options override configured defaults. Explicit Git arguments replace `diffArgs`;
`lcr --worktree` returns to the built-in comparison against `HEAD`. `--no-web` disables
a configured page URL, and `--open` overrides `"open": false`.

Set `"browserProfile": "existing"` to attach to your running browser by default, or `"project"`
to keep dedicated browser state in each worktree. `--browser-profile` overrides this for one run.
The optional `browserDataDir` setting selects the user data directory for existing-browser attachment;
it resolves beside `config.json`, while `--browser-data-dir` resolves from the repository root.
Both accept `~/` paths. These browser settings apply when `--web` or a configured `web` URL is used.

Configured `ui` keys apply again on every server start. Changes in the page stay in browser
storage and survive page reloads during that run; they never change the config file.
Preferences omitted from `ui` retain their existing browser persistence.
See [all configuration fields and precedence](docs/usage.md#configuration).

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

- [Review workflow and controls](docs/usage.md) — notes, images, search, history, shortcuts, and saved conversations.
- [Web annotation](docs/web-ui.md) — selection tools, drawings, before/after captures, and browser requirements.
- [Agent connections and sequential queue](docs/agent-connections.md).
- [Development](docs/development.md) — run from source, checks, and standalone builds.

## License

[MIT](LICENSE)
