# Development

Development requires [Bun](https://bun.sh/) and Git. Runtime code has no third-party dependencies; no package install is needed.

## Run from source

```sh
bun ./src/index.ts --no-open
```

Run inside a repository with changes. Omit `--no-open` to launch the review page automatically. Source runs accept the same options as the [standalone executable](../README.md).

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
```

It uses a temporary Git repository, local application, and isolated browser profile. See [web annotation](web-ui.md) for browser lifecycle and limits.

After changing the distributable skill, verify the project-local copy matches:

```sh
cmp -s skills/apply-lcr/SKILL.md .agents/skills/apply-lcr/SKILL.md
```

Do not commit generated executables or review files.

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
| `src/cli/`        | Argument parsing, startup checks and opening files in an editor                       |
| `src/git/`        | Git commands, diff parsing/context and blob reads                                     |
| `src/review/`     | Markdown rendering/parsing, sessions, statuses, output, attachments and saved reviews |
| `src/agent/`      | ACP transport, configuration, persistent work queue and managed turns                 |
| `src/server/`     | HTTP routes, event delivery and filesystem watchers                                   |
| `src/browser/`    | Browser launch and Chrome DevTools transport                                          |
| `src/web-review/` | Server-side live-page review controller and browser integration workflow              |
| `src/shared/`     | Browser-safe review types and capture, region and annotation models                   |
| `src/web/`        | HTML shell, feature-organized client and styles                                       |

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
