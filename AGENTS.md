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
- The review file is round-trippable. Every field a note carries on the page is recoverable from the Markdown,
  which is what lets a restarted server, or a second tab, adopt notes the browser never had. The anchors live in
  the note's own id, so `parseReview` reads them out of `<!-- lcr:<id> -->` rather than out of the heading text.
- Both sides write the review file: lcr renders it whole, the agent appends messages and rewrites `Status:`
  lines. Every mutation in `session.ts` therefore re-reads the file first and keeps what it does not own. A save
  updates the reviewer's wording and leaves the agent's thread and verdict exactly as written; a note the page
  no longer sends stays in the file, because handing a note over is not withdrawing it. Deleting the note on
  the page is the one thing that takes it out.
- A note's section is written verdict-first — captured code, note, `Status:`, then the thread — so both sides
  only ever append. Prose after the `Status:` line with no `**Agent**`/`**Reviewer**` line above it is read as
  an agent message rather than dropped, and a status line still wins until the first explicit message, so an
  agent that appends its verdict instead of replacing `pending` is still understood.
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
- One line or range holds any number of notes. Each gets its own box under the anchor row, matched by `data-nid`. Removing one repaints the span it covered rather than clearing it, because other notes may still cover those lines.
- One note editor stands open at a time. An untouched draft still moves to wherever the next click lands; a box with
  text in it keeps the floor, and anything that would open a second editor scrolls that one back into view and focuses
  it instead.
- The editor seeds a fenced `suggestion` block from the lines the note covers. A note narrowed to part of a line still
  suggests whole lines, because a suggestion replaces lines; the fence outgrows any backticks in the code. The block is
  ordinary note body text, so it reaches the review file verbatim, and `apply-lcr` reads it as the proposed replacement.
  A saved note shows it as code, coloured line by line by the diff's own `codeHtml`: class `c` is what carries the
  syntax token styles, so every container of highlighted code needs it.
- A note's id is minted once by `mintNoteId`, as its location plus a `|#<unique>` suffix, and never re-derived. Statuses match on it, so a note written where a handled one stood is a new note. Stored notes whose id lacks that suffix are re-minted on restore as fresh, unsubmitted notes. Do not make ids derivable from location again.
- A verdict only reaches a note that was handed over: `markSubmitted` stamps `sentAt` from the saved review file's name at first submission. The `noteKey` heading fallback, for a review file that lost its marker, additionally needs a heading claimed by exactly one submitted note and a file no older than that stamp.
- A note may instead cover a whole file. It uses `*` for both row anchors, carries `scope:"file"` and no captured code, and renders as `### <path> (whole file)`. One per file, found by that anchor rather than by a predictable id, and mounted under the file header so binary and collapsed files keep it. `noteKey` must keep producing that same heading text.
- File hide patterns are a display preference in settings. Manual eye toggles keep overriding them per file.
- The header toggle collapses the file tree pane, and that state is a settings preference like the rest. Collapsing changes the diff pane's width, so it drops cached block heights and renders the diff again, exactly as a window resize does.
- The tree follows the diff: the file under the top of the diff pane carries `.tw.sel`, read once per animation frame while scrolling and again after every tree or diff render. A file whose row is folded away marks the deepest folder still shown. The tree only scrolls itself when that row changes, so expanding a folder does not drag the pane back to the file being read.
- Resetting viewed files goes through `setViewed`, so folds, stale badges, and the automatic-mark tracker unwind together with the marks. Notes and hide marks are not progress and stay. The button label is written by `updateCount`, which is the one place that counts marks.
- Hunk separators expand the unchanged lines git left out. `/api/context` re-diffs one file with unlimited context and answers an inclusive new-side line range, which keeps every revision spec working without picking a side to read blobs from. The page splices those rows into the file, rebuilds the hunk header from the rows it now covers, and drops a separator once its gap closes. Expansions live only in the page; a reload starts over.
- The trailing separator is inferred: git prints at most `-U` context lines after the last change, so a full run means the file continues. `/api/diff` must keep reporting `context` for that. A run that happened to end on the last line self-corrects, because the first expansion comes back empty and drops the separator.
- Revealed lines are ordinary context rows, so notes anchor to them normally. Row indices below an insertion all move, which is why the file's table is rendered again and both row-indexed caches (`wd`, `ki`) are dropped. Cached block heights above the insertion stay valid and must be kept, or the page jumps.
- Bookmarks are navigation, not feedback: they are stored with the notes for a range but never submitted, and `Clear all` in the footer leaves them alone. One per row, keyed by `bmKey` on the same row anchor a note uses, so revealed context carries them and `keyIndex` turns them back into a place on screen.
- The bookmark list sits under the file tree, in the pane the header toggle hides, and shows itself only while something is bookmarked. It reads in diff order, not the order bookmarks were made, so stepping through it walks the review top to bottom; one whose file or line the diff no longer holds sorts to the end as `gone`. `alt+up`/`alt+down` step it from anywhere outside a text field.
- A jump has to be able to land: it un-hides the file, expands it if a viewed mark folded it, and mounts the one block its row lives in, because that row may be in a file the pane never scrolled through. The viewed mark itself is progress and survives the jump.
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
