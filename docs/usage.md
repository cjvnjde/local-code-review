# Review workflow and controls

For installation and common commands, see the [README](../README.md). For a running app, see [web annotation](web-ui.md).

## Choose what to review

Run `lcr` inside a Git repository. By default it compares working-tree, staged, and untracked changes with `HEAD`, including files created after startup. An explicit working-tree comparison such as `lcr origin/main` also includes untracked files. Commit-to-commit ranges such as `lcr main...HEAD` stay revision-only.

Arguments lcr does not recognize go to `git diff`. Use `--` before paths that could be interpreted as options. Invalid options, revisions, or paths fail before a server or browser starts.

The default address is `http://localhost:7777`. If the port is occupied, lcr tries the next ports and prints the address it actually uses. `--port 0` asks the operating system for a free port. `--no-open` leaves the server running without opening a browser.

## Write and save notes

- **Line or range:** click a diff line, drag across lines, or select part of one line. Selecting inside an already selected line narrows or re-picks its character range; clicking the row returns to the whole line. An overlapping selection re-aims an unsaved draft without losing its text.
- **Copy code:** hold Alt/Option while dragging to select ordinary text without opening a note.
- **Whole file:** use **Comment** in the file header, including on a binary or collapsed file.
- **Overall:** use **Comment** in the permanent page header for feedback without a file anchor. A review can have several overall notes.
- **Replacement:** insert a fenced `suggestion` block seeded from the selected lines. The page displays its difference from the captured code; the Markdown contains the replacement itself.

Only one editor opens at a time. An editor with text keeps focus when you try to start another; an untouched draft can move to the next selection. Live replies update notes in place. A changed diff waits while an editor is open; the header's `diff changed` indicator lets you choose an early refresh after confirmation.

Save notes, then choose **Save review**. The review is written to `.review/review-<timestamp>.md`; subsequent saves update that conversation rather than creating another file. The default directory is ignored by Git. Custom relative output directories set with `--out` are locally excluded too.

With an [ACP agent configured](agent-connections.md), an editor's **Save & ask AI** persists and queues only that note immediately, even while the agent is disconnected or the queue is paused. The review-wide footer is not a required send step. Without an ACP configuration, the action remains **Save note** for manual handover.

## Continue the conversation

Give the Markdown file to any coding agent, or use the optional [`apply-lcr` skill](../skills/apply-lcr/SKILL.md):

```sh
npx skills add cjvnjde/local-code-review --skill apply-lcr
```

Ask “Apply the newest lcr review,” or use `/apply-lcr` when supported. The skill handles code and visual feedback, replies in the review file, runs project checks, and picks up follow-ups. Framework/source metadata are hints, not prerequisites.

The page follows the agent's replies, status changes, and code edits. **Reply** under a note to answer back in the same file. With a live connection, sending or rewording a reply forwards the follow-up too. Your own stamped replies can be edited or deleted; agent messages remain read-only.

A note's `Status:` can be pending, applied, answered, skipped, needs-input, or unknown. **Answered** means a question needed no code edit; it is not included in **Remove N applied**.

Answered notes offer **Resolve**, which hides the conversation from the diff, note lists, and search without deleting it from Markdown. **Show resolved** in the footer reveals hidden conversations, and **Reopen** returns one to the active review. A new reply or changed verdict brings it back automatically. The visibility preference is local to this browser, repository, and review.

**Delete** withdraws a note from Markdown. **Clear all** and **Remove N applied** also withdraw the notes they remove, including overall notes. Clearing visible notes leaves hidden resolved conversations intact. Bookmarks and browser history are not feedback and are not cleared with notes.

### Reference another note

Click a note's short `#id` tag to copy it, then paste it into another note or reply; the reference picker does the same. The preview shows the target's full note, captured code or visual evidence, and expandable replies. Nested references stay navigable without recursively embedding previews.

References work between code and visual notes within the same review. IDs survive reordering and restarts. Previously copied comment URLs and older `lcr:` links remain readable. An agent's reply must still answer its own note fully; references add context rather than replace an answer.

### Attach pictures

Paste a screenshot into any note or reply, drop an image on the box, or use the image icon. The picture is stored beside the review in `images/` and linked as ordinary Markdown:

```md
![Screenshot](images/<name>.png)
```

The same bytes are stored once even if used in several notes. Relative links let the agent open the same picture directly from disk. Attachments are never deleted automatically, because another note, review, or draft may still use them.

Agents can also link pictures in `assets/`, `images/`, or directly beside the review file:

```md
![After fix](assets/after-fix.png)
```

Create and inspect each picture first, use a unique safe filename, and never overwrite or delete an existing attachment. Paths are relative to the Markdown file, including with a custom output directory. Named agent images revalidate against their content.

## Read and navigate changes

The file tree and diff share one order. The tree tracks the file being read; viewed marks record progress, while hiding is a separate display preference. The tree toggle widens the diff without changing notes.

- **Notes:** the list below the tree and **Read all** show notes in diff order. The all-notes panel has all/new/open/done filters and the same reply, edit, and delete controls as the diff.
- **Bookmarks:** use a line's flag to keep a navigation stop. Bookmarks last for the tab's sitting: reload keeps them, closing the tab or starting a new review clears them. They are never submitted.
- **Resume:** after a settled manual scroll, remembers the code line and its position below the sticky header. Fast scrolling needs a longer pause; programmatic jumps do not move the marker. It follows uniquely matching code after edits and falls back to the file header when needed. It is an estimate, independent of viewed marks.
- **Hidden context:** click a hunk separator to reveal unchanged lines. Revealed lines accept notes and bookmarks; expansions reset on reload.
- **Removed lines:** the header's **removed** toggle folds deleted runs into expandable markers. Each file can override the default with its own control. Runs containing notes stay open, and jumping into a fold opens it.
- **Hide patterns:** configure patterns in settings; the header toggles them together without erasing them. Each pattern has its own switch, and manual per-file overrides still apply.
- **Open in editor:** the file-header action opens the working-tree file. Set an executable name or absolute path under **Settings → Code editor**, such as `code`, `cursor`, or `zed`; blank uses the operating system default. This setting accepts an executable, not a shell command or editor arguments.
- **Copy file path:** the icon beside a filename copies its repository-relative path.

Common actions use icons with immediate hover/focus tooltips and accessible names. Note headers stay visible while reading long threads.

### Anchors and changed images

Notes retain the code they were written against, including line and optional character-range metadata. They remain on matching rows or follow uniquely matching captured code and surviving unchanged lines. Missing or ambiguous code makes a note outdated rather than guessing a nearby line. It stays under its original file, or at the end when that file leaves the diff, with its captured code and conversation intact.

Images in the diff show old and new sides, or the single side an added/deleted file has. SVG files show both an image preview and source diff. Click a picture to comment on a small area, or drag a rectangle. A note keeps its side, original pixel coordinates, and cropped capture; click a region's short reference to reopen it. Hold Alt to use the image normally. Images fit the pane width without a height limit.

## Search

Use the header search or **Cmd/Ctrl+K** to find filenames, code, notes, captured code, statuses, and replies. Typing opens highlighted previews; arrow keys select a preview and Enter opens it. Press Enter with no selected preview to open detailed results with file/code/note/reply filters. Matches remain highlighted after a jump.

Search covers the current diff and its surrounding context, including expanded context and hidden/folded files, not the rest of the project. Terms are literal and case-insensitive. Combine a filename and words to narrow results.

## Saved conversations

A run adopts the newest matching review. Without a name, its range, branch, and base commit identify the conversation; earlier files remain on disk when that context changes. **Settings → New review** starts another conversation explicitly.

`lcr --id <name>` identifies a review by name instead. Reuse the name after a commit, rebase, or change of diff arguments to continue the same notes and threads. A new name starts fresh, and an unnamed run leaves named reviews alone.

**Settings → Review file** lists saved reviews with their branch, range, opening time, and open-note count. **Open** adopts one as the live conversation against the current diff. Notes from other reviews on the branch can appear as dim markers where they still match; **Continue in this review** carries the conversation into the current review.

## Browser history

**History** in the header opens a searchable timeline of note edits, replies, answers, statuses, and removals. A note's history icon filters to that conversation. Each revision has a before/after view and complete review snapshot. **Copy text** reuses earlier wording without changing the current review; **Export** downloads JSON. **All reviews** includes other ranges and names in this repository.

History is an independent IndexedDB journal. Deleting Markdown or notes and starting a new review do not erase it. It records states the page observes, including the first read after a restart, not intermediate file edits made while the page was closed. Identical consecutive observations and display preferences do not create revisions. Page drafts and file observations have separate baselines so unsent notes are not mistaken for file deletions.

History is local to the browser profile and origin, including port, and scoped by repository and review. Reopen the same address and review to find it. Clearing site data removes it; storage failures are shown without blocking editing. Export for a durable backup. Pictures remain links to attachment files; exports do not embed their bytes. Browsing history never writes old snapshots back to Markdown.

Opening history adds one navigation entry: Back closes it, Forward restores its note filter, revision, and controls. Close and Escape use that entry and preserve an editor underneath.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl+K | Search the review |
| Alt+J / Alt+K | Next / previous note outside a text field |
| Alt+C | Toggle the all-notes panel |
| J / K | Step through the open all-notes panel outside a text field |
| Alt+Down / Alt+Up | Next / previous bookmark outside a text field |
| Alt/Option + drag | Select code as ordinary text without commenting |
| Escape | Cancel an editor or close an overlay; unsaved work may require confirmation |

The editor shows its current save shortcut; the Enter behavior is configurable in settings. Live-page selection and drawing shortcuts are listed in the [web annotation guide](web-ui.md).
