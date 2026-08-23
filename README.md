# Local Code Review

Small standalone web UI for reviewing local Git changes and writing feedback for coding agents.

![Local Code Review showing a Git diff with line notes](docs/local-code-review.png)

## Optional agent skill

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

## Install

Download the package for your system from the [latest release](https://github.com/cjvnjde/local-code-review/releases/latest), extract it, and put `lcr` (`lcr.exe` on Windows) somewhere on your `PATH`.

`lcr` only needs Git.

macOS builds are unsigned, so a downloaded binary may need quarantine removed
after you verify its release checksum:

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
lcr HEAD~3                    # Changes since three commits ago
lcr origin/main               # Branch work plus local and untracked changes
lcr main...HEAD               # Compare committed branch work with main
lcr --port 8080               # Start from another port
lcr --out .feedback           # Store reviews elsewhere
lcr --context 8               # Show more surrounding lines
lcr --id auth-rework          # Name this review, and come back to it by that name
lcr --version                 # Print which build this is
```

Arguments not recognized by `lcr` are passed to `git diff`.

Working-tree comparisons such as `lcr origin/main` include untracked files, including files created
after `lcr` starts. Commit-to-commit ranges such as `lcr main...HEAD` remain revision-only.

## How it works

1. Open `lcr` in a repository with changes.
2. Click a diff line, drag across lines, or select part of one line to add a note. A selected line narrows to
   part of itself as soon as you select inside it, selecting again re-picks that part, and clicking the line goes
   back to the whole line — a note you are still writing follows those re-picks and keeps what you typed. Hold
   alt (option) while dragging to select the code as plain text to copy, without opening a note. File-level notes
   and bookmarks are also available.
3. Paste a screenshot straight into any note or reply, drop an image file on it, or pick one with **image**. It is
   kept next to the review file and written into the note as ordinary Markdown, so the agent reading the review opens
   the same picture you attached — the fastest way to say *this* is wrong is usually to show it.
4. Use **Overall note** for anything about the review as a whole rather than about one place in it; add as many as you need. Then select **Save review**.
5. `lcr` writes `.review/review-<timestamp>.md`. The default `.review/` directory is ignored by Git.
6. Give that Markdown review to your coding agent.

**Open** beside **Hide** in each file header hands that working-tree file to the configured editor.
Set its executable name or absolute path under **Settings → Code editor** — for example `code`,
`cursor`, or `zed` — or leave it blank to use the operating system default. `lcr` passes the file as
one argument and does not interpret editor arguments or shell commands.


When a change rewrites more than it keeps, **removed** in the page header folds every run of deleted lines into one line you can click open again, so the diff reads as the file the change leaves behind. A run a note is attached to stays open, and jumping to a note or bookmark inside a fold opens it. It sits in the header because it is answered while reading rather than while configuring, and it is only the default: **removed** in a file's own header folds or opens that one file, so you can read a single heavy rewrite as what it leaves behind and keep the rest of the diff as it was.

Pictures work in both directions. A screenshot in a note is kept in `.review/images/` and pointed at from the note as `![screenshot](images/<name>.png)` — a plain relative Markdown link, so it renders in any Markdown viewer and the agent can read the file straight off disk. The same picture pasted into several notes is stored once, and an image your agent leaves in that directory and links the same way is drawn on the page too.

Images under review are shown rather than reported. A changed picture is drawn as two panes — what was there on the left, what replaces it on the right — and one that was only added or only deleted is drawn as the single side it has, with each pane naming the size it turned out to be. An SVG gets the picture as well as its source, so a shape change is visible before you read the path data. Everything is read straight out of the repository the run is in; the page never fetches anything from the network.

A simple agent prompt is enough:

```text
Address the newest lcr review in .review/.
```

The review contains file paths, line anchors, captured code, and note text, so the agent can still find the intended code after line numbers move.

### Then keep talking

The page stays on the diff after you save, and follows the agent while it works.

- The agent answers each note in the review file as it finishes it, and its reply appears under that note on the page. So does the diff it just changed.
- **Reply** under any note to answer back. Your message goes straight into the same file, where the agent picks it up.
- Your own replies stay yours: **Edit** on one rewords it where it stands, **Delete** takes it back out of the file. The agent's messages are read-only — they are its account of what it did.
- **image** in a note or a reply attaches a picture, and so does pasting or dropping one straight onto the box. It is kept beside the review file and linked from your text, so the agent sees exactly what you saw — a broken layout, a console, a design to match — instead of your description of it.
- **reference** in a note or a reply points at another note of this review: pick it from the list and the note carries a chip that goes there. The link travels in the review file too, so the agent reading it follows the same reference you do.
- Notes stay attached as the code moves. When the change a note asked for removes the code it pointed at, the note is shown at the closest line left, or — when the file drops out of the diff entirely — at the end of the page, marked as unattached and still carrying the diff it was written against. You can keep replying to it either way.
- One file holds the whole conversation, and each conversation knows its diff: the file records the range, the branch, and the base commit it was opened against. Restarting `lcr` on the same diff picks that conversation back up; a different range, branch, or base starts a fresh one, and the earlier files stay on disk as history. **Settings → New review** starts fresh by hand.
- `lcr --id <name>` names the review instead, and the name is then what identifies it. Starting with the same name again continues that review however the diff has moved on — commit, rebase, or switch from `main...HEAD` to the working tree, and its notes and threads are still there. A name you have not used before starts an altogether new review, and a run with no `--id` leaves named reviews alone. The name shows in the header and beside the review in **Settings → Review file**.
- **Settings → Review file** lists every saved review — when it was opened, its branch and range, and how many notes are still open. **Open** reopens one as the live conversation, with its notes shown against the current diff.
- Notes from the branch's *other* reviews appear as dim markers on the lines they still match, so a remark made reviewing `main..HEAD` is not lost when you switch to reviewing the working tree. Hover the marker to read the note and its thread; **Continue in this review** carries it, history and all, into the review you are writing now.

The page refreshes the diff whenever nothing is being typed. With a note editor open it waits, and shows a `diff changed` pill in the header until you are done.

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

## License

MIT
