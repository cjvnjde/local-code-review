---
name: react-components
description: Implement or refactor React components, hooks, client state, query integration, and rendering performance. Use when changing React UI behavior or component APIs; adapt to the host's existing libraries and compiler setup without imposing a framework migration.
---

# React components

Inspect the nearest feature, shared UI primitives, package manifest, and compiler
configuration before choosing a pattern. Follow the host's rendering model and
data layer. These rules work with client-rendered or server-rendered applications;
they do not require Next.js, TanStack Query, or a new state library.

## Compose around behavior

- Reuse local buttons, menus, dialogs, tooltips, and form controls. Put shared
  variants and interaction semantics in those primitives rather than patching
  every call site.
- Share a component when the same domain object appears in several places. Use
  children or named slots for optional content, and a small explicit variant when
  the layout really differs. Avoid a component whose unrelated boolean props
  permit combinations the product never supports.
- Keep components close to the feature until a second real use demonstrates a
  shared abstraction. Extract for a coherent responsibility, not a line-count
  target. A wrapper should remove repeated decisions, not merely rename JSX.
- Move pure ordering, filtering, parsing, and calculations out of rendering when
  that makes them independently understandable. Use a hook for shared React
  behavior or lifecycle; ordinary functions do not need hook-shaped wrappers.
- Define component types outside other components so renders do not accidentally
  create a new component identity. Use stable domain keys for collections; changing
  a key should intentionally reset state rather than incidentally refresh data.

## Give each value one owner

| Value                                    | Owner                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Saved remote records and status          | Existing query/cache layer.                                           |
| Open panels, selection, temporary inputs | Closest component that needs to coordinate them.                      |
| Shared view preferences                  | Established preference/context layer when several features need them. |
| Counts, filtered lists, display labels   | Derived from authoritative inputs during rendering.                   |

Keep context values focused on one concern. Don't lift frequently changing input
state into the application shell merely to make it accessible. A consumer should
subscribe to the state it needs, not to every workspace change.

Use effects to synchronize external systems, such as subscriptions, observers,
and browser APIs, with cleanup. Calculate display values during rendering and
handle user-triggered work in event handlers. Don't chain effects to implement a
click, mirror props unnecessarily, or omit dependencies to silence a stale closure.
See React's [effect guidance](https://react.dev/learn/you-might-not-need-an-effect).

For asynchronous work, capture the input needed by that operation and handle
pending, failure, and success explicitly. Cancel obsolete reads or ignore stale
results according to the host's data layer. Keep user-owned form state independent
from background refetches; project rules define persistence and conflict behavior.

## Integrate the existing data layer

- With a query library, include the identity and parameters that determine a
  result in its key. Invalidate relevant queries after a mutation or live event
  instead of maintaining a second writable copy or patching the DOM.
- Distinguish initial loading from background fetching so a refresh does not
  unnecessarily replace an already usable view. Keep error recovery available.
- Preserve rollback and reconciliation when using optimistic updates. Apply an
  optimistic change only when the product can represent and recover from failure.
- Start independent reads together; preserve ordering for dependent operations.
  Don't replace an existing cache with hand-written fetch effects for one view.

For TanStack Query integrations, consult
[query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation).

## Keep rendering responsive

- Check whether React Compiler is enabled. Prefer straightforward React when it
  is; use manual memoization for measured cost or an integration's identity
  requirement. Preserve documented opt-outs for mutable library integrations
  until their behavior is verified. See
  [React Compiler](https://react.dev/learn/react-compiler/introduction).
- Keep frequently changing text out of callbacks passed to large trees unless
  those callbacks actually need it. Avoid rebuilding indexes or traversing a
  whole dataset on each keypress.
- Keep virtualized item keys and measurements stable. Work through the existing
  virtualizer's model instead of adding competing scroll bookkeeping. Mutable
  library handles belong in the integration/ref, not in React state as a snapshot.
- Preserve useful lazy imports and defer optional expensive computation until
  needed. Measure the affected interaction before adding a new cache or layer.
- Use immutable React state updates and don't mutate cached query results during
  rendering. Correctness must not depend on memoization retaining a value forever.

Validate the changed behavior with the host's checks. Use a real browser for
focus, layout measurement, and virtualization changes; inspect all affected hosts
when changing a shared component. Avoid tests that merely reproduce the JSX.
