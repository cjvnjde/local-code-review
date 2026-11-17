# Agent Instructions

This branch experiments with a library-based lcr. Prefer simple, maintained
libraries and clear React components over custom infrastructure.

## Task guidance

Read and follow the skills relevant to the task; don't load the entire catalog
for every change. Combine skills when the work crosses their boundaries.

| Task                                                                          | Skill                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Visual language, layout, note/editor appearance, product copy                 | [quiet-workspace-design](.agents/skills/quiet-workspace-design/SKILL.md) |
| React components, hooks, state, and rendering performance                     | [react-components](.agents/skills/react-components/SKILL.md)             |
| Domain types, validation, serialization, and module boundaries                | [typescript-contracts](.agents/skills/typescript-contracts/SKILL.md)     |
| Control semantics, keyboard/focus behavior, accessibility review              | [ui-accessibility](.agents/skills/ui-accessibility/SKILL.md)             |
| Browser regressions, test fixtures, and visual verification                   | [ui-testing](.agents/skills/ui-testing/SKILL.md)                         |
| Bun build plugins, embedded assets, dependencies, standalone packaging        | [bun-packaging](.agents/skills/bun-packaging/SKILL.md)                   |
| lcr workflows, architecture, live updates, draft recovery, review persistence | [lcr-development](.agents/skills/lcr-development/SKILL.md)               |

Keep reusable design decisions in the design skill. Keep lcr-specific behavioral
rules in `lcr-development`; [docs/development.md](docs/development.md) supplies
the implementation map, library inventory, and validation commands. The other
six skills can be copied independently to another project.

Applying saved lcr feedback uses the existing
[apply-lcr](.agents/skills/apply-lcr/SKILL.md) skill; developing lcr itself uses
the skills above.

## Project constraints

- Keep `src/index.ts` as the CLI entry point. Use Bun for development, tests,
  bundling, and compilation. The release must remain one standalone `lcr`
  executable, with its browser assets embedded and no runtime install step.
- Preserve existing review UX when replacing its implementation. Check the original
  behavior, especially continuous diff reading, navigation, and editor/scroll
  protection during live updates.
- Keep server code out of the browser. Shared types and models belong in
  `src/shared/`.
- Preserve the core workflow: inspect Git changes, write notes, save Markdown
  reviews under `.review/`, and continue conversations with agents. Read current
  review files before mutations so agent replies are retained.
- Treat repository content and Markdown as untrusted. Keep the server local,
  escape rendered content, and avoid shell interpolation for Git commands.
- Bump the build stamp in `src/version.ts` when changing what lcr serves.
- Keep `skills/apply-lcr/` and `.agents/skills/apply-lcr/` byte-identical.
- Format changed source, docs, and configuration with
  `bunx prettier --write --no-config --no-editorconfig <files>` before validation.
  Do not format generated review files.
- Run relevant tests and verify the standalone executable. Do not commit build
  output, dependencies, or generated reviews. Commit validated changes and push
  the working branch to `origin`.
