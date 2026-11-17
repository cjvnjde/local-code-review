---
name: lcr-development
description: Develop lcr features while preserving its Git review workflow, Markdown conversations, continuous reading, draft recovery, live updates, and local runtime boundaries. Use for lcr product behavior or architecture changes. Reading or applying a user's saved review feedback belongs to apply-lcr.
---

# lcr project development

lcr is a local review workspace: inspect Git changes or capture a running app,
write notes, persist the conversation in Markdown, and continue with an optional
coding agent. Develop this workflow without losing the reader's place or the
reviewer's work. This is project-specific guidance; the other development skills
describe reusable techniques.

Read the relevant sections of [development](../../../docs/development.md) for
architecture, dependencies, and exact commands, and [UX parity](../../../docs/ux-parity.md)
when replacing an interaction. Inspect the current implementation before treating
a screenshot or older description as the complete behavior.

## Follow the existing ownership boundaries

| Work                                     | Start here                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| CLI and Git inputs                       | `src/index.ts`, `src/cli/`, `src/git/`                                       |
| Review identity, mutations, and Markdown | `src/review/session.ts`, `thread.ts`, `render.ts`, `lock.ts`                 |
| Requests, validation, live events        | `src/server/` and `src/web/client/app/api.ts`                                |
| Browser-safe domain models               | `src/shared/`                                                                |
| Workspace state and persistence          | `src/web/client/app/app.tsx`, `preferences.ts`                               |
| Reading and navigation                   | `src/web/client/diff/`, `src/web/client/navigation/`                         |
| Notes and editing across hosts           | `src/web/client/notes/`, especially `NoteHeader`, `NoteCard`, and `Composer` |
| Capture and optional agent connections   | `src/web-review/`, `src/browser/`, `src/agent/`                              |

Use the libraries and shared components already assigned to each concern. Keep
server code and Markdown parsing out of the browser. Code notes and web captures
belong to the same conversation; avoid separate implementations of their common
note/editor shell. Keep manual review usable without an agent connection.

## Protect reading and editing during live changes

- Keep one continuous virtualized diff across files, rows, and inline notes.
  Navigation scrolls within it; viewed-file navigation reopens content without
  clearing its mark. Preserve native sticky headers and captured reading anchors.
- Preserve the active editor and its subject through virtualization, pane hiding,
  resizing, and narrow layouts. Formatting and preview transitions retain the
  selection where applicable and restore focus without scrolling the workspace.
- An open draft owns its text, captured context, and original review destination.
  Incoming query results cannot overwrite or retarget it. Opening another target
  cannot silently replace changed work. Keep synchronous draft persistence at
  the action boundary so immediate reload does not lose the last change.
- Defer replacement of the displayed diff while an editor is open or busy.
  Conversation updates can continue through the existing query invalidation
  path. Do not patch DOM from events or create another copy of server state.
- Saves/uploads expose pending and failure states, preserve retryable drafts,
  and clear only the work successfully saved or explicitly discarded. Preserve
  existing Save/Save only/agent-action semantics and their labels/settings.
- Preserve the configured Enter/Shift+Enter behavior, Ctrl/Cmd+Enter submission
  outside IME composition, and Escape handling that dismisses completions before
  considering the editor. Escape must not silently discard a changed draft.
- Keep navigation callbacks independent of draft text. Retain `DiffView`'s
  `"use no memo"` directive: its TanStack Virtual instance is mutable. Changing
  this requires evidence that scrolling and measurements remain current.

## Preserve the shared Markdown conversation

- Use the session mutation path and its output-directory lock. Reread current
  Markdown inside that lock, merge only the fields owned by the action, and
  publish through atomic replacement. An in-process queue alone cannot coordinate
  independent lcr sessions. Don't overwrite with an earlier UI snapshot.
- Retain note identities, agent replies, statuses, captured code, and evidence
  references across edits and restarts. Keep reviewer resolution distinct from
  agent outcomes. Inspect parser/render round trips when extending stored data.
- Carry the URI-encoded originating `review.file` in `X-Lcr-Review` for review
  mutations, including the empty value before the first save. A stale destination
  returns 409; keep the draft and offer its existing recovery path. Don't retry
  the mutation against whichever review happens to be selected now.
- Preserve the distinction between named review identity and diff context when
  adopting conversations. Queued agent work retains its originating review even
  when the user switches reviews.
- Keep lock and temporary-write artifacts out of watcher events. Atomic writes
  and file replacement must still reach readers. External writers that ignore
  the lock protocol cannot be treated as coordinated transactions.

## Local and untrusted inputs

Preserve loopback serving and existing host, origin, token, path, and domain
checks. Repository paths, Markdown, attachments, captured pages, and agent output
are untrusted. Use argument arrays for Git, the existing safe Markdown renderer,
bounded request parsing, and runtime schemas. Validation does not replace access
checks. Keep captured evidence inert and optional browser/agent execution within
the user's requested workflow.

## Verify the changed workflow

Use the commands in the development guide and the root `AGENTS.md`. For editor or
navigation changes, exercise typing during an incoming update, changed-review
recovery, failed save/retry, and preserved reading position in the affected hosts.
For persistence changes, cover current-file merging, concurrent writers, and
restart adoption. Use existing source and browser suites rather than duplicating
their fixtures. Verify the standalone executable as required by the project.

Update the build stamp when served behavior/assets change; guidance-only edits
do not change it. Keep lcr-specific decisions here and the implementation guide;
keep the portable design and engineering skills free of this repository's paths.
