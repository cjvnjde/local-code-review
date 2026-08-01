# Local Code Review

Standalone local web UI for reviewing Git diffs and writing agent-friendly feedback.

Download one executable from GitHub Releases. No install, runtime, or dependencies besides Git. Review notes are saved as Markdown files that coding agents can apply later.

## Requirements

- Git
- Linux, macOS, or Windows

## Install

Download matching package from [latest GitHub Release](https://github.com/cjvnjde/local-code-review/releases/latest):

| System | Package |
| --- | --- |
| Linux x64 | `lcr-linux-x64.tar.gz` |
| Linux ARM64 | `lcr-linux-arm64.tar.gz` |
| macOS x64 | `lcr-macos-x64.tar.gz` |
| macOS ARM64 | `lcr-macos-arm64.tar.gz` |
| Windows x64 | `lcr-windows-x64.zip` |

Linux/macOS archives contain executable named `lcr`:

```sh
tar -xzf lcr-<system>-<architecture>.tar.gz
chmod +x lcr
mkdir -p ~/.local/bin
mv lcr ~/.local/bin/lcr
```

Windows archive contains `lcr.exe`. Extract it and place it in directory on `PATH`.

## Run

From any Git repository:

```sh
lcr
```

Open <http://localhost:7777>.

Examples:

```sh
# Working tree, staged changes, and untracked files versus HEAD
lcr

# Last three commits
lcr HEAD~3

# Current branch versus main
lcr main...HEAD

# Staged changes only
lcr --staged

# Custom server port, output directory, and diff context
lcr --port 8080 --out .review --context 8
```

Arguments not recognized as tool flags are passed to `git diff`.

## Review workflow

1. Select a file from the tree.
2. Click or drag over diff lines to add a note. Shift-click extends selection.
3. Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Enter</kbd> to save note, or <kbd>Esc</kbd> to cancel.
4. Add optional overall feedback in footer.
5. Select **Save review**.

Review is written to `.review/review-<timestamp>.md` by default. `.review/` is ignored by Git, and custom relative output directories are added to `.git/info/exclude`.

Notes include code snippets because line numbers may move before agent addresses feedback:

````md
## src/components/StatCard.tsx

### src/components/StatCard.tsx:42

```diff
     <dl className="kpi">
+      <div role="group">
       <dt>{label}</dt>
```

Use `dl`/`dt`/`dd` without wrapper `div`; group role is redundant.
````

Ask agent to address newest review file while treating code snippet as authoritative anchor. Agent should apply valid notes, explain rejected notes, then run project checks. Review file should remain unchanged.

## Optional agent skill

Repository includes optional [`apply-lcr`](skills/apply-lcr/SKILL.md) skill. It locates newest review, anchors notes by captured code, applies valid feedback, rejects unsafe or incorrect requests, runs project checks, and reports result per note.

```text
skills/apply-lcr/SKILL.md          # distributable example
.agents/skills/apply-lcr/SKILL.md  # project-local copy
```

This follows `skills/<kebab-case-name>/SKILL.md` convention for shared skills and `.agents/skills/<name>/SKILL.md` for project-local discovery. Copies are intentionally identical.

Invoke naturally:

```text
Address newest lcr review.
Apply notes from .review/review-2026-08-01T12-00-00.md.
```

Or invoke `/apply-lcr` when agent supports skill commands. Clients using another discovery directory can copy `skills/apply-lcr/` into their configured skills directory.

Skill remains optional; `lcr` itself has no agent integration or runtime dependency.

## Behavior

- Default mode includes modified, staged, and untracked files. Untracked files become visible through `git add -N` intent-to-add entries.
- Reload button re-reads Git state. Server intentionally has no watcher or WebSocket.
- Draft notes and view state persist in browser local storage.
- Added and context lines are commentable. Deleted-only lines can be selected, but fixes should usually anchor to adjacent current code.
- Binary file contents are not rendered.
- Git must remain available on `PATH`.

## Release executable

Maintainers publish by pushing version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions cross-compiles standalone executables with Bun, packages each supported system, creates release when needed, and uploads all packages. Executable inside every package is named `lcr` (`lcr.exe` on Windows).

## Develop

Source lives in `src/` and uses TypeScript. Browser HTML, CSS, and client modules are bundled into the executable; no runtime asset files or packages are needed.

```sh
bun ./src/index.ts [git diff args...]
```

## Build locally

```sh
bun build ./src/index.ts --compile --minify --outfile lcr
```

Compiled executable needs only Git at runtime.
