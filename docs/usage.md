# Review workflow and controls

For installation and common commands, see the [README](../README.md). For a running app, see [web annotation](web-ui.md).

## Choose what to review

Run `lcr` inside a Git repository. By default it compares working-tree, staged, and untracked changes with `HEAD`, including files created after startup. An explicit working-tree comparison such as `lcr origin/main` also includes untracked files. Commit-to-commit ranges such as `lcr main...HEAD` stay revision-only.

Arguments lcr does not recognize go to `git diff`. Use `--` before paths that could be interpreted as options. Invalid options, revisions, or paths fail before a server or browser starts.

The default address is `http://localhost:7777`. If the port is occupied, lcr tries the next ports and prints the address it actually uses. `--port 0` asks the operating system for a free port. `--no-open` leaves the server running without opening a browser.

The browser tab shows `Review — <branch>` using the checked-out branch, updated whenever the diff reloads. Detached HEAD falls back to `Review`. The bundled favicon and touch icon also work in the standalone executable without external requests.

## Configuration

lcr reads user-owned settings from `$XDG_CONFIG_HOME/lcr/config.json` when
`XDG_CONFIG_HOME` is absolute, otherwise `~/.config/lcr/config.json`. It never
discovers a repository's config file. The file is optional, read once at startup,
and never written by the web UI. Help and version do not read it.

For example:

```json
{
  "acp": null,
  "diffArgs": ["origin/main"],
  "port": 7777,
  "outDir": ".review",
  "context": 8,
  "open": true,
  "ui": {
    "enterSaves": true,
    "foldDel": true,
    "editor": "code"
  }
}
```

Plain `lcr` now compares against `origin/main` without launching an ACP agent.
The revision must exist locally; lcr does not fetch it. Each Git argument is its
own array entry: use `["main...HEAD", "--", "src/"]`, not a shell command string.

### Startup fields

All fields are optional. Omitted values use the built-in behavior below.

| Field            | Type                                     | Built-in behavior                                                           |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `acp`            | Profile path or `null`                   | Manual review; no automatic agent                                           |
| `diffArgs`       | String array                             | Working-tree, staged, and untracked changes against `HEAD`                  |
| `port`           | Integer, 0–65535                         | `7777`; `0` requests a free port                                            |
| `outDir`         | Non-empty directory path                 | `.review`                                                                   |
| `context`        | Non-negative integer                     | `5` surrounding lines                                                       |
| `open`           | Boolean                                  | `true`; open the browser                                                    |
| `id`             | String                                   | Unnamed review                                                              |
| `web`            | Local HTTP(S) URL                        | No live-page annotation                                                     |
| `browserProfile` | `"shared"`, `"project"`, or `"existing"` | `"shared"`; dedicated browser state beside user config                      |
| `browserDataDir` | User data directory path                 | Chrome stable's OS-specific directory when attaching to an existing browser |
| `ui`             | Partial preference object                | Built-in preferences plus existing browser settings                         |

`outDir` remains relative to the repository root unless absolute. An `acp` path
in this file resolves beside the settings file; an explicit `--acp` path resolves
from the repository root. `~/` ACP paths are supported. See
[agent profiles and model selection](agent-connections.md#configure-and-select-an-agent).

Unknown fields and invalid values are reported before the server starts; settings
are not silently ignored. `--no-agent` or explicit `--acp` can bypass a malformed
settings file or invalid agent default, but otherwise-valid settings still have
their non-agent fields validated.

### CLI precedence

Explicit CLI options override only their corresponding defaults. For example,
`lcr --port 8080 --no-open` keeps the configured diff, output, and UI defaults.
`--no-agent` disables the configured agent without disabling other valid defaults;
an explicit `--acp` selects another profile. If both appear, the last one wins.
Use `"acp": null` for manual review by default.

Explicit Git arguments **replace**, rather than append to, configured `diffArgs`.
With the example above, `lcr HEAD~2` reviews against `HEAD~2`, and
`lcr -- src/` reviews the working-tree changes under `src/`, not against `origin/main`.
`lcr --worktree` ignores the configured diff arguments and restores the built-in
comparison. `lcr --no-web` disables a configured page URL; `--open` overrides
`"open": false`. An empty explicit ID (`--id ""`) clears a configured review name.
`--browser-profile shared`, `project`, or `existing` overrides `browserProfile`.
Shared state persists across projects and worktrees; project state stays at
`<outDir>/.browser/`. Existing mode connects to a running browser after its consent dialog,
using `--browser-data-dir` or `browserDataDir` when supplied. Configured directory paths resolve
beside the config file; CLI paths resolve from the repository root. Both support `~/`.
See [existing browser setup](web-ui.md#attach-to-your-existing-browser) and [profile safety](web-ui.md#profile-safety).

### Web-UI defaults and browser storage

The `ui` object configures the server-shared page preferences:

| Key               | Built-in value | Meaning                                                         |
| ----------------- | -------------- | --------------------------------------------------------------- |
| `auto`            | `true`         | Mark files viewed after scrolling past                          |
| `back`            | `true`         | Unmark when scrolling back                                      |
| `limit`           | `900`          | Automatic-viewing scroll-speed threshold; `0` permits any speed |
| `toast`           | `true`         | Notify when automatically marking viewed                        |
| `hide`            | `""`           | File-hide patterns, as entered in settings                      |
| `hideEnabled`     | `true`         | Enable hide patterns                                            |
| `disabledHide`    | `[]`           | Individually disabled hide patterns                             |
| `hideDeleted`     | `false`        | Hide deleted files                                              |
| `foldDel`         | `false`        | Fold removed-line runs                                          |
| `enterSaves`      | `false`        | Enter saves; Shift+Enter inserts a newline when enabled         |
| `aiContext`       | `false`        | Save new capture metadata for on-demand agent reading           |
| `contextHtml`     | `false`        | Include sanitized capture-time HTML when `aiContext` is enabled |
| `contextFullPage` | `false`        | Include a full-document screenshot when `aiContext` is enabled  |
| `expand`          | `20`           | Context lines revealed per click                                |
| `navHidden`       | `false`        | Hide the file-tree pane                                         |
| `navWidth`        | `0`            | Sidebar width in pixels; `0` keeps the responsive default       |
| `ntFold`          | `false`        | Fold the sidebar's note list                                    |
| `bmFold`          | `false`        | Fold the sidebar's bookmark list                                |
| `single`          | `false`        | Keep only the newest review file on save                        |
| `ghosts`          | `true`         | Show other reviews' anchored notes                              |
| `editor`          | `""`           | Editor executable; empty uses the system default                |

`limit` accepts `0`, `500`, `900`, or `1800`; `expand` accepts `10`, `20`, `50`,
or `100`, matching the page's controls. `navWidth` accepts a non-negative safe
integer; the page constrains the displayed width to keep room for the diff.
All other flags above are booleans; `hide` and `editor` are strings, and
`disabledHide` is an array of strings.

On **each server start**, keys present in `ui` take precedence over old browser
values. You can then change them in the page: those choices remain in browser
storage and survive a page reload during that run. The next server start reapplies
the configured keys, including when reusing the same port. Keys omitted from `ui`
keep their existing browser persistence.

With `enterSaves: false`, Enter inserts a newline and Shift+Enter saves.
Cmd/Ctrl+Enter always saves. These shortcuts apply to note and reply editors,
including the embedded live-page editor. Effective preferences are shared with
embedded editors without writing the settings file.

Notes, replies, viewed marks, bookmarks, and other review content are not config
defaults and retain their separate storage behavior. Configuring `single: true`
opts into the existing save-time pruning of generated review files.

## Appearance

The two selectors beside **Settings** change colors immediately:

- **Color theme:** Default (neutral slate), Catppuccin (Latte in light mode,
  Mocha in dark mode), or Gruvbox.
- **Color mode:** Light, Dark, or Auto. Auto follows your operating system's
  appearance, including changes made while the review is open.

Theme and mode are independent. A new browser starts with Default and Auto;
both choices survive reloads in browser storage for the review's origin
(host and port). They are separate from the server's `ui` configuration and
are never written into review Markdown.

Switching colors leaves open drafts, caret positions, and the reading position
intact. Themes do not change fonts, spacing, sizing, captured images, or drawing
ink. They use CSS `light-dark()` and `color-mix()`, so use a current browser.

See [adding a color theme](development.md#color-themes) to extend the selector
with a CSS palette and a registry entry.

## Write and save notes

- **Line or range:** click a diff line, drag across lines, or select part of one line. Selecting inside an already selected line narrows or re-picks its character range; clicking the row returns to the whole line. An overlapping selection re-aims an unsaved draft without losing its text.
- **Copy code:** hold Alt/Option while dragging to select ordinary text without opening a note.
- **Whole file:** use **Comment** in the file header, including on a binary or collapsed file.
- **Overall:** use **Comment** in the permanent page header for feedback without a file anchor. A review can have several overall notes.
- **Replacement:** insert a fenced `suggestion` block seeded from the selected lines. The page displays its difference from the captured code; the Markdown contains the replacement itself.

Only one active editor keeps the floor at a time. An editor with text keeps focus when you try to start another; an untouched draft can move to the next selection. Empty reply inputs stay visible without blocking new notes or live updates. Live replies update notes in place and preserve a reply being written. A changed diff waits while an editor is active; the header's `diff changed` indicator lets you choose an early refresh after confirmation.

Diff gutters keep line numbers and row actions together without separate bordered rails.
The comment marker sits beside the code it anchors, and conversations align with the file
card's inset. Long note headings shorten the directory portion while keeping the filename
and line label visible. File-header actions become icon-only when the diff pane is narrow;
hover or focus them for their labels. In a narrow window, search moves to its own header row.

**Save note** writes only that note to `.review/review-<timestamp>.md`, without starting an agent. Subsequent saves update that conversation rather than creating another file. The default directory is ignored by Git. Custom relative output directories set with `--out` are locally excluded too.

With an [ACP agent configured](agent-connections.md), the separate **Save & ask AI** action persists and queues only that note immediately, even while the agent is disconnected or the queue is paused. Without ACP, only **Save note** is offered. Agent and note indicators show working activity; waiting for approval is not shown as thinking.

The footer's **Save review**, renamed **Update review** once a file exists, writes all current notes to that same conversation, preserving agent replies and verdicts. With ACP it queues notes whose saved reviewer content changed; unchanged notes are not rerun. It does not reload the diff, start a new conversation, or replace individual note actions.

### Message colors

Hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), RGB/RGBA, and HSL/HSLA color literals display
clickable swatches in note and reply prose, inline code, and code blocks. The original Markdown,
syntax highlighting, and copyable code remain unchanged. Note references and links retain their
ordinary behavior rather than becoming color controls.

In an editor, click a swatch under the textarea to replace that occurrence, or use **Color** to
insert one at the caret. The picker accepts CSS literals, a native color chooser, and opacity.
**Apply color** changes only the draft; **Cancel** leaves it untouched. Save the note or reply
with its ordinary action. **Save color** retains the chosen color in a reusable browser-local
palette across editors and reloads in that storage context. Different ports and privacy-partitioned
embedded pages can have separate palettes; restricted storage keeps colors usable for the current page.

Clicking a swatch in a rendered message opens an inspection picker with copy and palette actions.
When a reply editor is available, **Use in reply** inserts the chosen color there explicitly.
It never edits the original message or an agent's reply. History remains a read-only observation.

## Continue the conversation

Give the Markdown file to any coding agent, or use the optional [`apply-lcr` skill](../skills/apply-lcr/SKILL.md):

```sh
npx skills add cjvnjde/local-code-review --skill apply-lcr
```

Ask “Apply the newest lcr review,” or use `/apply-lcr` when supported. The skill handles code and visual feedback, replies in the review file, runs project checks, and picks up follow-ups. Framework/source metadata are hints, not prerequisites.

The page follows the agent's replies, status changes, and code edits. Each saved note has an open reply input: **Save reply** appends without starting the agent, and **Save & ask AI** appends and queues the follow-up. With an empty reply input, **Save & ask AI** asks about the existing saved conversation instead. There is no duplicate Ask action in the note header. Original notes that have an agent answer or a completed verdict cannot be edited; use the reply input or **Resolve**. Your own stamped replies can be edited or deleted until an agent has answered them; agent messages remain read-only.

A note's `Status:` can be pending, applied, answered, skipped, needs-input, or unknown. **Answered** means a question needed no code edit; it is not included in **Remove N applied**.

Answered notes offer **Resolve**, which hides the conversation from the diff, note lists, and search without deleting it from Markdown. **Show resolved** in the footer reveals hidden conversations, and **Reopen** returns one to the active review. A new reply or changed verdict brings it back automatically. The visibility preference is local to this browser, repository, and review.

**Delete** withdraws a note from Markdown. **Clear all** and **Remove N applied** also withdraw the notes they remove, including overall notes. Clearing visible notes leaves hidden resolved conversations intact. Bookmarks and browser history are not feedback and are not cleared with notes.

### Reference another note

Click a note's short `#id` tag to copy it, then paste it into another note or reply; the reference picker does the same. The preview shows the target's full note, captured code or visual evidence, and expandable replies. Nested references stay navigable without recursively embedding previews.

References work between code and visual notes within the same review. IDs survive reordering and restarts. Previously copied comment URLs and older `lcr:` links remain readable. An agent's reply must still answer its own note fully; references add context rather than replace an answer.

Note and reply inputs offer **Formatting options**, collapsed by default. Open it to insert bold,
italic, inline code, fenced code blocks, links, images, or note references. The input and saved
review remain ordinary Markdown; selecting text before an action formats that selection, and
inserting a link leaves its URL selected for replacement. Save actions sit on the right.

### Attach pictures

Paste a screenshot into any note or reply, drop an image on the box, or open **Formatting options** and choose the image icon. The picture is stored beside the review in `images/` and linked as ordinary Markdown:

```md
![Screenshot](images/<name>.png)
```

The same bytes are stored once even if used in several notes. Relative links let the agent open the same picture directly from disk. Attachments are never deleted automatically, because another note, review, or draft may still use them.

Every attached image gets a preview card while editing a note or reply, in both diff and web mode. Choose **Draw / edit** to use the same drawing tools as web captures: arrows, shapes, pen, highlights, text, callouts, magnifiers, undo and zoom. Applying a drawing updates that image's Markdown link; save the note or reply to keep the change. Edit the comment again to revise the marks, or clear the drawing to restore the original image. Unfinished drawings offer browser-local recovery.

Drawing exports are ordinary PNGs containing editable drawing data and a relative reference to the original image. Keep both attachments with the review to edit them after a restart. Clicking a saved image opens a shared preview with fit, zoom and actual-size controls; **Open image** opens the file separately.

Agents can also link pictures in `assets/`, `images/`, or directly beside the review file:

```md
![After fix](assets/after-fix.png)
```

Create and inspect each picture first, use a unique safe filename, and never overwrite or delete an existing attachment. Paths are relative to the Markdown file, including with a custom output directory. Named agent images revalidate against their content.

### Attach on-demand context

In a note or reply, open **Formatting options → Add context** to attach a file or
paste plain text or JSON. Files and text are limited to 12 MiB. Upload completes
before a relative Markdown link is inserted at the caret; failed uploads leave
the draft available for correction. This works independently of the capture
preferences under **Settings → AI context**.

The link names `context/<id>/manifest.json` beside the review file. **Inspect
context** opens its manifest without fetching its payloads; choose one part to
read or preview it. HTML is displayed as text, never executed. Binary files can
be downloaded. Missing context is reported without making the note unreadable.

Each card shows an abbreviated context ID. Click that ID to copy the full
64-character value, without fetching context. The inspector shows the full
copyable ID and its manifest path, including when the manifest cannot be loaded.

#### Read without lcr

Neither an lcr installation, running server, nor review Markdown file is required.
Give the agent the copied ID and access to the repository or output directory.
The `apply-lcr` skill supports this context-only request without adopting the
newest review or writing review statuses.

1. With the default output directory, read
   `.review/context/<id>/manifest.json`. With a custom output directory, read
   `<out>/context/<id>/manifest.json`. If the directory is unknown, search the
   current repository for that exact manifest path, including hidden and ignored
   directories; do not search by an abbreviated ID.
2. Confirm the manifest's version and full ID. Choose only the available parts
   needed for the task. Missing, excluded, unavailable, or truncated evidence is
   not permission to substitute a newer live page.
3. Read a part's `file` beside the manifest, or its `attachment` from the output
   directory. Text and JSON are ordinary files; images are ordinary image files.
   Keep paths inside the output directory, including after resolving symlinks,
   and check the part's byte count and SHA-256 before relying on it.

The ID identifies a snapshot, not a globally reachable service. If the files
are not accessible, share the bundle or supply its location. A transferred
`context/` directory and its referenced attachments are sufficient; the review
Markdown is optional for this workflow.

#### Optional CLI

If lcr is installed and a review path is available, the existing commands perform
the lookup and integrity checks for you, still without a running server:

```text
lcr context inspect <id> --review <review.md>
lcr context read <id> --review <review.md> --part <part>
lcr context read <id> --review <review.md> --part <part> --offset <byte-offset> --limit 16384
```

Use the ID from the link and a part name from the manifest: for example, `content`
for an uploaded file, or `elements`, `styles`, `selected-html`, and `full-page`
for a capture. Text reads return JSON with content and `nextOffset`; offsets are
UTF-8 byte offsets. The default chunk is 16 KiB, with a 64 KiB maximum. Binary
reads return a local path, not base64. These commands work outside Git and do not
load user settings or contact the original page.

Bundles are local, immutable snapshots under the review output directory. Moving
a review requires keeping its `context/` and referenced `images/` attachments
beside it. Removing a note, starting a new review, and pruning old review files
do not delete bundles. Retention is deliberate: another draft, thread, or queued
task may still reference one. No automatic garbage collection is performed.

## Read and navigate changes

The file tree and diff share one order. The tree tracks the file being read; viewed marks record progress, while hiding is a separate display preference. The tree toggle widens the diff without changing notes.

Drag the sidebar's right edge to resize it; its width is remembered across reloads
and hiding/showing the tree. The focused separator also accepts Left/Right arrows
(Shift for larger steps), Home for the minimum, and End for the maximum.
Double-click the edge to restore the responsive default. Resizing keeps open drafts,
unsent replies, and the code being read in place.

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

### Back, Forward, and addresses

The main review's address represents the open notes panel and filter, focused note, note or reply
editor, screenshot drawing editor, settings, search results, and revision-history overlay.
Back reverses these UI transitions; Forward restores them. Opening an overlay leaves the editor
underneath intact. Search typing and revision-history controls update the current entry rather
than adding an entry per keystroke or revision.

Navigation uses hash parameters, such as `#notes=open&note=<ref>` or `#editor=reply:<ref>`.
Saved-note editors and other available views reopen from a copied address or a reload. Missing
notes, expired drafts, and invalid view parameters are dropped without blocking the rest of the page.
The address identifies UI state, not a different repository or review; use it with the same running review.

Unsent note and reply text and caret positions survive Back/Forward in memory in the current page.
They never enter the URL or browser-history state and do not survive a reload. Saving or explicitly
cancelling an editor finishes that draft. Drawing changes require confirmation before being discarded;
an in-flight save blocks traversal until it finishes. Browser navigation never undoes a saved note,
reply, or drawing.
Screenshot drawings have separate browser-local recovery: reopening the same capture can offer
its unfinished editable marks after a reload or closed tab. This does not restore unsent note or
reply text, apply drawings automatically, or replace an already changed applied drawing.
See [drawing recovery and controls](web-ui.md#draw-on-a-capture).

### Review revision history

**History** in the header opens a searchable timeline of note edits, replies, answers, statuses, and removals. A note's history icon filters to that conversation. Each revision has a before/after view and complete review snapshot. **Copy text** reuses earlier wording without changing the current review; **Export** downloads JSON. **All reviews** includes other ranges and names in this repository.

History is an independent IndexedDB journal. Deleting Markdown or notes and starting a new review do not erase it. It records states the page observes, including the first read after a restart, not intermediate file edits made while the page was closed. Identical consecutive observations and display preferences do not create revisions. Page drafts and file observations have separate baselines so unsent notes are not mistaken for file deletions.

History is local to the browser profile and origin, including port, and scoped by repository and review. Reopen the same address and review to find it. Clearing site data removes it; storage failures are shown without blocking editing. Export for a durable backup. Pictures remain links to attachment files; exports do not embed their bytes. Browsing history never writes old snapshots back to Markdown.

Opening history adds one navigation entry: Back closes it, Forward restores its note filter, revision, and controls. Close and Escape use that entry and preserve an editor underneath.

## Keyboard shortcuts

| Shortcut          | Action                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| Cmd/Ctrl+K        | Search the review                                                           |
| Alt+J / Alt+K     | Next / previous note outside a text field                                   |
| Alt+C             | Toggle the all-notes panel                                                  |
| J / K             | Step through the open all-notes panel outside a text field                  |
| Alt+Down / Alt+Up | Next / previous bookmark outside a text field                               |
| Alt/Option + drag | Select code as ordinary text without commenting                             |
| Escape            | Cancel an editor or close an overlay; unsaved work may require confirmation |

The editor shows its current save shortcut; the Enter behavior is configurable in settings. Live-page selection and drawing shortcuts are listed in the [web annotation guide](web-ui.md).
