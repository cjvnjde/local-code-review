# Interactive Claude Code channel

The globally registered MCP process is a lightweight bridge. It waits for a review you start
explicitly and never opens a browser or starts the review web server when Claude starts.
You choose the diff through the usual lcr command.

## Register once, globally

Build or install a current binary, then register its absolute path:

```sh
claude mcp add --transport stdio --scope user lcr -- /absolute/path/to/lcr --claude-channel
```

This makes the bridge available across repositories. If an earlier local registration exists in
a repository, it overrides the global one; remove that local entry there with:

```sh
claude mcp remove lcr --scope local
```

An existing global entry pointing to the same binary with `--claude-channel` keeps working after
updating the binary. Extra lcr review settings in that old entry do not choose the review any more;
the manually started lcr owns those settings. Restart Claude Code once after upgrading.

For source development, register `bun /absolute/path/to/src/index.ts --claude-channel` instead.

## Start each review with its diff

In one terminal, start lcr in the repository with whichever arguments you need:

```sh
lcr origin/main
```

Other examples work the same way:

```sh
lcr HEAD~3
lcr main...HEAD --id auth-review
lcr --staged --out .feedback --port 8080
```

In another terminal in the same repository, launch Claude Code with the bridge enabled:

```sh
claude --dangerously-load-development-channels server:lcr
```

Accept Claude Code's local-development channel warning and MCP consent. This is Claude Code's
documented preview flag for a custom channel; it does not bypass tool permissions. Team and
Enterprise organizations must enable channels through their organization settings first.

You can start Claude or lcr first. The bridge connects when both are running. It uses
`CLAUDE_PROJECT_DIR` to find Claude's repository and a private local IPC connection to find its
review. The web port, diff range and review output directory come from your lcr command.

The page opens when you start lcr, unless you use `--no-open`. The header first shows **Claude
checking**. lcr pushes a connection probe and Claude calls `channel_ready` with the token it received.
This one-time acknowledgement can require a model turn and normal tool permission in Claude's
terminal. It proves the pushed event reached Claude; a plain MCP connection cannot establish that.

After confirmation, the header shows **Claude ready** and the note editor's own button becomes
**Save & ask AI**. Write a note and save it there: that note is immediately written to Markdown
and forwarded, without clicking the review-wide footer. An open editor updates its button when
connection status changes. **Reply → Send reply** continues the conversation. Saved notes also have
an **Ask AI** action for explicitly sending them again.

If the probe is not acknowledged, the header stays checking and then reports unavailable. Claude
may be busy, waiting for permission, missing the channel flag, or blocked by organization policy;
lcr cannot distinguish those causes from silent event dropping. The editor says **Save note** and
does not claim automatic delivery. Notes remain available through the ordinary manual workflow.

## Conversations and lifecycle

- New or changed notes and sent or reworded reviewer replies are forwarded. Saving unchanged notes,
  agent answers, diff refreshes and deletions do not wake Claude again.
- Claude receives the exact review filename and stable note id. `read_note` reads the current note
  and full thread; `reply` appends the answer and optionally updates its verdict. Answers remain
  in their original review if you switch reviews while Claude is working.
- Questions use `answered`; requested edits use `applied` after the code changes. Deleted notes
  are not recreated by late answers. Attachments and note references keep their Markdown format.
- Closing Claude disconnects the bridge but leaves lcr and its page running. Closing lcr leaves
  Claude running; the bridge waits and reconnects when you start another review in that repository.
- Only one lcr review and one confirmed Claude session can be linked per repository at a time. An
  unconfirmed bridge cannot claim the review ahead of a session that acknowledges its probe. The
  first session to confirm owns the link; this still is not an explicit session picker. Another lcr
  instance still serves its own diff independently and does not take over the linked review.
  Close the earlier lcr and restart the one you want to link when switching between instances.
- Different repositories have independent links and review files. No repository path or IPC
  endpoint is used as a public network service.

## MVP limits

- Claude Code must run with the channel enabled. Ordinary MCP registration alone does not opt in
  to incoming messages. Probe acknowledgement verifies the connection at that moment; it is not a
  continuous guarantee that every later message is processed. “Forwarded” confirms transport forwarding; Claude Code
  can silently drop events when channel opt-in or organization policy is missing.
- A busy Claude session handles queued events on its next turn. Answers appear when it calls
  `reply`; individual output tokens are not streamed into lcr.
- Tool permission prompts stay in Claude Code's terminal. The bridge does not relay or bypass them.
- Feedback saved before a bridge connects remains ordinary Markdown and is not sent retroactively.
  Once connected, send a follow-up to ask about an already saved note.
- Connection loss during a tool call can be ambiguous. Check the note before retrying an answer
  that may already have reached disk. There is no persistent notification queue.

For an existing Codex session, use the separate [Codex adapter](codex-channel.md). The optional
vendor-neutral skill and ordinary Markdown workflow work as before.

Protocol details: [Claude Code channels](https://code.claude.com/docs/en/channels) and
[custom channels](https://code.claude.com/docs/en/channels-reference).
