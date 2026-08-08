# Local Code Review

Small standalone web UI for reviewing local Git changes and writing feedback for coding agents.

![Local Code Review showing a Git diff with line notes](docs/local-code-review.png)

## Install

Download the package for your system from the [latest release](https://github.com/cjvnjde/local-code-review/releases/latest), extract it, and put `lcr` (`lcr.exe` on Windows) somewhere on your `PATH`.

`lcr` only needs Git. macOS builds are unsigned, so a downloaded binary may need quarantine removed after you verify its release checksum:

```sh
xattr -d com.apple.quarantine ./lcr
```

## Use

Run inside any Git repository:

```sh
lcr
```

The review page opens at <http://localhost:7777>. It includes working-tree, staged, and untracked changes against `HEAD`.

Common commands:

```sh
lcr --no-open                 # Do not open the browser automatically
lcr --staged                  # Staged changes only
lcr HEAD~3                    # Last three commits
lcr main...HEAD               # Compare current branch with main
lcr --port 8080               # Use another port
lcr --out .feedback           # Store reviews elsewhere
lcr --context 8               # Show more surrounding lines
```

Arguments not recognized by `lcr` are passed to `git diff`.

## How it works

1. Open `lcr` in a repository with changes.
2. Click a diff line, drag across lines, or select part of one line to add a note. File-level notes and bookmarks are also available.
3. Add optional overall feedback, then select **Save review**.
4. `lcr` writes `.review/review-<timestamp>.md`. The default `.review/` directory is ignored by Git.
5. Give that Markdown review to your coding agent.

A simple agent prompt is enough:

```text
Address the newest lcr review in .review/.
```

The review contains file paths, line anchors, captured code, and note text, so the agent can still find the intended code after line numbers move.

### Optional agent skill

This repository includes [`apply-lcr`](skills/apply-lcr/SKILL.md), a small skill that finds the newest review, applies valid notes, runs project checks, and records the result of each note.

Install it with the [Skills CLI](https://github.com/vercel-labs/skills), then ask your agent:

```sh
npx skills add cjvnjde/local-code-review --skill apply-lcr
```

```text
Apply the newest lcr review.
```

Or use `/apply-lcr` when your agent supports skill commands. After the agent updates each note's `Status:` line, the next `lcr` run shows whether the note was applied, answered, skipped, or needs input.

Reviews remain ordinary Markdown files. You can use them without the skill and with any coding agent.

## Develop

Development requires [Bun](https://bun.sh/) and Git.

Run from source:

```sh
bun ./src/index.ts --no-open
```

Run checks:

```sh
bun test ./src
bun build ./src/index.ts --target=bun --outdir /tmp/lcr-check
```

Build a standalone executable:

```sh
bun build ./src/index.ts --compile --minify --outfile lcr
```

The compiled executable contains the browser UI and needs only Git at runtime.
