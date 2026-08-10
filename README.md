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

The review page opens at <http://localhost:7777>. It includes working-tree, staged, and untracked changes against `HEAD`. If that port is taken, `lcr` moves to the next free one (7778, 7779, ...) and prints the address it landed on.

Common commands:

```sh
lcr --no-open                 # Do not open the browser automatically
lcr --staged                  # Staged changes only
lcr HEAD~3                    # Last three commits
lcr main...HEAD               # Compare current branch with main
lcr --port 8080               # Start from another port
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

### Then keep talking

The page stays on the diff after you save, and follows the agent while it works.

- The agent answers each note in the review file as it finishes it, and its reply appears under that note on the page. So does the diff it just changed.
- **Reply** under any note to answer back. Your message goes straight into the same file, where the agent picks it up.
- Notes stay attached as the code moves. When the change a note asked for removes the code it pointed at, the note is shown at the closest line left, or — when the file drops out of the diff entirely — at the end of the page, marked as unattached and still carrying the diff it was written against. You can keep replying to it either way.
- One file holds the whole conversation. Saving again adds to it, and restarting `lcr` picks the newest one back up. **Settings → New review** opens a fresh one.

The page refreshes the diff whenever nothing is being typed. With a note editor open it waits, and shows a `diff changed` pill in the header until you are done.

### Optional agent skill

This repository includes [`apply-lcr`](skills/apply-lcr/SKILL.md), a small skill that finds the newest review, works the notes one at a time, replies to each in the review file as it goes, runs project checks, and picks up any follow-ups you wrote while it worked.

Install it with the [Skills CLI](https://github.com/vercel-labs/skills), then ask your agent:

```sh
npx skills add cjvnjde/local-code-review --skill apply-lcr
```

```text
Apply the newest lcr review.
```

Or use `/apply-lcr` when your agent supports skill commands. Each note's `Status:` line — applied, answered, skipped, or needs input — shows on the note as soon as the agent writes it.

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
