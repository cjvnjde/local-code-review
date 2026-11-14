# UX preservation in the React branch

The baseline for this audit is the UI immediately before `5c61ad4`. Changing the
framework does not authorize removing review capabilities. The visual layout can
change; reading, commenting, evidence, and saved conversations must keep working.

| Original capability          | React implementation                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continuous diff reading      | One virtualized surface, compact sticky headers, wrapped lines or file-local horizontal scrolling, sidebar following and jumps                            |
| Pane sizing                  | Drag/keyboard resizing, double-click reset, persisted sidebar and conversation widths, draft/scroll retention and mobile drawer                           |
| Progress and file controls   | Viewed marks, automatic reading tracking, backtracking, folding, folder controls, hover/focus visibility controls and glob filters                        |
| Hidden code                  | Up/down/all context expansion, configurable batch size, expandable deleted runs with note protection                                                      |
| Comment gestures             | Whole-line clicks, Shift extension, forward/reverse drag ranges, character selections across syntax tokens, Alt-drag copying, edge auto-scroll            |
| Editing without losing place | Compact inline editors, retained toggleable overall-note popup, protected drafts/carets, deferred diff refreshes and reload recovery                      |
| Markdown authoring           | GFM, syntax highlighting, suggestions, formatting shortcuts and toolbar, preview, safe local images                                                       |
| Images in notes/replies      | Paste/drop/pick, thumbnails, zoom/fit/actual-size viewer, editable drawings stored with immutable PNG attachments                                         |
| Drawing tools                | Pen, highlighter, arrows, shapes, paths and points, text, callouts, magnifier, selection/resize, styling, undo/redo, draft recovery                       |
| Diff media                   | Before/after images, pixel-region captures and comment markers, before/after audio players                                                                |
| Navigation                   | Session bookmarks, previous/next stepping, persistent reading resume, keyboard shortcuts, narrow-screen navigation                                        |
| Review search                | Centered global fuzzy search across files, both code sides, notes, captured code, metadata, statuses and replies, including hidden/unmounted content      |
| Note references              | Stable tokens, `#` suggestions, inline previews including replies, navigation and unavailable/ambiguous handling                                          |
| Conversation state           | Live replies/statuses, inline reply edits, unread markers, local resolve/reopen invalidated by later conversation changes                                 |
| Earlier conversations        | Saved-review switching and continuing demonstrably anchored notes from other reviews with their threads retained                                          |
| File attachments and context | Arbitrary-file paste/drop/pick, portable local download links, saved context cards, manifest inspection and chunked text reads                            |
| Color literals               | Safe hex/RGB/HSL inspection, alpha, saved palette, copy and source-preserving edits                                                                       |
| History                      | Append-only snapshots, search, removed conversations, captured evidence, copy changes/snapshots and JSON export                                           |
| Web review                   | Existing page selection/freeze modes, embedded inline editor, multiple selections/removal, drawing proposals, capture-after and original-only comparisons |
| ACP and persistence          | Existing queue/permissions, fresh-file mutation semantics, Markdown contracts and embedded standalone executable                                          |

`tests/browser/review.spec.ts` exercises these workflows against a compiled binary
running in a temporary repository without dependencies or adjacent browser assets.
It includes actual mouse gestures, image metadata round trips, context reads,
resolution invalidation, live capture comparisons and live-update scroll retention.
The Konva drawing workspace keeps its editing and geometry tests, with browser
checks for native hit testing, numbered callout identity and endpoint editing,
HiDPI exports, original-only magnifiers and editable attachment round trips.
Pure search, reference, bookmark, filter, word-diff and color models retain their
original regression coverage.

Comment editors and context/color/reference tools stay inline. Explicit image
preview/drawing actions use a large image workspace. Destructive actions use
inline confirmation controls. Resolution is a browser acknowledgement, independent
of an agent's saved verdict; later replies make the note visible again.

The browser storage namespace remains `lcr:v2:*`; old unsaved editor drafts and
appearance preferences are not migrated automatically. Existing saved Markdown,
attachments, context bundles and drawing metadata keep their established formats.
