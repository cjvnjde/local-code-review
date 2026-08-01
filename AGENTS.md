# Agent Instructions

## Project shape

- `local-code-review.mjs` is complete application: CLI, Git integration, HTTP server, HTML, CSS, and browser JavaScript.
- Keep runtime dependency-free. Do not add package manager files or third-party runtime packages unless explicitly requested.
- Use Bun for source checks and compilation.
- Keep browser assets embedded in `local-code-review.mjs`; release must remain one standalone executable.
- `skills/apply-lcr/` is distributable optional skill. `.agents/skills/apply-lcr/` is project-local copy. Keep their files byte-identical.

## Behavior to preserve

- Default diff includes working-tree, staged, and untracked changes versus `HEAD`.
- Explicit CLI arguments continue to pass through to `git diff`.
- Review output remains Markdown under `.review/` by default.
- Default `.review/` output remains ignored. Custom relative output directories remain locally excluded through `.git/info/exclude`.
- Reload stays explicit. Do not add watchers or live updates that could discard review state without clear approval.
- Review notes anchor on captured code plus line metadata.

## Change guidance

- Prefer focused edits over restructuring single-file application.
- Preserve no-install usage.
- Avoid shell interpolation for Git commands; use argument arrays.
- Escape user-controlled values rendered into HTML.
- Keep server API local-purpose and avoid adding remote access, telemetry, or network dependencies.
- Do not edit or delete generated `.review/review-*.md` files when applying review feedback.

## Validation

Run relevant checks after changes:

```sh
bun build ./local-code-review.mjs --target=bun --outfile /tmp/lcr-check.mjs
bun build ./local-code-review.mjs --compile --minify --outfile /tmp/lcr
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
