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
File visibility controls appear on row hover or keyboard focus without reserving
a separate column.

Drag the vertical dividers or their full grip handles to resize the file sidebar
and conversation pane. Focused dividers also accept arrow keys and Home/End;
double-click resets that pane's width. Widths and panel visibility survive reloads
and hide/show toggles. Resizing keeps the current code position and open draft;
narrow screens retain the file picker and conversation drawer.
The diff yields space to either divider instead of locking sidebar growth behind
a fixed minimum diff width.

The right sidebar has **Notes** and **Bookmarks** tabs. Bookmark a code line from
its gutter; use the Bookmarks tab or Alt ↑/↓ to return to saved places. Switching
tabs keeps conversation drafts and list positions intact.

Panel toggles and newly arriving notes/replies use brief, subtle animations.
Dragging stays immediate; reduced-motion preferences disable these animations.

File headers stay visible while reading their code. Their history badge opens
earlier-review notes without adding another header row. Collapse a file with its
chevron, or mark it **Viewed** to collapse it and record progress. A navigation jump
reopens it while keeping its viewed mark; a changed file becomes unviewed. Gutter
arrows reveal omitted context above or below. Middle gaps offer both directions,
or one unfold control when the batches would meet. The batch size is configurable
in Settings. The file header's **Fold removed lines**
button replaces deletions with expandable markers; a run containing a note stays open.

Notes appear inline beside their captured code as well as in the conversation
pane. **In diff** jumps from a conversation card to that note, reopening its file.
The pane preserves your reading position when notes or code change. Incoming diff
updates wait until an open editor closes.
Captured code is always visible as an integrated diff block in each note, not
hidden behind a disclosure. Note indicators stay in a fixed gutter slot; saving
a note never shifts or inserts content into the source line.
Line-number columns fit the largest old/new line numbers in each file, including
rows outside the virtualized viewport. They grow when expanded context needs more digits.
Long code lines wrap by default. Disable **Settings → Wrap long lines** for
single-line reading; horizontal scrolling then belongs to each file's code only.
File headers, comments, and the rest of the review stay fixed horizontally.

Hover over code to highlight a commentable row and show its gutter affordance.
Click code or a line number to comment immediately, drag across lines for a range,
or drag within a line to select specific characters. Shift-click extends a range;
Alt-drag keeps normal browser text selection for copying. Comments open directly
below their subject in a compact bordered card with a distinct input background.
New, editing, and saved notes share the same card, identity header, and captured-code
spacing. File-level draft cards keep those same bounds while pinned below a header.
**Cancel** clears the selected-line highlight. Re-aiming an overlapping selection
preserves your draft text and caret; an unrelated click cannot replace a dirty
draft. The file header offers a file comment; while creating it, the editor stays
below that file's pinned header as you scroll. Saved file notes, edits, replies,
and line comments scroll normally. **Overall note** toggles an editor directly
below its header button without moving your place in the diff.
Clicking or focusing elsewhere dismisses it;
reopening restores the unsaved draft. Reloading retains that draft but leaves the
popup closed until you click **Overall note**. Panel toggles sit at the two ends of
the same compact header; change counts and refresh live in the existing footer.

The editor accepts Markdown, including tables, checklists, and fenced code.
Typed line breaks remain visible in previews, saved notes, and replies.
The icon toolbar offers formatting, preview, suggestions, and file attachments;
hover or focus an icon to see its label. **Suggest change** inserts a fenced replacement
for the captured lines. Drop or paste files, or use **Attach file**, to attach them
directly to a note or reply (up to 12 MiB each). Files are kept beside the review
and linked relatively; external images are not loaded.
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

Bottom-right notifications announce new agent replies and offer **View** to jump
to the note; existing replies are not announced when opening a review. Successful
note/reply saves stay silent. Disable reply notifications with **Settings → Show
new agent reply notifications**. Failed actions still report errors.

## Continue the conversation

The conversation pane shows notes for the selected file plus overall notes.
**All notes** includes every file, including notes whose file left the diff. Filter
by **All**, **Open**, or **Done**. The view and filter survive reloads. Applied,
answered, and skipped notes are done.

Use **Cards / List** to toggle a compact Conversation list of paths and note
previews. Clicking a listed file note jumps to its diff location, reopening hidden
or viewed files. Overall notes and notes whose files left the diff open their
conversation instead. The view survives reloads; finish an open conversation editor
before switching views.

Reply under a note to follow up. Note actions share a footer below the entire
conversation, so replies never leave Resolve, Remove, or Ask AI in the middle.
Unanswered reviewer notes and replies can be edited or deleted. Agent messages
remain the agent's account. Copy a note's short reference beside its path in the
header for use in feedback; the full stable ID is kept in the Markdown marker.
References expand in place to show their note and conversation. Type `#` in a note
or reply to search notes by reference, file, or text. Use ↑/↓ and Enter/Tab, or click
a suggestion, to insert its reference; Escape dismisses suggestions. Type `@` to
fuzzy-search reviewed files by path or filename, never their contents. Selecting
a file inserts a Markdown reference that navigates to it, including hidden files.

Ask any coding agent to address `.review/review-<timestamp>.md`. Agent messages and
statuses appear through live updates, including replies written before a newly
created review directory is watched. With ACP, the footer opens the agent queue,
where you can pause/resume, answer permission requests, cancel tasks, and reconcile
interrupted work. A completed turn does not automatically mean a fix was applied.

Without an agent, **Set up agent** in the footer opens launch instructions.
**Settings → Agent connection** also explains OMP/Codex profiles, permissions,
model, and thinking settings. See [agent connections](agent-connections.md) for
profile examples and restart requirements.

Install the optional skill from your agent's terminal (also shown in **Settings →
Agent connection**, with a **Copy** button for the installation command):

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
Previously saved context cards can still inspect their manifests and read text in
chunks. New arbitrary-file attachments use ordinary relative links instead of a
separate context form.

## Navigate a large review

Bookmark lines to revisit them in the sidebar. Bookmarks survive a reload within
that tab and are isolated to the current repository/read. The sidebar's progress
block shows the saved reading file; click it to return to that position, or hover
or focus it to see the viewed percentage and full file path. The settled manual
reading position stays in this browser across reloads; programmatic file jumps do
not replace it. The centered header search (Cmd/Ctrl+K) fuzzy-searches the complete
review: filenames, hidden and virtualized code, notes, replies, and captured context.
Typing shows inline suggestions without replacing the diff. Click a suggestion
to reveal its file and jump to its subject. Enter opens advanced search with
result-type filters; its top-right × or Escape closes it.

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
