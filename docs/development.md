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
`bunfig.toml` enables the React Compiler and Tailwind plugins for source runs.

`scripts/react-compiler.ts` runs the stable React Compiler on browser TypeScript
and JSX before Bun transforms them. The release build uses the same plugin;
Babel and the compiler are development dependencies only. Compiler diagnostics
are checked against the workspace, file tree, and reference provider in
`src/server/react-compiler.test.ts`, so installing the plugin without actually
optimizing these components fails validation. The production bundle test also
checks for emitted memoization. The mutable TanStack virtualizer explicitly opts
out of automatic memoization so scroll ranges and measurements stay current.

Keep navigation callbacks independent of draft text. Reading a draft inside a
callback passed to the file tree can invalidate thousands of rows on each key.
Code search documents are built only when searching and cached separately from
the conversation documents.

## Stack

| Concern                                    | Implementation                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| UI and editor state                        | React 19 components and hooks                                               |
| Server state, mutations, refetches         | TanStack Query                                                              |
| Large code files                           | TanStack Virtual                                                            |
| Accessible controls, drawing shell, search | [Base UI](https://base-ui.com/react/overview/quick-start)                   |
| Local UI components                        | shadcn-style Tailwind components, CVA, clsx, tailwind-merge                 |
| Pane sizing                                | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) |
| Icons                                      | Lucide React                                                                |
| Image drawing, selection and PNG rendering | [Konva](https://konvajs.org/) with react-konva                              |
| Optional pressure/tapered strokes          | perfect-freehand, pinned to 1.2.3 with versioned metadata                   |
| Original screenshot differences            | pixelmatch, lazy browser-side comparisons                                   |
| Modern CSS color parsing                   | Culori's selective `culori/fn` imports                                      |
| Explicit accessibility scans               | Bundled axe-core, top-level document and open shadow roots                  |
| Pre-save screenshot masking                | Pure-JavaScript pngjs; no native addon                                      |
| ACP framing and stable-v1 dispatch         | Official `@agentclientprotocol/sdk`                                         |
| Typed CDP commands and events              | Generated `devtools-protocol` types, erased from runtime                    |
| JSON and persisted-setting boundaries      | Zod plus streamed byte limits before parsing                                |
| Markdown and GFM                           | react-markdown and remark-gfm                                               |
| Cross-process review writes                | proper-lockfile plus atomic Markdown replacement                            |
| Syntax coloring                            | highlight.js                                                                |
| Suggested replacement diffs                | jsdiff (`diff`)                                                             |
| Local serving and executable packaging     | Bun                                                                         |

The small UI components are owned here rather than pulled from a hosted registry
at runtime. There is no frontend server or CDN in the distributed application.

Review-round snapshots and their independent verification records live beside the
review output, not in agent task state. Snapshot limits and incomplete evidence are
visible to the reviewer; an incomplete comparison cannot be verified.

Every JSON mutation declares its byte cap. Settings/themes use 32 KiB; controls
64 KiB; replies 4 MiB; annotations 16 MiB; notes/imports 32 MiB; submission batches
64 MiB. Actual streamed bytes are counted even with a misleading Content-Length.
Raw attachment/context uploads retain their existing 12 MiB limits. Zod does not
coerce inputs, and domain, origin, token, and path checks remain separate.

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
  defines Tailwind, semantic color tokens, and Markdown/syntax styling.
- `src/shared/themes.ts` defines the editable color catalog and built-in palettes.
  Browser theme application/editor live in `src/web/client/app/themes.tsx` and
  `theme-editor.tsx`; `src/cli/themes.ts` owns validated user-theme files.

Server events invalidate queries instead of mutating DOM or copying server state
into a second global store. An editor owns a snapshot of its subject and text.
Live refetches do not replace that snapshot. One draft is persisted per repository
and read; a successful save clears it. The server remains responsible for merging
reviewer changes with current agent messages and verdicts.
Review mutations carry the URI-encoded originating `review.file` in the
`X-Lcr-Review` header (empty before the first save). Stale destinations return 409;
clients retain their draft and offer to reopen its original review. Independent
lcr sessions share `.review/.lcr.lock`; `.lcr-<UUID>.tmp` files stage atomic writes.
These internal paths are excluded before review-event debouncing. External editors
that do not participate in the lock protocol must not write concurrently with lcr.

The diff viewer is one continuous scroll pane, virtualized across every file,
code row, and inline conversation. File headers use native CSS sticky positioning
inside file-height tracks, so pinning and next-file push-off do not wait for scroll
handlers or React renders. Only each header is measured, not its track. The sidebar
follows the current file and its links scroll within the same pane.
Viewed files collapse and navigation reopens them without erasing their marks.
Stable item keys and captured row anchors preserve the reading position through
context expansion, note updates, and diff refreshes. Diff refreshes wait while an
editor is open. The sidebar and note list share a directory-first order. Captured
code is retained in Markdown; missing or ambiguous anchors stay with their file.

## Agent skills and design ownership

Repository guidance routes agents to two project-local skills:

- [quiet-workspace-design](../.agents/skills/quiet-workspace-design/SKILL.md) owns
  the reusable visual language, action placement, note/editor consistency, concise
  product copy, and reading/editing behavior. Update it when a shared design
  decision changes. Icon buttons are preferred for familiar utilities; named
  actions such as **Save note** remain useful where they communicate intent.
- [react-typescript-workspaces](../.agents/skills/react-typescript-workspaces/SKILL.md)
  covers component reuse, state ownership, effects, typed boundaries, and rendering
  performance. This guide owns the lcr-specific architecture and commands.

Each skill is a standalone `SKILL.md`: copy its folder into another project's
`.agents/skills/` and reference it from that project's agent instructions if
needed. Neither requires lcr paths or imports. The design skill includes a starter
palette, while the destination project's actual theme tokens remain authoritative.
These are development skills; the separately distributed `apply-lcr` skill is for
consuming review feedback. Keep the new guidance in one place rather than adding
another mirrored copy under `skills/`.

Use this map to apply the portable rules here:

| Concern                                                | Existing implementation                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Color, type, Markdown, and diff styles                 | `src/web/styles/index.css`; editable palettes in `src/shared/themes.ts`       |
| Buttons, menus, dialogs, tooltips, and pane primitives | `src/web/client/components/ui/`                                               |
| Shared note identity, conversation, and editor         | `src/web/client/notes/{note-header,note-card,composer}.tsx`                   |
| Workspace toolbar and responsive panes                 | `src/web/client/app/app.tsx`, `src/web/client/navigation/review-layout.tsx`   |
| Continuous reading and protected editor placement      | `src/web/client/diff/diff-view.tsx` and the neighboring reading/anchor models |
| Remote state and draft persistence                     | `src/web/client/app/api.ts`, `src/web/client/app/preferences.ts`              |
| Floating web editor                                    | `src/web/client/web-review/embedded.tsx`, sharing `Composer`                  |

The [Dark](local-code-review.png), [Light](review-light.png), and
[web annotation](web-annotation.png) screenshots provide visual examples, not an
exhaustive specification of current behavior. Inspect current components when
changing interactions. The storefront behind the floating web editor is a capture
fixture, not lcr's visual style.

### External guidance considered

The local React/TypeScript skill links primary React, TypeScript, and TanStack
documentation at the relevant decisions. Its rules are adapted to this project's
client-rendered Bun application and existing React Compiler integration.

Two optional upstream skills are useful references from
[Vercel's official collection](https://github.com/vercel-labs/agent-skills):

| Skill                   | Useful here                                                                    | Scope to keep in mind                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-best-practices`  | Investigating request waterfalls, large imports, and avoidable rendering work. | Also covers Next.js and server rendering. Apply only relevant rules; don't introduce those architectures or blanket manual memoization here. |
| `web-design-guidelines` | A focused accessibility, keyboard/focus, and interaction audit.                | Complements the local visual language; it does not define this product's palette or layout.                                                  |

These external packs are recommendations, not installed dependencies. The two
small local skills are the default guidance. Consider upstream material for a
specific audit or demonstrated gap instead of loading overlapping rule sets for
every edit. Reassess the upstream content before adopting it.

## Validation and packaging

```sh
bun run check
bun run build -- --outfile /tmp/lcr
/tmp/lcr --version
/tmp/lcr --help
bun run test:browser
```

`check` type-checks the React application, CLI, backend, and shared imports, runs
Bun tests, and bundles the whole application. The build script uses the same React Compiler and Tailwind plugins
and compiles both the server and HTML assets into one executable. Use this script
instead of calling `bun build` directly, which does not register these build plugins.

For a custom executable name, use `bun run build -- --outfile lcr2`. The script
already enables minification and compilation. Direct `bun build` leaves Tailwind
directives such as `@theme` and `@apply` unprocessed; these warnings indicate
missing styles, not harmless build noise.

The two `::highlight` rules live in an inline stylesheet in `src/web/shell.html`:
Bun currently warns about these valid selectors in bundled CSS, while inline rules
pass through unchanged to the browser. Build diagnostics are always printed,
including warnings on successful builds.

Cross-compile through the same script:

```sh
bun run build -- --target bun-linux-x64 --outfile /tmp/lcr-linux
```

The release workflow installs dependencies with the lockfile before checking and
building each platform. Only the executable goes into release archives. Users of
the binary need Git, with no Bun, Node.js, package install, or adjacent assets.
Optional ACP adapters and web capture keep their own requirements.
License text for the integrated libraries is embedded at build time; `lcr licenses`
includes the complete axe-core MPL-2.0 license, its third-party notices, and the
matching unmodified source URL. No notice files need to accompany the executable.

Playwright tests require installed Google Chrome by default. They build the
executable, run it in an isolated Git repository without `node_modules`, exercise
notes and live agent replies, recover a draft, test a large diff and narrow layout,
and restart the executable to verify Markdown adoption. Traces are kept on failure.
The source-level CDP lifecycle and page-overlay tests remain available with
`LCR_TEST_BROWSER=1 bun test ./src`.

`bun run test:browser tests/browser/performance.spec.ts` exercises 1,982 files,
26,838 additions, and 58,880 deletions under 4× CPU throttling. It measures
input-to-paint inside the page, checks a bounded virtual window, and reloads to
verify synchronous draft persistence. Set `LCR_TEST_BINARY` to compare an existing
standalone executable without rebuilding it.

Format changed files on demand:

```sh
bunx prettier --write --no-config --no-editorconfig <files>
```

Do not format generated review files. The optional skill copies must stay identical:

```sh
cmp skills/apply-lcr/SKILL.md .agents/skills/apply-lcr/SKILL.md
```

## Documentation screenshots

README and guide images are real captures of the current UI, using a disposable
example checkout rather than personal code or agent conversations:

- `docs/local-code-review.png`: Dark theme and the main review layout.
- `docs/review-light.png`, `docs/catppuccin-latte.png`, and
  `docs/catppuccin-mocha.png`: the same review and scroll position in each palette.
- `docs/theme-editor.png`: **Settings → Appearance → Create theme**, with its live preview.
- `docs/web-annotation.png`: the live-page capture overlay and embedded note editor.

To refresh them, compile the standalone executable as above, run it in an isolated
example Git repository with `--no-agent`, and use a temporary `XDG_CONFIG_HOME`
so theme changes do not overwrite your preferences. Keep the review viewport at
1600 × 1000 CSS pixels and capture the actual page, not a reconstructed UI.
Use a local example app for `--web` captures; inspect images for private content
before replacing the assets. Do not commit the temporary repository, browser
profile, generated reviews, or executable. Embed images with relative paths and
descriptive alt text so the README and guides work offline as well as on GitHub.

## UX preservation

The React implementation keeps the original review interactions. See the
[feature audit](ux-parity.md) for the capability inventory and verification scope.
Run both the source suite (with `LCR_TEST_BROWSER=1` for the drawing/page-overlay
checks) and `bun run test:browser` when changing interactions. A production compile
must still work outside this checkout with no runtime install or adjacent assets.

React, TanStack Query/Virtual, Base UI, Tailwind, react-markdown/remark-gfm,
highlight.js, diff and Konva own their respective UI, data and rendering concerns.
`annotation-scene.tsx` uses Konva nodes for every drawing tool, hit testing and PNG
export. Numbered callouts combine an arrow, badge, number and optional label into
one editable mark; no second drawing engine is involved. The editor retains its
tool controls, undo/redo, path editing, zoom/pan and draft recovery. Portable,
validated marks remain embedded in immutable PNG attachments, so existing saved
drawings reopen against their original image. Pure geometry handles coordinate
constraints and point editing; it no longer paints or performs shape hit testing.
