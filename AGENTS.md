# Agent Instructions

This branch experiments with a library-based lcr. Prefer simple, maintained
libraries and clear React components over custom infrastructure.

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
