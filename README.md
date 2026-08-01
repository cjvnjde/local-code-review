# Local Code Review

Standalone local web UI for reviewing Git diffs and writing agent-friendly feedback.

Download one executable from GitHub Releases. No install, runtime, or dependencies besides Git. Review notes are saved as Markdown files that coding agents can apply later.

## Requirements

- Git
- Linux x64

## Install

Download `lcr` from [latest GitHub Release](https://github.com/cjvnjde/local-code-review/releases/latest):

```sh
chmod +x lcr
mkdir -p ~/.local/bin
mv lcr ~/.local/bin/lcr
```

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

GitHub Actions compiles source with Bun, creates release when needed, and uploads executable.

## Build locally

```sh
bun build ./local-code-review.mjs --compile --minify --outfile lcr
```

Compiled executable needs only Git at runtime.
