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

New releases also include a matching `.sha256` file.

Linux archives contain executable named `lcr`:

```sh
tar -xzf lcr-linux-<architecture>.tar.gz
mkdir -p ~/.local/bin
install -m 755 lcr ~/.local/bin/lcr
```

For macOS, Apple silicon (M1 and newer, including M4) uses `lcr-macos-arm64.tar.gz`; Intel Macs use `lcr-macos-x64.tar.gz`. Linux ARM64 cannot run on macOS even though both use an ARM64 CPU.

macOS executables do not carry an Apple Developer ID signature or notarization. Gatekeeper therefore quarantines packages downloaded through a browser. Verify the checksum from the same GitHub Release, then remove quarantine from that archive before extracting it:

```sh
package=lcr-macos-arm64.tar.gz # Use lcr-macos-x64.tar.gz on an Intel Mac.
shasum -a 256 -c "$package.sha256"
xattr -d com.apple.quarantine "$package" 2>/dev/null || true
tar -xzf "$package"
mkdir -p ~/.local/bin
install -m 755 lcr ~/.local/bin/lcr
```

Only remove quarantine after the checksum passes for a package downloaded from this repository. Run `lcr` from Terminal inside a Git repository; it is a command-line tool, not an app opened from Finder.

Windows archive contains `lcr.exe`. Extract it and place it in directory on `PATH`.

## Run

From any Git repository:

```sh
lcr
```

The page opens in the default browser at <http://localhost:7777>. Pass `--no-open` to keep it closed and open the URL yourself.

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

# Serve without opening a browser
lcr --no-open
```

Arguments not recognized as tool flags are passed to `git diff`.

## Review workflow

1. Select a file from the tree.
2. Click or drag over diff lines to add a note. Shift-click extends selection. Same line or range takes as many notes as you want: each click opens a fresh note, and each keeps its own box with its own **Edit** and **Delete**.
3. Select text inside a single line to comment on that fragment only. Note anchors to those columns, and selected text is highlighted until note is deleted. Drag that strays onto neighbouring lines and returns keeps the fragment from press point to pointer; return to press point and release to note whole line instead.
4. Select **comment** in file header to note file as a whole, for feedback that belongs to no single line. Note appears under header and holds one note per file. Binary and collapsed files accept whole-file notes too.
5. Press <kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Enter</kbd> to save note, or <kbd>Esc</kbd> to cancel. <kbd>Enter</kbd> adds a line. **Settings → Note editor** swaps the two, so <kbd>Enter</kbd> saves and <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line.
6. Add optional overall feedback in footer.
7. Select **Save review**.

Review is written to `.review/review-<timestamp>.md` by default. `.review/` is ignored by Git, and custom relative output directories are added to `.git/info/exclude`.

Notes include code snippets because line numbers may move before agent addresses feedback:

````md
## src/components/StatCard.tsx

### src/components/StatCard.tsx:42 <!-- lcr:src/components/StatCard.tsx|n42|n42|#mf3k2p1 -->

```diff
     <dl className="kpi">
+      <div role="group">
       <dt>{label}</dt>
```

Use `dl`/`dt`/`dd` without wrapper `div`; group role is redundant.

Status: pending
````

Fragment notes add columns to heading and name selected text, so agent changes only that part of line:

````md
### src/api/client.ts:88:11-19 <!-- lcr:src/api/client.ts|n88|n88|10-19|#mf3k2p2 -->

```diff
+  const tmpValue = await fetchProfile(userId);
```

Applies to this part of the line only: `tmpValue`

Name it `profile`; it outlives the call.

Status: pending
````

Whole-file notes lead their file section, name no line, and carry no snippet:

````md
### src/api/client.ts (whole file) <!-- lcr:src/api/client.ts|*|*|#mf3k2p3 -->

Request building and response parsing belong in separate modules.

Status: pending
````

Ask agent to address newest review file while treating code snippet as authoritative anchor. Agent should apply valid notes, explain rejected notes, then run project checks.

## Note status round trip

Agent reports each note back inside review file by replacing its `Status: pending` line:

```md
Status: applied — renamed to profile
Status: answered — retry wrapper exists because upstream throws on cold start
Status: skipped — default of 3 is documented upstream
Status: needs-input — which type should it export?
```

`answered` covers note that only asked question, such as why code exists or what it does. Agent either fixes code when question exposes real problem, or leaves it alone and answers on status line.

Nothing else in file may change, and `<!-- lcr:... -->` heading markers must stay. Next `lcr` run reads every `review-*.md` in output directory, newest verdict per note winning, and shows result on note:

- Note carries status badge and reported reason.
- Applied notes dim, and footer offers **Remove N applied** to drop them from local state after confirmation.
- Answered notes stay full strength and are not swept by that button, so answer stays readable until note is deleted.
- Individual notes stay removable with **Delete**.

Files without status lines predate this format and are read as unprocessed.

Marker identifies note itself, not line it sits on. Note written where handled one used to be is new note and reads as pending, so clearing notes and commenting on same line again starts clean. Notes stored by versions before this one are read the same way, as fresh notes, which drops verdicts already reported for them.

## Expanding context

Every hunk separator carries arrows for the unchanged lines the diff left out. The down arrow continues the hunk above, the up arrow continues the one below, and a gap no larger than one step opens whole in a single click. The separator disappears once its gap is closed, merging the two hunks. A file that runs on past its last hunk keeps a separator at the bottom, which reaches towards the end of the file and then disappears.

**Settings → Expand context** sets how many lines one click reveals. Revealed lines are ordinary context lines, so they can be commented on like any other. Expansions are not saved; **Reload diff** starts from the original hunks again.

## Hiding files

Tree eye icons hide single files or whole folders. For repeating cases, open **Settings → Hide files**.

**Hide files the diff deletes entirely** drops every file with status `deleted`, which is useful when a change removes large trees that have nothing left to read.

The pattern box below it takes one glob per line:

```text
*.test.*
dist/
*.lock
# comments and blank lines are ignored
```

`*` stops at `/`, `**` crosses it, `?` matches one character. Pattern without `/` matches file name at any depth, and trailing `/` hides everything below matching directory. Both settings persist across sessions; eye icon still reveals individual hidden file, and hiding it again returns it to the setting.

Git-level exclusion also works through pathspecs, which keeps files out of diff entirely:

```sh
lcr -- . ':(exclude)*.test.*'
```

## Optional agent skill

Repository includes optional [`apply-lcr`](skills/apply-lcr/SKILL.md) skill. It locates newest review, anchors notes by captured code, applies valid feedback, rejects unsafe or incorrect requests, runs project checks, records status per note in review file, and reports result per note.

Skill is vendor-neutral: it names no specific agent, uses only `name` and `description` frontmatter shared by Agent Skills implementations, and works with any tool that loads skills from listed roots.

Open **Settings → Create skill** to install it. lcr shows destination and full skill contents before asking for confirmation. It uses existing project skill directories for Agent Skills-compatible tools, including `.agents`, `.agent`, `.augment`, `.claude`, `.cline`, `.clinerules`, `.codex`, `.cursor`, `.factory`, `.gemini`, `.github`, `.goose`, `.junie`, `.kilo`, `.kiro`, `.opencode`, `.qwen`, `.roo`, and `.windsurf` roots. If none has a `skills` directory in folder where lcr started, it creates `.agents/skills`. Installation never runs automatically.

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
- Reload button re-reads Git state and note statuses. Server intentionally has no watcher or WebSocket.
- Draft notes and view state persist in browser local storage. Hide patterns persist as browser setting.
- Added and context lines are commentable. Deleted-only lines can be selected, but fixes should usually anchor to adjacent current code.
- Expanding a hunk separator re-reads that one file from Git with unlimited context, so it works for every diff argument the tool accepts, including staged-only and commit ranges.
- Fragment notes anchor to line plus character range. Selecting whole line, or only whitespace, falls back to plain line note.
- Drag decides its own scope: rows while pointer sits on another line, fragment while it sits on pressed line away from press point, whole line while it rests back on press point.
- Whole-file notes anchor to path only, so they survive any line movement. Each file holds one, and it stays visible while file is collapsed.
- Binary file contents are not rendered, but binary files still accept whole-file notes.
- Git must remain available on `PATH`.

## Release executable

Maintainers publish by pushing version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds standalone executables with Bun and packages each supported system. macOS binaries are built on hosted runners matching their architecture; other targets are cross-compiled on Linux. The release includes one SHA-256 file per package, creates the GitHub Release when needed, and uploads all packages. Executable inside every package is named `lcr` (`lcr.exe` on Windows).

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
