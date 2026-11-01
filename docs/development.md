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
LCR_TEST_BROWSER=1 bun test src/web-review-browser.test.ts
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

## Browser component boundaries

Keep plain TypeScript and light-DOM components. The UI relies on selective repaints, ancestor selectors,
and preserving an open editor across live updates; a framework migration must account for those
contracts as well as no-install source usage and the standalone executable.

- `src/index.ts` composes Git, session, event, agent and HTTP services. `src/server.ts` adapts HTTP;
  `src/session.ts` owns review-file mutations and `src/thread.ts` owns the Markdown format.
- `src/web/client/notes.ts` owns note placement, editor lifecycle and note saves. Browser
  `thread.ts` owns reply lifecycle and server reconciliation. Neither delegates persistence or
  single-editor ownership to a presentation component.
- `src/web/client/composer.ts` shares attachment/reference controls, shortcut hints, textarea
  growth and save/cancel key handling across note, reply and reply-edit editors. Insert the textarea
  and set its value before `wireComposer`; pass the existing attachment drop host, not a new wrapper.
  Keep commit guards, deletion, cancellation and in-flight state in the caller.
- `src/web/client/body.ts` renders Markdown and captured-code suggestion diffs for notes, replies
  and previews. Read-only consumers import it directly, not the reply controller. Reference previews
  receive the renderer as a callback so nested references never recursively embed conversations.
- `src/web/conversation.css` holds shared composer and suggestion styles, imported by `styles.css`.
  Reuse the existing page tokens; `--composer-min` and `--composer-focus` preserve reply variants
  without duplicating textarea rules. Keep browser assets reachable through `src/web/shell.html`.
- `src/web/client/actions.ts` and `tooltip.ts` already provide icon decoration, accessible names
  and tooltips, including controls created during repaints. Reuse them rather than another button system.

For composer changes, exercise note creation/reopening, reply send/reword/cancel, keyboard shortcuts,
attachments in a nested reply and a repeatedly edited note, reference insertion, and suggestion
rendering. Check that live updates preserve a dirty editor and that the compiled executable serves
the same UI and assets. Model tests alone do not exercise these DOM and packaging contracts.
