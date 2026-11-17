---
name: react-typescript-workspaces
description: Implement or refactor React and TypeScript workspaces with shared components, clear server and draft state ownership, safe live updates, and measured rendering performance. Use for components, hooks, client data flow, typed UI models, or related browser behavior; follow the host project's build and validation rules.
---

# React and TypeScript workspaces

Prefer clear feature components and maintained libraries over custom frameworks.
First inspect the host's package manifest, TypeScript settings, nearby components,
and development instructions. Follow its runtime and rendering model; these rules
do not require a migration, new dependency, Next.js, or a particular state library.

## Components and boundaries

- Reuse local controls, menus, dialogs, tooltips, and editor primitives. Keep
  accessibility and visual variants in those primitives instead of reimplementing
  them at every call site.
- Share an object-level component when the same note, message, or editor appears
  in multiple hosts. Use a small explicit variant or composition for differences;
  avoid duplicated markup and unrelated boolean mode combinations.
- Put pure filtering, ordering, anchor calculations, parsing, and state transitions
  outside rendering when that makes their behavior independently understandable.
  Keep hooks focused on an actual React lifecycle or shared interaction.
- Keep server/filesystem/process modules out of browser imports. Put shared
  browser-safe contracts in the host's shared layer. Type-only imports do not make
  a server module a suitable home for a shared model.
- Let the existing library own its concern: remote queries, virtualization,
  accessible overlays, Markdown rendering, pane sizing, or drawing. Extend its
  integration rather than adding a second competing engine or global store.

## State ownership and live updates

Separate persisted server data, transient view state, and user-owned drafts.

| State                                     | Owner and update rule                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Saved records and remote status           | Existing query/cache layer; mutations and live events refresh the relevant records. |
| Selection, open panels, filters           | Closest useful component or established UI preferences layer.                       |
| Draft text, captured subject, destination | Editor/draft model; refreshed records never silently replace it.                    |
| Derived lists, counts, display labels     | Compute from authoritative inputs; don't synchronize redundant state.               |

Use effects for external synchronization such as subscriptions, observers, and
browser integration, with cleanup. Compute render data during rendering; perform
user-triggered work in event handlers. Don't chain effects to implement a click
or suppress dependencies to hide a stale closure. See React's
[effect guidance](https://react.dev/learn/you-might-not-need-an-effect).

When using TanStack Query, use deliberate query keys and targeted invalidation
for server changes. Avoid copying query results into another writable store or
patching the DOM from a live event. Preserve optimistic-update rollback if that
pattern is already used. See [query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation).

Treat saves and uploads as explicit asynchronous transitions. Preserve edits made
while work is pending, handle failures, and clear only the draft that was actually
saved. Capture the destination so a late response or a review/tab switch cannot
write to the wrong record. Preserve existing synchronous draft persistence where
immediate navigation/reload depends on it; debouncing must not introduce loss.

## TypeScript at the boundaries

- Use existing domain types and infer local values. Give public contracts and
  component props clear types; avoid introducing aliases that add no meaning.
- Represent mutually exclusive states with discriminated unions, especially draft
  kinds, async outcomes, and commands. Narrow before reading variant-specific
  fields; use exhaustive handling where a missed case would cause incorrect
  behavior. See [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).
- Treat external JSON, storage, files, and messages as untrusted input. Parse and
  validate at the boundary with the host's schema library. Runtime validation and
  payload limits are separate from TypeScript assertions.
- Prefer `unknown` plus validation over `any`, non-null assertions, or double
  casts used to silence errors. Keep a necessary assertion small and explain the
  invariant it relies on. Preserve the host's strictness and import conventions.
- Keep mutable library handles in the appropriate adapter/ref; use immutable
  updates for React state. Don't mutate a cached query value during rendering.

## Performance without fragile shortcuts

- Check whether React Compiler is enabled before adding memoization. With the
  compiler, prefer straightforward React; add manual memoization for a measured
  need or an integration's identity requirement. Preserve documented compiler
  opt-outs for mutable libraries until their behavior is verified. See
  [React Compiler](https://react.dev/learn/react-compiler/introduction).
- Keep keystrokes local. A callback passed to a large tree should not depend on
  draft text unless its behavior actually needs that text. Avoid rebuilding
  search indexes or traversing the entire document on each editor change.
- Use stable semantic keys. Preserve the host's virtualized reading model, row
  measurements, and scroll anchors. Don't remount the editor or replace a
  continuous document with separate pages as an incidental optimization.
- Defer optional expensive work until needed and preserve useful lazy imports.
  Parallelize independent reads; keep dependent mutations ordered. Measure the
  interaction that matters before adding caches or abstractions.

## Verification

Use the project's formatter, typecheck, tests, and production build commands.
Check behavior at the level that could fail: pure models with unit tests;
focus, selection, resizing, virtualization, or draft recovery in a real browser.
Prefer a meaningful regression case over assertions that mirror implementation.
Docs-only edits do not need new runtime tests.

For live-editor changes, cover a background update during typing, a failed save,
navigation with a dirty draft, and a successful retry. For shared UI, check each
affected host. For packaging or dependency changes, verify the actual distributed
artifact in its intended runtime, not only a development server.
