# Developing the v2 experiment

This branch replaces the handwritten review UI with a React application. The Git,
Markdown conversation, HTTP, browser capture, and ACP services remain in Bun.

## Setup

Install [Bun](https://bun.com/) and Git, then install the locked dependencies:

```sh
bun install --frozen-lockfile
bun run dev
```

`bun run start -- --no-open` runs once without opening a browser. `bun run dev`
restarts the server when source changes. Bun's HTML bundler handles React and CSS;
`bunfig.toml` enables the Tailwind plugin for source runs.

## Stack

| Concern                                   | Implementation                                              |
| ----------------------------------------- | ----------------------------------------------------------- |
| UI and editor state                       | React 19 components and hooks                               |
| Server state, mutations, refetches        | TanStack Query                                              |
| Large code files                          | TanStack Virtual                                            |
| Accessible dialogs, tooltips, composition | Radix primitives                                            |
| Local UI components                       | shadcn-style Tailwind components, CVA, clsx, tailwind-merge |
| Icons                                     | Lucide React                                                |
| Markdown and GFM                          | react-markdown and remark-gfm                               |
| Syntax coloring                           | highlight.js                                                |
| Suggested replacement diffs               | jsdiff (`diff`)                                             |
| Local serving and executable packaging    | Bun                                                         |

The small UI components are owned here rather than pulled from a hosted registry
at runtime. There is no frontend server or CDN in the distributed application.

## Project layout

- `src/index.ts` composes the terminal application.
- `src/{cli,git,review,agent,server,browser,web-review}/` owns backend behavior.
- `src/shared/` contains browser-safe types and capture models. Review note and
  message types are shared; the Markdown parser stays in `src/review/thread.ts`.
- `src/web/client/app/` owns queries, live events, preferences, and the workspace.
- `src/web/client/components/` contains Markdown, code, and reusable UI primitives.
- `src/web/client/diff/` owns the virtualized file viewer and pure anchor models.
- `src/web/client/notes/` owns the editor and conversation cards.
- `src/web/client/history/` keeps the existing append-only browser journal and its
  React viewer.
- `src/web/client/web-review/` contains capture presentation, the embedded React
  editor, and the self-contained page overlay injected through CDP.
- `src/web/shell.html` imports the complete frontend. `src/web/styles/index.css`
  defines Tailwind, semantic light/dark tokens, and Markdown styling.

Server events invalidate queries instead of mutating DOM or copying server state
into a second global store. An editor owns a snapshot of its subject and text.
Live refetches do not replace that snapshot. One draft is persisted per repository
and read; a successful save clears it. The server remains responsible for merging
reviewer changes with current agent messages and verdicts.

The diff viewer mounts one file at a time and virtualizes its rows. The sidebar
and note list share a directory-first order. Captured code is retained in the
Markdown file; missing or ambiguous anchors are shown as captured evidence.

## Validation and packaging

```sh
bun run check
bun run build -- --outfile /tmp/lcr
/tmp/lcr --version
/tmp/lcr --help
bun run test:browser
```

`check` type-checks the React application and its shared imports, runs Bun tests,
and bundles the whole application. The build script uses the same Tailwind plugin
and compiles both the server and HTML assets into one executable. Use this script
instead of calling `bun build` directly, which does not register the Tailwind
build plugin.

Cross-compile through the same script:

```sh
bun run build -- --target bun-linux-x64 --outfile /tmp/lcr-linux
```

The release workflow installs dependencies with the lockfile before checking and
building each platform. Only the executable goes into release archives. Users of
the binary need Git, with no Bun, Node.js, package install, or adjacent assets.
Optional ACP adapters and web capture keep their own requirements.

Playwright tests require installed Google Chrome by default. They build the
executable, run it in an isolated Git repository without `node_modules`, exercise
notes and live agent replies, recover a draft, test a large diff and narrow layout,
and restart the executable to verify Markdown adoption. Traces are kept on failure.
The source-level CDP lifecycle and page-overlay tests remain available with
`LCR_TEST_BROWSER=1 bun test ./src`.

Format changed files on demand:

```sh
bunx prettier --write --no-config --no-editorconfig <files>
```

Do not format generated review files. The optional skill copies must stay identical:

```sh
cmp skills/apply-lcr/SKILL.md .agents/skills/apply-lcr/SKILL.md
```

## Current experiment scope

The v2 UI supports Git review, line and range notes, file and overall notes,
suggestions, Markdown previews, image attachments, replies and verdicts, review
switching, viewed marks, themes, history export, and ACP queue controls. Live web
capture uses the same React editor inside the reviewed page.

The older UI's character selections, bookmarks, hide-pattern settings, screenshot
drawing editor, capture comparison sliders, and rich reference previews are not
ported. Existing evidence remains readable and the Markdown format is unchanged.
Old browser preferences are left in their original storage keys; v2 uses its own
keys. Saved review files are adopted normally, while unsaved drafts from the old
UI are not migrated.
