# Agent Instructions

## Project shape

- `src/index.ts` is composition root. Keep CLI, Git, diff parsing, review output, server, and browser concerns in focused modules under `src/`.
- `src/thread.ts` owns the review-file format in both directions: `parseReview` reads one, `renderNote`
  writes one, and they must stay inverses. `src/session.ts` owns the file the run is talking through.
- Keep runtime dependency-free. Do not add package manager files or third-party runtime packages unless explicitly requested.
- Use Bun for source checks, browser bundling, and standalone compilation.
- Keep browser assets imported through `src/web/shell.html`; compiled release must remain one standalone executable.
- `skills/apply-lcr/` is distributable optional skill. `.agents/skills/apply-lcr/` is project-local copy. Keep their files byte-identical.
- Skill stays vendor-neutral: no tool-specific frontmatter keys, no vendor names in its text. `SKILL_DIRECTORIES` lists per-tool install roots and may grow; `.agents/skills` remains the fallback.

## Behavior to preserve

- `src/version.ts` holds the build stamp, and **bumping it is part of every change to what lcr serves**:
  raise `<date>.<n>` — same day, next `n`; a new day, `.1` — in the same commit as the change itself. It is
  what tells a reviewer whether the binary on their `PATH` is the source they just built, so a stale stamp is
  worse than none. `lcr --version` (or `-v`) prints it and exits before git or the repository is touched, so
  it answers outside a repository too, and the startup banner carries it beside the URL.
- Default diff includes working-tree, staged, and untracked changes versus `HEAD`.
- Explicit CLI arguments continue to pass through to `git diff`.
- Review output remains Markdown under `.review/` by default.
- `listReviews` is the one definition of what lcr generated: `review-*.md` in the output directory. Deletion, the
  status sweep, and the save-time prune all read it, so nothing the user put in that directory is ever removed.
- Saved reviews stay timestamped even when the page keeps only one of them. `sentAt`, `reviewTime`, and the
  `noteKey` fallback all read the stamp out of the file name; a fixed name would silently disable them.
- One review file per conversation. A run adopts the newest one it finds, so restarting lcr continues where it
  stopped; **New review** in settings is the only thing that opens another. Notes always survive a save — they
  are the conversation now, not a batch that was handed off.
- `--id <name>` names a review, and a name outranks the diff: `matchesContext` compares ids alone as soon as
  either side carries one, so the same name continues its conversation wherever the range, branch, or base has
  moved to, another name is another review, and an unnamed run adopts no named file. The name round-trips
  through the `Review id:` preamble line, which is what a restart matches on, so `normalizeId` keeps out what
  that line cannot carry back. The page keys its own store on the name rather than the range when there is one
  — a name never read under before therefore starts with nothing stored, which is what makes a new name an
  altogether new review rather than the last read's notes under another heading.
- The review file is round-trippable. Every field a note carries on the page is recoverable from the Markdown,
  which is what lets a restarted server, or a second tab, adopt notes the browser never had. The anchors live in
  the note's own id, so `parseReview` reads them out of `<!-- lcr:<id> -->` rather than out of the heading text.
- Both sides write the review file: lcr renders it whole, the agent appends messages and rewrites `Status:`
  lines. Every mutation in `session.ts` therefore re-reads the file first and keeps what it does not own. A save
  updates the reviewer's wording and leaves the agent's thread and verdict exactly as written; a note the page
  no longer sends stays in the file, because handing a note over is not withdrawing it. Deleting the note on
  the page is the one thing that takes it out.
- Clearing on the page is deleting: **Clear all** and **Remove N applied** withdraw what they drop, overall
  notes with them, because those are notes too. The page reads the review file back whole on every event, so
  anything left in it returns. One request carries the whole set — `session.remove` takes ids and writes once — because a
  delete per note announces the file after each write and the page would adopt the rest straight back. **New
  review** is the exception: it has already let go of the file, which keeps everything said in it.
- The reviewer's own messages stay the reviewer's. A reply can be reworded where it stands or taken back
  out of the thread, exactly as the note above it can; the agent's messages cannot, because they are its
  account of what it did. A message is named by the stamp in its marker — `reply` mints one no other
  message in that thread carries, and `editReply`/`dropReply` are asked for by it — so a `**Reviewer**`
  line that reached the file without a stamp is shown and left alone. A rewrite keeps the stamp and the
  place in the thread: it is the message the agent was already reading, saying something else. `/api/reply`
  carries all three — POST sends, PUT rewords, DELETE withdraws — and each answers the note whole, because
  the page takes threads back from the file rather than editing its own copy.
- A note's section is written verdict-first — captured code, note, `Status:`, then the thread — so both sides
  only ever append. Prose after the `Status:` line with no `**Agent**`/`**Reviewer**` line above it is read as
  an agent message rather than dropped, and a status line still wins until the first explicit message, so an
  agent that appends its verdict instead of replacing `pending` is still understood.
- Only lcr's own writing is escaped. `escapeText` guards every line lcr renders; an agent appends straight into
  the file, so its reply is read as the prose it is. What bounds a note is therefore the lines carrying lcr's
  marker — a `### … <!-- lcr:<id> -->` heading, a `**Agent**`/`**Reviewer**` speaker line, and the `<!-- lcr:end -->`
  above the working agreement — and those close a fence a reply left open rather than being swallowed by it.
  A heading the agent wrote itself carries no marker and stays inside its reply, where it renders as the
  Markdown it is; the next save escapes it, so a file the agent broke settles on the following write. `## <file>`
  headings and the `---` rule stay unmarked boundaries: sealing bare headings would break a fenced Markdown
  snippet in the reviewer's own note, which the format keeps verbatim on disk.
- Default `.review/` output remains ignored. Custom relative output directories remain locally excluded through `.git/info/exclude`.
- Start opens the page in the default browser unless `--no-open` is passed. Launch stays best-effort: failure prints a hint and never blocks the server.
- A taken port is not a failure: start walks up from the requested port over a bounded range and reports the one it
  landed on. Everything downstream, the printed URL and the browser launch included, reads `server.port` rather than the
  requested one. Port 0 is left to the OS and never walked.
- The page follows the agent over `/api/events`. Events carry no state, only the news that the review file or
  the diff moved; the page fetches what it needs itself, so a dropped or repeated event costs a fetch rather
  than correctness. Watchers stay idle while no page is listening, and a tree change is only announced once the
  diff's own fingerprint actually differs.
- A live update must never discard what is being written. Replies repaint one note in place and skip a box with
  an open editor. A diff refresh rebuilds the pane, so it waits for the last editor to close; the pill in the
  header is what says so, and taking the refresh early is the reader's choice and asks first. The pane goes back
  to where it was reading rather than to the top.
- The page is served from `/` with `cache-control: no-store`; the HTML bundle route stays on `/index.html`. Bun gives that route one ETag for every build, so mounting the bundle on `/` again lets a browser revalidate into an older page whose asset chunks are gone.
- Review notes anchor on captured code plus line metadata. A note may narrow to a character range inside one line; keep its columns, snippet, and `ca`/`cb` offsets together with the line anchor.
- The two selections are one gesture apart, in both directions: a selected line narrows to a character range as
  soon as a press inside its code collects one, the same press re-picks the range on a line that already carries
  one, and a plain click on the row takes it back to the whole line. `pressKind` reads a finished press as rows,
  characters, or a click the row handler answers. The pressed row therefore keeps the highlight it already shows
  until the press is over — repainting a cell under a live press replaces the node the browser anchored the drag
  on, and the drag then collects nothing — so every way a press can end has to paint again. A press held with
  alt is not a selection at all: it is left to the browser, so the code can be highlighted and copied as text
  without a note opening over it, and the click that follows one is ignored for the same reason.
- One line or range holds any number of notes. Each gets its own box under the anchor row, matched by `data-nid`. Removing one repaints the span it covered rather than clearing it, because other notes may still cover those lines.
- One note editor stands open at a time. An untouched draft still moves to wherever the next click lands; a box with
  text in it keeps the floor, and anything that would open a second editor scrolls that one back into view and focuses
  it instead. A draft is the exception to its own rule for the lines it covers: a selection that still touches them
  re-aims it, half-written text and caret carried over, because narrowing a line to a fragment and re-picking that
  fragment are the same gesture that opened it, and a heading naming a range the reader has already left is a lie
  about what the note will say. `state.draftAt` is where it sits and `reaims` is the test; a draft on a whole file
  or on the review covers no lines and so has none.
- The editor seeds a fenced `suggestion` block from the lines the note covers. A note narrowed to part of a line still
  suggests whole lines, because a suggestion replaces lines; the fence outgrows any backticks in the code. The block is
  ordinary note body text, so it reaches the review file verbatim, and `apply-lcr` reads it as the proposed replacement.
  A saved note shows it as code, coloured line by line by the diff's own `codeHtml`: class `c` is what carries the
  syntax token styles, so every container of highlighted code needs it.
- A shown suggestion is read against the lines it replaces, as the change it makes rather than as an answer with the
  question missing: `capturedLines` takes the new side of the note's own capture — the same lines `suggestLines` seeds
  the block with — and `lineDiff` pairs them with the block, so kept lines read as context and the rest as removed
  above added. It is only ever the display. What the review file holds stays the replacement alone, because that is
  what `apply-lcr` puts back. A suggestion in an agent's reply is read against the same capture, since both sides are
  proposing for the same lines, and a note that captured nothing — on a whole file or on the review — has no base, so
  its block is shown as the code it is.
- A note and the answer to it are Markdown. `renderBody` draws both sides of the conversation, and the prose in them
  goes through `client/markdown.ts`: headings, fenced and inline code, lists and checklists, quotes, tables, emphasis,
  links, rules. Nothing else is markup — every run of text is escaped and the only tags in the output are the ones that
  file writes, so a body containing HTML shows the HTML. A fence with no language named is coloured as the file the note
  is on, and its `pre` carries class `c` like every other code container. A link is followed only on a safe scheme and
  opens away from the page; an image is shown as a link unless it is one of the review's own attachments, because the
  page fetches nothing from the network. The
  Markdown reaches the review file verbatim — `escapeText` only ever guards a line the parser would read as structure,
  and `unescapeLines` is its exact inverse — so what the file holds is what the page renders.
- A note may carry a picture. A screenshot is often the shortest way to say what is wrong, so the note
  editor and every reply box take one from the clipboard, from a drop anywhere on the box, or from the
  file picker behind **image**; the picture goes to `/api/attach` the moment it arrives, before there is
  a saved note to hang it on, and what lands in the prose is the ordinary Markdown image
  `![<alt>](images/<name>)`. That link is the whole of what is written down. It resolves against the
  review file beside it the way every relative Markdown link does, so the agent reading the file opens
  the same picture the page draws — which is the point of the feature, and why the target must stay
  relative rather than becoming a path from the repository root or an lcr-only scheme.
  `attach.ts` owns the store: names are the sha of the bytes, so one screenshot pasted into three notes
  is one file and a name never means two pictures, which is what lets `/api/attachment` answer
  `immutable` and a note full of screenshots survive a repaint without refetching them. A name is
  checked against one safe file name before it is joined to a path — the attachment directory is the
  whole of what a note can reach — and it is deliberately wider than what lcr mints, so a picture the
  agent puts in that directory itself is drawn like any other. `client/attach.ts` owns the page's half:
  which links are attachments, the markup, and the paste, drop, and pick. The paste belongs to the text
  box, which is new for every editor; the drop belongs to the box around it, which is not — a note
  edited twice is one box and two text areas, and a reply box stands inside the note box it answers —
  so it is bound once per box, reads the document for whichever editor is open in it now, and leaves an
  event an inner box already took alone. A picture is never deleted:
  it belongs to whatever notes still point at it, and the page cannot know that a draft, another review
  file, or the agent does not.
- A note may name another note of the same review. The reference travels in the prose as the Markdown
  link `[<heading>](lcr:<ref>)`, where `<ref>` is the tail `mintNoteId` ends every id with — the same
  characters that close the target's `<!-- lcr:<id> -->` marker, so the agent reading the file can
  follow it as well as the page can. That is the whole of what is written down: the chip is drawn from
  the note as it stands when it is drawn, so it says where that note is now, and a reference no note —
  or more than one note — answers to reads as a note the review no longer holds rather than as a
  confident pointer at the wrong one. `refToken` writes it, `refIn` and `noteByRef` read it back, and
  the editors insert it from the picker rather than by hand, because an id is not something to type.
  Following one stays inside the all-notes panel while the note it names is listed there, and goes to
  the diff otherwise.
- A note's id is minted once by `mintNoteId`, as its location plus a `|#<unique>` suffix, and never re-derived. Statuses match on it, so a note written where a handled one stood is a new note. Stored notes whose id lacks that suffix are re-minted on restore as fresh, unsubmitted notes. Do not make ids derivable from location again.
- A verdict only reaches a note that was handed over: `markSubmitted` stamps `sentAt` from the saved review file's name at first submission. The `noteKey` heading fallback, for a review file that lost its marker, additionally needs a heading claimed by exactly one submitted note and a file no older than that stamp.
- A note may instead cover a whole file. It uses `*` for both row anchors, carries `scope:"file"` and no captured code, and renders as `### <path> (whole file)`. One per file, found by that anchor rather than by a predictable id, and mounted under the file header so binary and collapsed files keep it. `noteKey` must keep producing that same heading text.
- A note may belong to no file at all. It uses `@` for both row anchors, carries `scope:"global"` and an empty
  `file`, and renders as `### Overall note` under `## Overall`, ahead of every file section. There is no limit
  on how many a review has; **Overall note** in the footer writes another. Everything a note has, one has —
  its own id, thread, verdict, edit and delete — and the one thing it does not have is a place on the diff, so
  `placeNote` answers `global` for it and it is read in the card above the first file. Prose an earlier lcr
  wrote directly under `## Overall`, and a `general` field in the browser store, are both read back as one of
  these; that is the only thing left of the single overall field, and neither the submission nor the page has
  one any more.
- File hide patterns are a display preference in settings. Manual eye toggles keep overriding them per file.
- The header toggle collapses the file tree pane, and that state is a settings preference like the rest. Collapsing changes the diff pane's width, so it drops cached block heights and renders the diff again, exactly as a window resize does.
- The diff pane lists the files in the order the tree lists them. `tree-model.ts` owns both the tree's shape
  and that order, and `load` puts `state.files` in it once, before `state.byPath` is built from it — so
  everything downstream that reads "diff order", the pane and the note and bookmark lists and the review
  file's own sections, reads the one order the reviewer sees. Git sorts a path whole, which files a folder's
  own files after its subfolders; do not order the pane by the diff's own listing again.
- The tree follows the diff: the file under the top of the diff pane carries `.tw.sel`, read once per animation frame while scrolling and again after every tree or diff render. A file whose row is folded away marks the deepest folder still shown. The tree only scrolls itself when that row changes, so expanding a folder does not drag the pane back to the file being read.
- Resetting viewed files goes through `setViewed`, so folds, stale badges, and the automatic-mark tracker unwind together with the marks. Notes and hide marks are not progress and stay. The button label is written by `updateCount`, which is the one place that counts marks.
- Hunk separators expand the unchanged lines git left out. `/api/context` re-diffs one file with unlimited context and answers an inclusive new-side line range, which keeps every revision spec working without picking a side to read blobs from. The page splices those rows into the file, rebuilds the hunk header from the rows it now covers, and drops a separator once its gap closes. Expansions live only in the page; a reload starts over.
- The trailing separator is inferred: git prints at most `-U` context lines after the last change, so a full run means the file continues. `/api/diff` must keep reporting `context` for that. A run that happened to end on the last line self-corrects, because the first expansion comes back empty and drops the separator.
- Revealed lines are ordinary context rows, so notes anchor to them normally. Row indices below an insertion all move, which is why the file's table is rendered again and both row-indexed caches (`wd`, `ki`) are dropped. Cached block heights above the insertion stay valid and must be kept, or the page jumps.
- Folding deleted lines is only ever about what is drawn. With the setting on, every run of removed rows
  becomes one marker row that opens the run again; the rows stay in the file, so notes, anchors, word diff
  and bookmarks all read the same diff either way. A run is keyed by the old-side line it starts on, and cut
  at block boundaries, because a block is the unit that gets drawn and a row index moves when context is
  revealed. Which runs stand open is this read rather than a preference: `state.openDel` holds them and
  storage never sees them. A run holding a note is drawn open and says why — a note that quietly stopped
  being drawn is one nobody knows to look for — and a jump opens the fold over the row it lands on.
  `drawnRows` is what an unmounted block's placeholder height is estimated from, and flipping the setting
  drops every measured height with it.
- The fold setting is toggled from the page header, not from the settings panel: `client/quick.ts` owns
  that row of toggles, which are ordinary `state.cfg` preferences written through `persistCfg` rather
  than fields `saveCfg` reads. A setting answered while reading belongs where the reading is; the panel
  keeps the prose that says what it does, and adding another quick toggle is another entry in `QUICK`.
- The setting is a default and a file may answer for itself: **removed** in a file's header folds that one
  file's removed lines away, or opens them, whichever way the setting stands, and the answer keeps holding
  when the setting later moves. `state.delFold` holds it by path — a display preference like a hide mark,
  so it is stored with them — and `foldingDeleted(path)` is the one place the two are resolved. Flipping a
  file drops the runs it had open, because folding a file folds all of it, and redraws only that file:
  row indices have not moved, so nothing is rebound, but every height it measured under the old fold goes.
  The pane holds the topmost row it was showing still, answered for by the marker standing in its place
  when the fold has just taken that row away.
- A file git prints no lines of may still be worth seeing: an image is drawn as its two sides, old
  before new, and as the single side it has when it was only added or only deleted. `client/images.ts`
  owns which extensions that covers and the markup; `/api/blob` serves one side of one file, and the
  diff on screen is the whole of what may be asked for — a path it does not list is not served, an
  image's old side is looked up under the name a rename moved it from, and the side that added or
  deleted the file answers 404 rather than an empty picture. The file's own hash is the response's
  ETag, so the repaints a diff refresh causes revalidate instead of reloading the picture. `diffSides`
  is what says where each side is read from, because a binary diff is the one thing that cannot be
  read out of git's own output; a bare argument that is not a commit is a pathspec and is left out of
  that reading. A text file with an image extension — an SVG — is drawn as well as diffed.
- The browser store is keyed on repository and read together — the range, or the `--id` name when the run has
  one. Every run serves from `localhost` and a port one review frees the next one takes, so the origin cannot tell two projects apart; `/api/diff` reports `repo` as `repoId`, a hash of the repository root, and the page keys on `<repo>:<range>` or `<repo>:#<id>`. The path itself never reaches the page, because the store outlives the run.
- Bookmarks are navigation, not feedback: they are never submitted, and `Clear all` in the footer leaves them alone. One per row, keyed by `bmKey` on the same row anchor a note uses, so revealed context carries them and `keyIndex` turns them back into a place on screen.
- Bookmarks last one sitting, not one project. They live in `sessionStorage` under their own key, stamped with the read that made them: the tab that closes takes them, a reload keeps them, and a record whose stamp is another repository or range is dropped rather than restored. **New review** clears them too. Notes are the opposite and stay in the durable per-repository store.
- The bookmark list sits under the file tree, in the pane the header toggle hides, and shows itself only while something is bookmarked. It reads in diff order, not the order bookmarks were made, so stepping through it walks the review top to bottom; one whose file or line the diff no longer holds sorts to the end as `gone`. `alt+up`/`alt+down` step it from anywhere outside a text field.
- Both lists under the tree fold to their headers, and each fold is a settings preference like the tree's own.
  A folded list keeps its count and its stepping buttons, so `alt+j`/`alt+k` and `alt+up`/`alt+down` still walk it.
  Neither fold changes the diff pane's width, so unlike the tree toggle neither re-renders the diff.
- A jump has to be able to land: it un-hides the file, expands it if a viewed mark folded it, and mounts the one block its row lives in, because that row may be in a file the pane never scrolled through. The viewed mark itself is progress and survives the jump.
- Every note is readable as a list as well as as a mark on the diff: the pane under the file tree, and the
  all-notes panel over it. Both read `orderedNotes`, so both are in the order the diff shows them — the review's
  own notes first, then down the files, a file's own note ahead of the lines it covers, one the file can no
  longer place after them, and a note whose file left the diff last of all. Neither list may tell a different
  story than the pane beside it.
- The all-notes panel covers the diff rather than replacing it, which is why `#diff` sits in `.pane` with it
  rather than in `main`. Nothing is unmounted, so the diff keeps its scroll position and its mounted rows, and
  **in diff** on any note is one jump away. A tab, a route, or a `display:none` would cost all three.
- A note in the panel is a note box like any other: `mountNoteIn` gives it the same thread, reply, edit and
  delete the diff gives it, and `viewUI` reads its own surroundings to know it is there. One note is therefore
  mounted twice, and everything that changes a note has to reach both copies — `repaintNote` walks them by
  `data-nid`, editing one repaints the rest, and deleting one takes them all.
- The panel is rebuilt only when the notes it lists actually change; a note whose placement moved is redrawn
  where it stands. A rebuild that would eat a reply being written is deferred instead of taken, and the idle
  check in `live.ts` that takes a waiting diff refresh takes it too. Closing the panel, or jumping to the diff
  out of it, asks first when something is half-written — and a jump the reader calls off must not happen behind
  the panel either.
- The panel's filters are `all`, `new`, `open`, and `done`. Only `applied`, `answered`, and `skipped` finish a
  note; everything else, an unknown kind included, is open. Adding a status kind therefore needs nothing here.
- `alt+j`/`alt+k` step the note list from anywhere outside a text field, `alt+c` opens the panel and closes it,
  and `j`/`k` step it entry by entry while it is open. `alt` plus the arrows stays the bookmark list's. Letters
  are read off `code` rather than `key`, because alt turns a letter into another character entirely on macOS.
- Where a note shows is worked out by `client/anchor.ts`, never stored: the agent rewrites the code notes were
  written against, so an anchor is re-derived from the diff on every load. It degrades in order — the note's own
  rows while they still hold its captured code, then that code wherever it now reads, then its unchanged lines
  only, then the nearest line left within `NEAR`. A note is cut loose only when none of that lands: it then
  shows under its own file, and at the end of the page once the file itself leaves the diff.
- Every note carries the lines it was written on, framed like the suggestion block. A note is read a long way
  from where it was made, so it has to be legible on its own; the heading changes to say the code is a record
  rather than the file's current state as soon as the note is not sitting on those lines any more.
- Generated review files carry `<!-- lcr:<note-id> -->` on each note heading and a `Status:` line per note. `collectStatuses` reads them back on start so handled notes can be cleared. Keep both sides of that contract in step.
- Status kinds are `applied`, `answered`, `skipped`, `needs-input`, `pending`, and `unknown`. `answered` is for a note that only asked a question and needed no edit; it keeps full opacity and stays out of **Remove N applied**. Adding a kind means touching `readStatus` synonyms, `NoteStatusKind`, the `renderMarkdown` footer, and the `.stat` badge styles together.

## Change guidance

- Prefer focused edits within existing module boundaries over unrelated restructuring.
- Preserve no-install usage.
- Avoid shell interpolation for Git commands; use argument arrays.
- Escape user-controlled values rendered into HTML.
- Page sizing comes from the `--fs-*`, `--icon`, `--tap`, and `--row` tokens in `src/web/styles.css`; size new UI from them
  rather than from fresh literals, and keep every control at least `--tap` square. `--row` travels with `ROW_H` in
  `client/diff-view.ts`, which estimates unmounted blocks, and with `ROW_SLIP` in `client/drag.ts`, which must stay above
  half a row so a wobble cannot turn a text drag into a row selection.
- Keep server API local-purpose and avoid adding remote access, telemetry, or network dependencies.
- When applying review feedback, the only permitted edits to generated `.review/review-*.md` files are each
  note's `Status:` line and an appended `**Agent**` message in that note's section. Never rewrite, rename, or
  delete them, and never touch a `**Reviewer**` message. Deleting the files is the user's call, from
  **Settings → Review file**.

## Validation

Run relevant checks after changes:

```sh
bun test ./src
bun build ./src/index.ts --target=bun --outdir /tmp/lcr-check
bun build ./src/index.ts --compile --minify --outfile /tmp/lcr
```

For behavior changes, smoke-test in temporary Git repository with modified, staged, added, deleted, and untracked files. Verify explicit ranges when diff argument handling changes. Do not commit generated executables or review files.

After skill changes, verify copies match:

```sh
cmp -s skills/apply-lcr/SKILL.md .agents/skills/apply-lcr/SKILL.md
```

## Releases

- Version tags use `v*` form, such as `v0.1.0`.
- `.github/workflows/release.yml` builds Linux x64/ARM64, macOS x64/ARM64, and Windows x64 packages and uploads them to matching GitHub Release.
- Keep executable inside each package named `lcr` (`lcr.exe` on Windows); use platform-specific archive names.
- Keep `contents: write` permission scoped to release workflow.
