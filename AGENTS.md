# Agent Instructions

## Project shape

- `src/index.ts` is composition root. Keep CLI, Git, diff parsing, review output, server, and browser concerns in focused modules under `src/`.
- Keep runtime dependency-free. Do not add package manager files or third-party runtime packages unless explicitly requested.
- Use Bun for source checks, browser bundling, and standalone compilation.
- Keep browser assets imported through `src/web/shell.html`; compiled release must remain one standalone executable.
- `skills/apply-lcr/` is distributable optional skill. `.agents/skills/apply-lcr/` is project-local copy. Keep their files byte-identical.
- Skill stays vendor-neutral: no tool-specific frontmatter keys, no vendor names in its text. `SKILL_DIRECTORIES` lists per-tool install roots and may grow; `.agents/skills` remains the fallback.

## Behavior to preserve

- Default diff includes working-tree, staged, and untracked changes versus `HEAD`.
- Explicit CLI arguments continue to pass through to `git diff`.
- Review output remains Markdown under `.review/` by default.
- Default `.review/` output remains ignored. Custom relative output directories remain locally excluded through `.git/info/exclude`.
- Start opens the page in the default browser unless `--no-open` is passed. Launch stays best-effort: failure prints a hint and never blocks the server.
- Reload stays explicit. Do not add watchers or live updates that could discard review state without clear approval.
- The page is served from `/` with `cache-control: no-store`; the HTML bundle route stays on `/index.html`. Bun gives that route one ETag for every build, so mounting the bundle on `/` again lets a browser revalidate into an older page whose asset chunks are gone.
- Review notes anchor on captured code plus line metadata. A note may narrow to a character range inside one line; keep its columns, snippet, and `ca`/`cb` offsets together with the line anchor.
- One line or range holds any number of notes. Each gets its own box under the anchor row, matched by `data-nid`. Removing one repaints the span it covered rather than clearing it, because other notes may still cover those lines.
- A note's id is minted once by `mintNoteId`, as its location plus a `|#<unique>` suffix, and never re-derived. Statuses match on it, so a note written where a handled one stood is a new note. Stored notes whose id lacks that suffix are re-minted on restore as fresh, unsubmitted notes. Do not make ids derivable from location again.
- A verdict only reaches a note that was handed over: `markSubmitted` stamps `sentAt` from the saved review file's name at first submission. The `noteKey` heading fallback, for a review file that lost its marker, additionally needs a heading claimed by exactly one submitted note and a file no older than that stamp.
- A note may instead cover a whole file. It uses `*` for both row anchors, carries `scope:"file"` and no captured code, and renders as `### <path> (whole file)`. One per file, found by that anchor rather than by a predictable id, and mounted under the file header so binary and collapsed files keep it. `noteKey` must keep producing that same heading text.
- File hide patterns are a display preference in settings. Manual eye toggles keep overriding them per file.
- Hunk separators expand the unchanged lines git left out. `/api/context` re-diffs one file with unlimited context and answers an inclusive new-side line range, which keeps every revision spec working without picking a side to read blobs from. The page splices those rows into the file, rebuilds the hunk header from the rows it now covers, and drops a separator once its gap closes. Expansions live only in the page; a reload starts over.
- The trailing separator is inferred: git prints at most `-U` context lines after the last change, so a full run means the file continues. `/api/diff` must keep reporting `context` for that. A run that happened to end on the last line self-corrects, because the first expansion comes back empty and drops the separator.
- Revealed lines are ordinary context rows, so notes anchor to them normally. Row indices below an insertion all move, which is why the file's table is rendered again and both row-indexed caches (`wd`, `ki`) are dropped. Cached block heights above the insertion stay valid and must be kept, or the page jumps.
- Generated review files carry `<!-- lcr:<note-id> -->` on each note heading and a `Status:` line per note. `collectStatuses` reads them back on start so handled notes can be cleared. Keep both sides of that contract in step.
- Status kinds are `applied`, `answered`, `skipped`, `needs-input`, `pending`, and `unknown`. `answered` is for a note that only asked a question and needed no edit; it keeps full opacity and stays out of **Remove N applied**. Adding a kind means touching `readStatus` synonyms, `NoteStatusKind`, the `renderMarkdown` footer, and the `.stat` badge styles together.

## Change guidance

- Prefer focused edits within existing module boundaries over unrelated restructuring.
- Preserve no-install usage.
- Avoid shell interpolation for Git commands; use argument arrays.
- Escape user-controlled values rendered into HTML.
- Keep server API local-purpose and avoid adding remote access, telemetry, or network dependencies.
- When applying review feedback, the only permitted edit to generated `.review/review-*.md` files is each note's `Status:` line. Never rewrite, rename, or delete them.

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
