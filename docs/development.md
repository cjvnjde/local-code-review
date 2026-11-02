# Development

Development requires [Bun](https://bun.sh/) and Git. Runtime code has no third-party dependencies; no package install is needed.

## Run from source

```sh
bun ./src/index.ts --no-open
```

Run inside a repository with changes. Omit `--no-open` to launch the review page automatically. Source runs accept the same options as the [standalone executable](../README.md).

### Review the web-annotation tools themselves

```sh
bun run demo:web
```

This source-only playground opens a dedicated Chrome/Chromium/Edge window with
the real annotation tools, a second independent reviewer, and a populated
**git review** tab for the diff UI. No install or additional package is needed.
The launcher, fixtures, and sample page are not included in the standalone
executable, and no review starts an agent.

1. In **Example**, select a sample card to take a real screenshot and open the
   floating note popup. Click the captured screenshot to open its drawing editor,
   or hold the example's lower-left **lcr** circle to open its targeting menu.
2. Click **Review** in the bottom switch. The example stays visible, including its
   open menu, popup, drawing and draft, but only the second reviewer receives input.
   Its **lcr** circle starts at the lower right.
3. Hover the example's circle, menu controls or floating note card to see the
   selection outline, then click to comment. Drag an area when you want a narrower
   crop. The reviewer's screenshot includes the example interface, not its own
   controls. Its **Freeze** tool also works for area/point feedback on a still image.
4. Switch back to **Example** to continue using its tools. Switching modes does
   not discard either side's draft or reload its editor.
5. Open the **git review** tab to inspect the real diff UI against deterministic
   modified, added, deleted, renamed, image, audio, and unsupported-binary files.
   The fixtures include hidden context and folded removals so their controls can
   be expanded in place. Notes saved there use a separate development review.

The popup's embedded editor and drawing canvas are selected as one floating card.
To review an individual control inside that iframe, drag a rectangle around it.
The example's shadow-root buttons are selected individually, and their captures
keep selectors that can find those controls again after they move. The mode
switch belongs to the playground and is not an annotation target.

Real feedback is saved under `.review/playground/feedback/`; disposable example
notes are separate under `.review/playground/example/`; diff-showcase notes go
under `.review/playground/diff/`. All use ordinary timestamped Markdown reviews
and keep their pictures. The terminal prints the playground and review URLs with
their automatically assigned ports.

**Ctrl+C** stops all review servers and the dedicated browser without deleting
notes or pictures. After source changes, stop and rerun the command; this
playground does not hot-reload the injected tools.

## Check and build

```sh
bun run check
bun build ./src/index.ts --compile --minify --outfile /tmp/lcr
```

`bun run check` is the shared contributor and release-CI entry point: it runs `bun test ./src`, then
bundles `src/index.ts` into `/tmp/lcr-check`. Bun transpiles TypeScript; this is not semantic type
checking. Compilation above additionally checks the standalone packaging path.

The compiled executable embeds the browser UI and needs only Git for diff reviews. Live web annotation additionally requires an installed Chrome, Chromium, or Edge.

With Chrome installed, run the opt-in real-browser workflow:

```sh
LCR_TEST_BROWSER=1 bun test src/web-review/browser.test.ts
LCR_TEST_BROWSER=1 bun test src/web/client/web-review/annotation-editor.browser.test.ts
```

It uses a temporary Git repository, local application, and isolated browser profile. See [web annotation](web-ui.md) for browser lifecycle and limits.

After changing the distributable skill, verify the project-local copy matches:

```sh
cmp -s skills/apply-lcr/SKILL.md .agents/skills/apply-lcr/SKILL.md
```

Do not commit generated executables or review files.

## Test coverage and mutation testing

```sh
bun test ./src
bun run test:coverage
LCR_TEST_BROWSER=1 bun test ./src/web-review/browser.test.ts
```

Tests live beside their owners. Filesystem, Git, HTTP, WebSocket, ACP subprocess, and browser-lifecycle
cases use isolated temporary resources and close them after each scenario. The opt-in Chrome workflow
also exercises screenshot annotations, editor preservation, stale updates, browser restart,
cross-origin isolation, and history Back/Forward navigation over an unsaved editor. It is skipped by the
ordinary suite so contributors still need only Bun and Git.
The focused drawing workflow exercises pre-save resizing, new shapes, endpoint and curve edits,
point insertion/deletion, path closure, cancel/undo/redo, reopening vectors, and PNG guide exclusion.
Its browser uses an isolated profile and a local screenshot/upload fixture; pure geometry and
metadata boundary/roundtrip tests run in the ordinary suite.

Bun's coverage report describes modules loaded into the test process, not every source file or code
executed in a browser or child process. Use it to find gaps, not as proof of whole-project coverage.
Prefer tests of boundaries, state transitions, round trips, ownership, and failure recovery over
assertions about implementation details or incidental wording.

Run [StrykerJS](https://stryker-mutator.io/docs/stryker-js/) without installing project dependencies:

```sh
bun run test:mutation
```

The script resolves `@stryker-mutator/core@10.1.1` through `bunx`. `stryker.config.json` selects production
TypeScript, excludes tests and subprocess fixtures, and runs Bun through Stryker's
[command runner](https://stryker-mutator.io/docs/stryker-js/configuration/#commandrunner-object).
Source mutations happen in disposable sandboxes, never in the working tree. Reports stay locally
ignored under `.mutation/`: open `mutation.html` or inspect `mutation.json`.

For a focused iteration, select both the source and its relevant consumer tests:

```sh
bun run test:mutation --mutate src/web/client/components/path.ts \
  --commandRunner.command 'bun test ./src/web/client/components/path.test.ts ./src/web/client/components/path-layout.test.ts --bail'
```

The default scans all production TypeScript; a focused score describes only the selected files.
The command runner does not support Stryker's per-test coverage analysis, so coverage analysis is
off and every selected test runs for each mutant. Unexecuted mutations therefore appear as survivors,
not as a separate no-coverage category. Review survivors for missing behavioral assertions; equivalent
mutations and changes to incidental text are not reasons to pin implementation details in tests.

## Formatting

Use Prettier's default style, run on demand without adding a project dependency:

```sh
bunx prettier --write --no-config --no-editorconfig <files>
bunx prettier --check --no-config --no-editorconfig <files>
```

Pass the source, documentation, or configuration files being changed. No Prettier configuration or
style overrides are needed. The first run may download the formatter. Do not format generated review
files, and keep the two distributable skill copies byte-identical.

## Source layout

Keep `src/index.ts` as the executable composition root and `src/version.ts` as the build stamp.
Tests live beside the modules they exercise.

| Directory         | Owner                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| `src/cli/`        | Argument parsing, user-owned startup settings, startup checks and editor launch       |
| `src/git/`        | Git commands, diff parsing/context and blob reads                                     |
| `src/review/`     | Markdown rendering/parsing, sessions, statuses, output, attachments and saved reviews |
| `src/agent/`      | ACP transport and profiles, persistent work queue and managed turns                   |
| `src/server/`     | HTTP routes, event delivery and filesystem watchers                                   |
| `src/browser/`    | Browser launch and Chrome DevTools transport                                          |
| `src/web-review/` | Server-side live-page review controller and browser integration workflow              |
| `src/shared/`     | Browser-safe review types, UI preference schema, capture and annotation models        |
| `src/web/`        | HTML shell, feature-organized client and styles                                       |

`src/cli/config.ts` reads the user settings once at startup. `src/shared/settings.ts`
owns the page-preference defaults and partial-config validation for both runtimes.
The server's settings relay is run-local: configured keys reapply on each new run,
while page changes remain in browser storage. Keep configuration reads out of
help/version and never add a web-UI writer for the user's settings file.

### Browser features

Keep plain TypeScript and light-DOM components. The UI relies on selective repaints, ancestor selectors,
and preserving an open editor across live updates; folders express ownership without introducing a new
component lifecycle.

| Under `src/web/client/` | Owner                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `app/`                  | Browser entry point, shared state, persistence, loading, live synchronization and settings        |
| `components/`           | Reused composer, conversation body, Markdown/highlighting, attachments, paths, icons and tooltips |
| `diff/`                 | Diff rendering, anchors, selection, context expansion, folds, images and audio                    |
| `notes/`                | Note and reply lifecycle, references, note lists, reader, suggestions and submission controls     |
| `history/`              | Snapshot model, journal storage, navigation and history UI                                        |
| `search/`               | Search model and search UI                                                                        |
| `navigation/`           | File tree, bookmarks, sidebar and reading position                                                |
| `web-review/`           | Visual evidence, embedded note UI, screenshot annotation and injected page overlay                |

Use direct imports to the owning module; do not add barrel exports, forwarding files or a miscellaneous
`utils/` directory. Pure contracts shared by server and browser belong in `src/shared/`, never a
server-only feature. The injected `web-review/page-overlay.ts` function must remain self-contained:
the server serializes it into the reviewed page rather than loading the ordinary application bundle.

### Conversation components

- `src/review/session.ts` owns review-file mutations; `src/review/thread.ts` owns the Markdown format.
  Saving an editable note replaces its reviewer-owned snapshot, including cleared optional capture
  fields, while preserving the agent-owned thread and verdict through `applyComment`.
- Browser `notes/notes.ts` owns note placement and editing; `notes/thread.ts` owns reply lifecycle
  and server reconciliation. Keep commit guards, deletion, cancellation, in-flight state and
  single-editor ownership in those controllers.
- `components/composer.ts` shares attachment/reference controls, shortcut hints, textarea growth
  and save/cancel key handling. Insert the textarea and set its value before `wireComposer`; pass
  the existing attachment drop host, not a new wrapper.
- `components/body.ts` renders Markdown and captured-code suggestion diffs. Read-only consumers
  import it directly rather than the reply controller. Reference previews receive the renderer as
  a callback so nested references never recursively embed conversations.
- `components/actions.ts` and `components/tooltip.ts` provide icon decoration, accessible names and
  tooltips for both initial controls and repaints.

### Styles and assets

`src/web/shell.html` imports `client/app/index.ts` and `styles/index.css`. Keep every browser asset
reachable from this shell so source runs and the standalone executable use the same bundle.

The stylesheet entry imports token, base and named feature files in cascade order. These are ordered
imports, not CSS layers: later overrides and cross-feature responsive rules intentionally keep their
positions. Reuse the sizing and color tokens in `styles/tokens.css`; its `--row` stays synchronized
with `ROW_H` in `client/diff/diff-view.ts`. Shared composer and suggestion styles live in
`styles/conversation.css`; `--composer-min` and `--composer-focus` preserve reply variants.

For composer changes, exercise note creation/reopening, reply send/reword/cancel, keyboard shortcuts,
attachments in a nested reply and a repeatedly edited note, reference insertion, and suggestion
rendering. Check that live updates preserve a dirty editor and that the compiled executable serves
the same UI and assets. Model tests alone do not exercise these DOM and packaging contracts.
