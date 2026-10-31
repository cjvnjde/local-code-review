# Local demo projects

From the lcr repository root, with Bun and Git installed:

```sh
bun run demo
```

This creates three independent Git repositories in `examples/repos/`.
The templates and setup script are tracked; generated repositories, their Git
histories, screenshots, and review files are ignored by the parent repository. No dependencies
are installed, no remote is configured, and Git identity, signing, hooks, and global excludes are
configured locally for the demos, without changing your global Git settings.

Re-running setup **never changes an existing destination**, including its notes or unfinished work.
To get a fresh copy, stop its servers and move the corresponding folder outside `examples/repos/`,
then run setup again. A partially created folder after a setup error is also left untouched.
Edit generated repositories for experiments, not `templates/`; template changes affect future copies only.

## Pick a scenario

| Repository | Initial state | What to try |
| --- | --- | --- |
| `working-tree` | `feature/task-summary`; mixed staged and unstaged changes | Line/character notes, suggestions, deleted-line folding, renamed files, untracked files, live diff refresh |
| `branches` | Clean `feature/search`; divergent `main` and `feature/labels` | Two-dot/three-dot comparisons, explicit paths, named conversations across branch changes |
| `web-ui` | `feature/dashboard-polish`; committed heading change and unstaged CSS | Live UI comments, screenshots, dialogs, routes, scrolling, before/after captures |

The commands below run this checkout's source, so a separately installed lcr cannot silently lag
behind it. You can substitute `lcr` for `bun ../../../src/index.ts` if you prefer your installed build.
Every command starts inside the generated project's own Git repository. Stop a review with Ctrl+C
before trying another command in the same terminal.

## Working tree

```sh
cd examples/repos/working-tree
bun src/index.ts
bun ../../../src/index.ts --id demo-working-tree
```

`src/tasks.ts` has both a staged fix to `countOpen` and an unstaged title change. `src/summary.ts`
is staged, `src/legacy.ts` is deleted but unstaged, `src/labels.ts` is untracked, and
`docs/usage.txt` is staged as a rename to `docs/quickstart.txt`. The default review includes them all.
The task count is deliberately wrong in the baseline, and fixed in the staged change.

Review just the index, or one file:

```sh
bun ../../../src/index.ts --staged --id demo-index
bun ../../../src/index.ts --id demo-one-file -- src/tasks.ts
```

Save a note, edit the generated source in another terminal, and watch the diff update. Keep a note
editor open while editing the source to exercise the deferred-refresh prompt. Restart with the
same `--id` to continue the conversation.

## Branch comparisons

```sh
cd examples/repos/branches
git log --all --graph --oneline --decorate
bun ../../../src/index.ts main...HEAD --id demo-search
```

`feature/search` has two commits after the common baseline. `main` has an independent task-title
change; `feature/labels` branches from that newer `main`. The initial checkout is clean.

After stopping the previous review, try:

```sh
# Changes on the search branch since its common ancestor with main:
bun ../../../src/index.ts main...feature/search --id demo-search

# Endpoint comparison: also shows main's title change being reversed:
bun ../../../src/index.ts main..feature/search --id demo-endpoints

# Last search commit only:
bun ../../../src/index.ts HEAD~1 HEAD --id demo-last-commit

# Switch branches and review labels:
git switch feature/labels
bun ../../../src/index.ts main...HEAD --id demo-labels
```

Switch back with `git switch feature/search`. Use distinct names for separate conversations, or
reuse a name deliberately to see its notes survive a changed branch or range.

## Live UI comments

Terminal 1, from the lcr repository root:

```sh
cd examples/repos/web-ui
bun --watch server.ts
```

Terminal 2, also from the lcr repository root:

```sh
cd examples/repos/web-ui
bun ../../../src/index.ts --web http://127.0.0.1:3000 --id demo-dashboard-ui
```

The server binds only to `127.0.0.1`. It needs no install, framework, external fonts, or network
assets. If port 3000 is taken, start it with `PORT=3001 bun --watch server.ts` and pass that same
URL to `--web`. The server reads assets on each request; **reload the page after an HTML/CSS/JS
edit**. Watch mode restarts server code, but does not hot-reload the browser.

lcr opens the app in its dedicated Chrome/Chromium/Edge window with the annotation toolbar.
If you use `--no-open`, open the printed review URL and click **Open review browser**. The app
in an ordinary browser tab does not have the toolbar. See [UI review details](../docs/web-ui.md).

Suggested exercises:

1. **Element**: select **New project**, save a comment about its cramped horizontal padding, and
   reopen it from the numbered pin. Inspect its selector and clean screenshot in **Review**.
2. **Capture after**: edit the generated `public/styles.css`, changing the final
   `#new-project { padding-inline: 10px; }` rule to `padding-inline: 28px`. Reload the app, reopen
   the pin, and capture after. The original screenshot stays unchanged.
3. **Block**: select a project card or summary group. Alt + wheel moves to a parent element.
4. **Area / Point**: scroll to the canvas activity chart and comment on a bar or its spacing.
5. **Browse**: open **New project**, enter a name, and create it; filter projects and mark one
   complete. Open the dialog again and switch to **Element** to annotate its input or action.
6. **Routes**: browse to **Settings**, edit the form, and save. Comment on **Save changes**;
   visit Projects and return to Settings to check route-specific pins and the Notes list.
7. **Responsive layout**: resize the reviewed window and inspect the deliberately truncated long
   project title. Change the final `.project-title` rule to `white-space: normal` and capture
   after. For area/point comparisons, restore the original viewport and scroll position first.

Project creation, completion, and settings are intentionally in-memory and reset on reload or
navigation. There are no accounts or real email delivery. Recreate any dialog/form state before
capturing it again. This plain HTML/JS app exercises DOM metadata, not React/Vue component hints.

UI reviews and code reviews can run separately against this project. To review the committed
heading and unstaged CSS as code instead:

```sh
bun ../../../src/index.ts main --id demo-dashboard-code
```

Notes and attachments live in the generated project's `.review/`. Only saved notes create a
review file. The setup script never seeds fake notes or agent answers.
