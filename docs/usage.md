# Review workflow

This guide describes the v2 branch. See the [README](../README.md) for installation
and [agent connections](agent-connections.md) for ACP setup.

## Choose changes

```sh
lcr                         # Working tree, staged, and untracked changes vs HEAD
lcr --staged                # Index only
lcr main...HEAD             # Committed branch changes
lcr origin/main -- src/     # Compare one path
lcr --id checkout           # Continue a named conversation
lcr --port 0 --no-open      # Pick a free port and open the printed URL manually
```

Explicit Git arguments pass through to `git diff`. A named review continues across
range or branch changes; otherwise the range, branch, and base identify it.
Settings are read from the user's XDG configuration, never a discovered repository
config. `--no-agent` bypasses the default ACP profile.

## Read and comment

Select a file from the sidebar or the mobile file picker. The viewer displays one
file at a time and mounts a small window of rows for large files. Click a hunk
header to expand omitted context. Toggle **Hide removed lines** to focus on the new
version. **Viewed** records reading progress; an updated file becomes unviewed.

Click the plus beside a line to comment immediately. To select a range, click its
first line number, Shift-click its last line number, then choose **Comment on
selection**. The file header offers a file comment; **Overall note** covers the
whole review.

The editor accepts Markdown, including tables, checklists, and fenced code.
**Preview** shows the rendered note. **Suggest change** inserts a fenced replacement
for the captured lines. Use **Image**, paste, or drop to attach screenshots. Images
are stored beside the review and linked relatively; external images are not loaded.

**Save note** writes immediately. With ACP configured, **Save & ask AI** also queues
that note; **Save only** persists without dispatch. Cmd/Ctrl+Enter performs the
primary save action. The editor retains a failed save for retry. Drafts survive a
reload in the same browser; incoming live updates do not replace their text.

## Continue the conversation

The conversation pane shows notes for the selected file plus overall notes.
**All notes** includes every file, including notes whose file left the diff. Filter
by **All**, **Open**, or **Done**. Applied, answered, and skipped notes are done.

Reply under a note to follow up. Unanswered reviewer notes and replies can be
edited or deleted. Agent messages remain the agent's account. Copy a note's short
reference for use in feedback; the full stable ID is kept in the Markdown marker.
This branch displays references as ordinary text.

Ask any coding agent to address `.review/review-<timestamp>.md`. Agent messages and
statuses appear through live updates. With ACP, the footer opens the agent queue,
where you can pause/resume, answer permission requests, cancel tasks, and reconcile
interrupted work. A completed turn does not automatically mean a fix was applied.

## Saved reviews and history

Each conversation has one timestamped Markdown file. Every mutation rereads that
file to retain current agent replies. Restarting adopts its conversation. **Settings
→ New review** leaves the current file in place; the saved-review list reopens it.

The header's history button opens observed review states from this browser's
append-only journal. It is read-only and can be exported as JSON. History remains
after a note is deleted; it cannot record changes while no page is listening.

## Attach on-demand context

Existing saved context links remain compatible with the `apply-lcr` skill and
`lcr context`. For web captures, optional settings control context bundles,
selected HTML, and full-page screenshots. Context is local evidence; use the
capture's context ID or `context/<id>/manifest.json` when asking an agent to inspect
it. The v2 editor currently offers image attachments rather than the old arbitrary
file/text context uploader.
