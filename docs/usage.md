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

Scroll through the entire review in one pane; files follow one another in sidebar
order. The sidebar highlights the file under the top of the pane. Its links and
the mobile file picker jump within that continuous review instead of replacing it.
Only a small window of code and notes is mounted, even for very large diffs.

Drag the vertical dividers to resize the file sidebar and conversation pane.
Focused dividers also accept arrow keys and Home/End; double-click resets that
pane's width. Widths survive reloads and hide/show toggles. Resizing keeps the
current code position and open draft; narrow screens retain the file picker and
conversation drawer.

File headers stay visible while reading their code. Collapse a file with its
chevron, or mark it **Viewed** to collapse it and record progress. A navigation jump
reopens it while keeping its viewed mark; a changed file becomes unviewed. Click a
hunk control to expand omitted context upward, downward, or all at once. The
batch size is configurable in Settings. **Fold removed lines** replaces deletions
with expandable markers; a run containing a note stays open.

Notes appear inline beside their captured code as well as in the conversation
pane. **In diff** jumps from a conversation card to that note, reopening its file.
The pane preserves your reading position when notes or code change. Incoming diff
updates wait until an open editor closes.
Captured code is always visible as an integrated diff block in each note, not
hidden behind a disclosure. Note indicators stay in a fixed gutter slot; saving
a note never shifts or inserts content into the source line.

Click code or a line number to comment immediately, drag across lines for a range,
or drag within a line to select specific characters. Shift-click extends a range;
Alt-drag keeps normal browser text selection for copying. Comments open directly
below their subject. Re-aiming an overlapping selection preserves your draft text
and caret; an unrelated click cannot replace a dirty draft. The file header offers
a file comment; **Overall note** opens an editor directly below its header button
without moving your place in the diff. Panel toggles are in the same compact header;
change counts and refresh live in the existing footer.

The editor accepts Markdown, including tables, checklists, and fenced code.
The icon toolbar offers formatting, preview, suggestions, and image attachments;
hover or focus an icon to see its label. **Suggest change** inserts a fenced replacement
for the captured lines. Use **Attach image**, paste, or drop to attach screenshots. Images
are stored beside the review and linked relatively; external images are not loaded.
Attached images have inline thumbnails, a zoom viewer, and **Draw / edit**. Drawings
retain editable shapes, text, paths, callouts and other tools when reopened. Image
diffs also support clicking or dragging a region to capture it in a comment. Audio
diffs have before/after players.

**Save note** writes immediately. With ACP configured, **Save & ask AI** also queues
that note; **Save only** persists without dispatch. Enter saves by default;
Shift+Enter inserts a newline, and Cmd/Ctrl+Enter always saves. Settings can turn
off Enter-to-save. The editor retains failed saves and drafts across reloads;
incoming live updates do not replace their text.

AI requests show queued, running, and permission/error states on their note and
in the footer. Running work includes the agent's current activity when available.
**Settings → Enable AI answers** disables new dispatches while keeping manual note
and reply saves available. Already queued or running work is not cancelled.

## Continue the conversation

The conversation pane shows notes for the selected file plus overall notes.
**All notes** includes every file, including notes whose file left the diff. Filter
by **All**, **Open**, or **Done**. Applied, answered, and skipped notes are done.

Reply under a note to follow up. Unanswered reviewer notes and replies can be
edited or deleted. Agent messages remain the agent's account. Copy a note's short
reference for use in feedback; the full stable ID is kept in the Markdown marker.
References expand in place to show their note and conversation. Type `#` in a note
or reply to search notes by reference, file, or text. Use ↑/↓ and Enter/Tab, or click
a suggestion, to insert its reference; Escape dismisses suggestions.

Ask any coding agent to address `.review/review-<timestamp>.md`. Agent messages and
statuses appear through live updates. With ACP, the footer opens the agent queue,
where you can pause/resume, answer permission requests, cancel tasks, and reconcile
interrupted work. A completed turn does not automatically mean a fix was applied.

Install the optional skill from your agent's terminal (also shown in **Settings →
Agent connection**):

```sh
npx skills add cjvnjde/local-code-review --skill apply-lcr
```

Then ask “Apply the newest lcr review” or use `/apply-lcr` if supported.

## Saved reviews and history

Each conversation has one timestamped Markdown file. Every mutation rereads that
file to retain current agent replies. Restarting adopts its conversation. **Settings
→ New review** leaves the current file in place; the saved-review list reopens it.

The header's history button opens observed review states from this browser's
append-only journal. It is read-only and can be exported as JSON. History remains
after a note is deleted; it cannot record changes while no page is listening.

## Attach on-demand context

Existing saved context links remain compatible with the `apply-lcr` skill and
`lcr context`. Web capture context bundles, selected HTML, and full-page screenshots
are enabled by default. **Settings → Capture context** can disable them; page
evidence may include sensitive content. Context stays local; use the capture's
context ID or `context/<id>/manifest.json` when asking an agent to inspect it.
**Add context** in the inline editor uploads a file or labeled text/JSON and
inserts a relative link. Its card can inspect the manifest and read text in chunks
without navigating away.

## Navigate a large review

Bookmark lines to revisit them in the sidebar. Bookmarks survive a reload within
that tab and are isolated to the current repository/read. **Resume reading** keeps
a settled manual reading position across reloads; programmatic file jumps do not
replace it. Search with Cmd/Ctrl+K across the complete review, including hidden
files and virtualized code. Results reveal their file and jump to their subject.

Alt+J/K steps through notes, Alt+Up/Down through bookmarks, and Alt+C switches the
all-notes view. J/K also steps while viewing all notes. Typing in an editor keeps
these review shortcuts inactive. Settings control automatic viewed tracking,
backtracking, file hide patterns, removed-line folding, context expansion, editor
choice, line-number gutter visibility, Enter-to-save, and earlier-review notes.
Preferences changed in Settings persist under `ui` in
`$XDG_CONFIG_HOME/lcr/config.json`, or `~/.config/lcr/config.json` when XDG is unset.
Startup options and relative ACP profile paths are retained.

**Resolve** acknowledges a completed conversation locally. **Show resolved** brings
it back, and new replies invalidate the acknowledgement automatically. It does not
change the verdict in Markdown. Notes from earlier reviews can be inspected and
continued with their original conversation retained. Deletion controls ask inline.
