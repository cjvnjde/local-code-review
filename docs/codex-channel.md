# Interactive Codex session

The Codex adapter forwards saved review feedback to an existing session with the installed
`codex queue` command. The command talks to Codex's local app server and uses the target session's
login, model, context and tool permissions. lcr has no model API client, API key, or remote endpoint.

## Setup

Use a Codex CLI that supports this command:

```sh
codex queue --help
```

Open Codex in the repository being reviewed, then run lcr in the same working copy with that
session's UUID or exact session name:

```sh
lcr --codex-thread <session-uuid> --id interactive
```

The session must be accessible to the installed CLI's local app server. Prefer the UUID when
several sessions have the same name. An isolated `--no-daemon` session or an app connected to
another server is not a target for this MVP. If you have not installed a binary containing the
adapter yet, run from source or build one:

```sh
bun ./src/index.ts --codex-thread <session-uuid> --id interactive
bun build ./src/index.ts --compile --minify --outfile /tmp/lcr
```

Normal lcr options still apply, including `--no-open`, `--out`, explicit Git diff arguments and
`--port`. `--id` names the lcr review; `--codex-thread` selects the agent conversation. They are
independent. Each lcr run targets one agent, so `--codex-thread` and `--claude-channel` cannot be
combined. Switching the agent means restarting lcr with the appropriate option.

## Use

1. Write a line, file or overall note in the review page.
2. Click **Save & ask Codex**. lcr writes Markdown first, then queues a message naming the exact
   review file and the new or changed note ids.
3. Codex reads the latest note and full conversation, answers questions, or makes requested changes.
   It updates the note's `Status:` and appends an `**Agent**` message in that note's section.
4. The page shows the answer through the existing live file updates. **Reply → Send reply** queues
   a follow-up in the same Codex session. Rewording a reviewer reply also forwards it.

The message carries pointers rather than a copy of your prose, so Codex reads corrections and
follow-ups from the file as it stands when processing begins. It names the original review even
if you open another one while Codex is working. It instructs Codex to leave deleted notes alone
and preserve every reviewer message. The optional vendor-neutral `apply-lcr` skill can be used
in the same session and does not need to change for this adapter.

Saving unchanged notes sends nothing unless a prior delivery failed. Agent answers, diff changes,
page refreshes and deletions do not generate more notifications.

## Delivery and permissions

- “Forwarded” means the CLI accepted the queue command. It does not confirm that the model has
  answered. Codex controls when queued input runs, and busy sessions can take longer.
- A queue failure does not undo the save. The page reports that the notes or reply were saved but
  could not be forwarded. Check the target session and click **Save & ask Codex** to retry. Unsent
  note pointers remain in memory, including pointers to an earlier review if you switched files.
- There is no persistent delivery queue. Restarting lcr keeps saved Markdown but loses retry state;
  send a new follow-up for a note that still needs an answer. A timeout can also be ambiguous: check
  the session before retrying to avoid submitting the same request twice.
- Tool approvals stay in Codex. This adapter does not add permission flags, change the model,
  access stored credentials, relay approvals, or launch a new agent session.
- Relative image links and note references remain in the Markdown. Codex opens the file and its
  attachments using its normal filesystem tools. Answers appear after Codex writes them; individual
  output tokens are not streamed into the web page.
- Keep lcr running for the page and live updates. Stopping lcr does not close the Codex session.

The installed command contract is documented in the official
[Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands#codex-queue).
