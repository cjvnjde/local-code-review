# Interactive Claude Code channel

This MVP connects the local review page to one running Claude Code session. Claude Code launches
lcr as an MCP stdio channel, and that same lcr process serves the web UI. It uses your existing
Claude Code login, including a subscription login; lcr has no API key, model client, or remote service.

## Setup

Build this branch, or use a binary built from it:

```sh
bun build ./src/index.ts --compile --minify --outfile /tmp/lcr
```

In the repository you want to review, register the binary with Claude Code. Replace the path below
with its absolute path (`/tmp/lcr` if you used the command above):

```sh
claude mcp add --transport stdio --scope local lcr -- /absolute/path/to/lcr --claude-channel --no-open --id interactive
```

Then start Claude Code with the custom channel enabled:

```sh
claude --dangerously-load-development-channels server:lcr
```

Accept Claude Code's local-development channel warning and MCP server consent. This flag is Claude
Code's documented way to test custom channels during the research preview; it does not skip tool
permissions. On Team or Enterprise, an organization owner must first enable channels. An administrator
can also package this integration as an approved channel plugin under the organization's policy.

Open `http://localhost:7777`. If that port was occupied, lcr uses the next available one. The exact
URL is in its startup diagnostics and in the MCP instructions Claude receives, so you can ask Claude
for the lcr URL. `--no-open` keeps MCP startup from opening a browser; leave it out to use lcr's usual
automatic browser launch.

For development without compiling, register Bun with the absolute source path instead:

```sh
claude mcp add --transport stdio --scope local lcr -- bun /absolute/path/to/local-code-review/src/index.ts --claude-channel --no-open --id interactive
```

Run Claude Code from the repository being reviewed. Channel mode honors Claude Code's
`CLAUDE_PROJECT_DIR` when set, and otherwise uses its working directory. Normal lcr options still apply: add a different
`--id`, `--out`, `--port`, or explicit Git diff arguments to the registered command when needed.

## Use

1. Write a line, file, or overall note in the review page.
2. Click **Save & ask Claude**. New and changed notes are saved to Markdown and forwarded to Claude.
3. Read Claude's answer under the note. Follow up with **Reply → Send reply** to continue immediately.

Rewording a saved reviewer reply forwards it too. Saving an unchanged review forwards nothing;
send a follow-up to ask again. Deleting a note or message does not ask Claude another question.

Claude receives the exact review filename and stable note id. The `read_note` tool gives it the
latest note, captured code, verdict and conversation. The `reply` tool appends its Markdown answer
and optionally updates the verdict. Questions use `answered`; a requested edit uses `applied` only
after the code has been changed. Answers still go to their original review if you switch reviews
while Claude is working. A deleted note is never recreated by a late answer.

The Markdown file stays the conversation: attachments, note references, statuses, ordinary agent
file edits, and the existing live updates keep their usual behavior. Closing Claude Code's connection
stops the lcr web server; saved reviews remain on disk. Do not start a second lcr process for this
same conversation while using the channel.

## MVP limits

- Claude Code must remain open with this server enabled as a channel. Registering an ordinary MCP
  server alone does not enable incoming events.
- Events are forwarded promptly. Claude Code queues events while busy and handles them on its next
  turn, so an answer is not guaranteed to start at the instant you click.
- A “Forwarded” message confirms transport forwarding, not model receipt. Claude Code can silently
  drop events when channel opt-in or organization policy is missing; check its startup channel notice
  if no answer arrives. “Queued” means lcr is waiting for the MCP initialization handshake.
- Tool permissions are answered in the Claude Code terminal. This MVP does not relay permission
  prompts into lcr or bypass approvals.
- Answers appear when Claude calls `reply`; this MVP does not stream individual output tokens.
- Notifications are held in memory until MCP initialization; there is no persistent delivery queue.
  Saved notes remain in Markdown even if the process stops before handling them.
- This adapter targets Claude Code. For an existing Codex session, use the separate
  [Codex adapter](codex-channel.md). The Markdown workflow still works with other agents.

Protocol and preview details: [Claude Code channels](https://code.claude.com/docs/en/channels) and
[building a custom channel](https://code.claude.com/docs/en/channels-reference).
