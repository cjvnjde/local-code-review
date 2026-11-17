---
name: quiet-workspace-design
description: Design or refine compact workspaces, review tools, inspectors, and editors with quiet surfaces, consistent note cards, icon-led controls, and protected reading and editing state. Use for UI layout, styling, or interaction work following this visual language, including new projects that request it.
---

# Quiet workspace design

Build a calm, dense workspace that gives most of the screen to the user's content.
The visual reference is an editor: a slim toolbar, optional navigation on the left,
one dominant reading surface, and contextual notes on the right. Small controls,
fine borders, and a restrained accent establish hierarchy.

This file is self-contained and portable. In another project, map these roles to
its existing components, tokens, and domain. A note can become a comment, task, or
annotation. Keep only the panes and actions that project needs; this style does
not require Git, agents, React, a specific backend, or a particular folder layout.
Existing product requirements and explicit user choices take precedence.

## Visual language

- Use flat neutral surfaces, thin borders, modest rounding, and limited decoration.
  Avoid ornamental gradients, oversized headings, excessive whitespace, and
  nested cards around ordinary content. Reserve shadows for floating surfaces.
- Use a system sans-serif for controls and prose, and monospace for code and
  technical identifiers. Keep body copy comfortably readable, with smaller muted
  metadata. Use medium weight to establish hierarchy before increasing size.
- Start with a 4 px spacing rhythm: 4–8 px within control groups, 8–12 px within
  compact cards, and 12–16 px between groups. Typical desktop controls are 28–36 px
  high with 14–16 px icons; enlarge targets for touch. These are starting points,
  not constraints that override readability, zoom, or the host design system.
- Prefer 1 px borders and roughly 4–8 px corner radii. Use 12–14 px labels and
  approximately 14 px body text with comfortable line height. Don't shrink all
  text just to fit another toolbar action.
- Keep transitions short and quiet, around 150–200 ms when useful. Respect reduced
  motion; direct resizing should follow the pointer immediately. Don't replay
  arrival animations when an existing item scrolls back into view.
- Use one quiet accent for the primary action, focus, and selection. Use green,
  red, and amber for semantic success, removal/error, and attention. Pair color
  with a label, icon, or structural cue.

Use semantic tokens, including their foreground pairs. Reuse the host palette;
for a new project these reference colors reproduce the neutral/purple character:

| Role                    | Light starting point  | Dark starting point   |
| ----------------------- | --------------------- | --------------------- |
| Background / foreground | `#fafafa` / `#18181b` | `#111114` / `#e8e8ed` |
| Card                    | `#ffffff`             | `#18181c`             |
| Floating surface        | `#ffffff`             | `#222228`             |
| Muted surface / text    | `#f0f0f3` / `#60606b` | `#242429` / `#a2a2b0` |
| Hover surface           | `#ededf2`             | `#2a2a32`             |
| Border                  | `#e4e4e7`             | `#2b2b33`             |
| Primary / on-primary    | `#6d5bd0` / `#ffffff` | `#b0a0ff` / `#19142e` |
| Focus ring              | `#9482ef`             | `#b0a0ff`             |

Define semantic success, warning, error, and domain-specific colors alongside
these tokens when needed. Changes and syntax can use separate subdued backgrounds
and stronger foregrounds. Check contrast in context; don't put literal palette
values in individual components. Light and dark modes retain the same hierarchy,
geometry, and interactions. Respect custom palettes.

## Layout and action placement

| Surface                   | Arrangement                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global toolbar            | Identity and navigation at the left, search in the flexible middle, workspace utilities at the right. Keep it one compact band where space allows. |
| Main workspace            | Optional navigation left, flexible content center, optional inspector or notes right. Let users resize or hide supporting panes.                   |
| Section or file header    | Disclosure and title left; counts, state, and local actions right. Sticky headers may preserve context during long reading.                        |
| Notes panel               | View switches and filters above the list. Selection should clearly connect a summary to its full conversation.                                     |
| Note header               | Location/title and identity left; classification, resolution, and overflow actions right. Wrap controls in narrow containers.                      |
| Saved note footer         | Reply at the left; edit at the right. Add secondary actions only when relevant; keep rare actions in overflow.                                     |
| Composer toolbar          | Formatting and attachment controls left; Write/Preview switch right.                                                                               |
| Composer footer           | Contextual additions or status left; Cancel and the primary Save/Reply action right.                                                               |
| Dialog or floating editor | Title left, close and window controls right. Keep its primary action reachable when content scrolls.                                               |

For long documents, use one continuous reading surface. Navigation should move
within it without resetting context. Supporting panes may scroll independently;
avoid adding a tiny scrollbox to every card. On small screens, collapse or overlay
supporting panes, wrap controls, and keep the content and save action reachable.
Preserve drafts and selection across layout changes.

## Buttons and product copy

- Prefer icon buttons for familiar compact actions: close, copy, settings, theme,
  expand/collapse, previous/next, and overflow. Use one consistent outline icon
  family. Give each icon button an accessible name and a short tooltip available
  on hover and focus; a tooltip alone is not an accessible name.
- Use text or icon-plus-text when the action needs its name or looks clearer that
  way: Save note, Reply, Cancel, Resolve, and uncommon operations. Icon-first is a
  preference, not a reason to make actions ambiguous.
- Use ghost buttons for utilities, outline buttons for secondary actions, and a
  filled accent for the main action in the active form. Keep destructive actions
  visually distinct and away from the primary action.
- Keep the interface self-explanatory. Prefer short labels over explanatory
  paragraphs, redundant subtitles, or implementation details. Add brief help only
  for a non-obvious choice, an empty state with a useful next step, or a recovery
  action. Errors should say what failed and what the user can do.
- Preserve keyboard focus indicators, native button semantics, disabled/busy
  states, and toggle state. Controls revealed on hover must also be reachable by
  keyboard and discoverable on touch. Return focus sensibly when overlays close.
  See the [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
  when implementing custom interactions.

## One note and editor family

Use the same note header, typography, border treatment, labels, status cues,
attachments, and action meanings wherever a note appears: inline, in a side panel,
in an expanded conversation, or in a floating editor. Share components or explicit
variants. A compact list may omit the body or actions; it should still look like
the same object. Don't create a separate visual system for each host.

A full conversation has a compact identity row, optional captured context, the
author and readable body, chronological replies, and a restrained action row.
Keep bulky evidence collapsible. Use subtle selection/unread cues without turning
every card into an alert. Keep resolved state distinct from an agent's reply status.

The editor follows the same shell. For a Markdown workflow, use a plain writing
field, compact formatting controls, and a preview rendered with the same styles
as saved content. Formatting applies to the selection and returns focus to the
field. Switching preview preserves text, selection where applicable, and context.
Let the field grow with its content within the available space. Attachments and
captured evidence stay associated with their draft.

Editing behavior is part of the design:

- Opening a draft captures its subject and destination. Background updates must
  not overwrite text, retarget the draft, steal focus, move the caret, or jump the
  reader to another item.
- Preserve a dirty draft through navigation, pane changes, refreshes, and failures
  according to the host's persistence policy. Explicit discard can remove it;
  successful save clears the saved draft. Failed saves keep it available to retry.
- Save visibly commits the edit. Pending operations prevent duplicate submission
  and show a compact busy state. Don't imply that saving also launches an agent
  or another workflow unless that is the named action.
- Preserve the host's shortcuts. For a new multiline editor, Enter inserts a line
  break and Ctrl/Cmd+Enter may submit when valid, outside IME composition. Escape
  should dismiss a transient popup first and must not silently discard dirty text.
- Keep reading anchors stable when content expands or updates. If a live refresh
  cannot preserve the editor and its context, defer the disruptive refresh.

## Check and evolve the design

Before editing, inspect the closest existing surface, shared primitives, and
tokens. After editing, compare the same object in each affected host, check
supported palettes (including light and dark where available), a narrow layout,
keyboard focus, and a populated or long-content state. Exercise draft preservation
when the change touches editing or live updates.
Use real UI evidence when available; don't treat a static screenshot as proof of
interaction behavior.

Update this file when a reusable design decision changes. Keep application file
paths, backend contracts, and feature inventories in that project's documentation
so this style remains usable on its own.
