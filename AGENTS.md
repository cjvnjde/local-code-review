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
- Reload stays explicit. Do not add watchers or live updates that could discard review state without clear approval.
- The page is served from `/` with `cache-control: no-store`; the HTML bundle route stays on `/index.html`. Bun gives that route one ETag for every build, so mounting the bundle on `/` again lets a browser revalidate into an older page whose asset chunks are gone.
- Review notes anchor on captured code plus line metadata. A note may narrow to a character range inside one line; keep its columns, snippet, and `ca`/`cb` offsets together with the line anchor.
- A note may instead cover a whole file. It uses `*` for both row anchors, carries `scope:"file"` and no captured code, and renders as `### <path> (whole file)`. One per file, mounted under the file header so binary and collapsed files keep it. `noteKey` must keep producing that same heading text.
- File hide patterns are a display preference in settings. Manual eye toggles keep overriding them per file.
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
