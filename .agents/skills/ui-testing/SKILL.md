---
name: ui-testing
description: Choose and implement meaningful UI regression tests, browser interaction checks, and visual verification. Use when adding or debugging tests for user-visible behavior, focus, layout, async updates, or rendering performance; adapt to the project's existing test runner and validation commands.
---

# UI testing

Test the behavior that could fail and the result the user relies on. Inspect the
nearest tests, fixtures, runner configuration, and project validation rules first.
Reuse that setup; this skill does not require adopting Playwright or introducing
a new harness. The Playwright examples apply when it is already the browser runner.

## Choose the smallest meaningful level

| Risk                                                            | Useful check                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Ordering, filtering, parsing, or pure state transitions         | Unit test of inputs and observable outputs, including a relevant boundary case.                        |
| Interaction wiring and rendered state                           | Component test when the existing environment faithfully represents the behavior.                       |
| Focus, caret, scrolling, resizing, drag/drop, or virtualization | Real browser interaction; DOM-only tests cannot establish layout behavior.                             |
| Persistence, routing, server/client integration                 | Browser flow with the real affected boundary and isolated data.                                        |
| Clipping, alignment, typography, theme, or responsive layout    | Inspect rendered screenshots; add a visual baseline only where repeated regression checking is useful. |

For a bug, reproduce its trigger and assert the corrected outcome. Keep assertions
independent of helper names, CSS class strings, or incidental component structure.
Small copy/style edits usually need existing checks and visual inspection, not
a new test that merely repeats the implementation. Avoid turning every fix into
a full new end-to-end journey.

## Stable browser interactions

- Locate controls by role and accessible name or field label. Scope repeated
  controls to their dialog, panel, or item. Use a deliberate test ID when no
  meaningful user-facing locator exists; avoid brittle DOM chains or positional
  selectors that silently select the wrong control.
- Prefer normal user actions. Don't bypass an overlay or force a click merely to
  make a failing test pass; first determine why the action is blocked.
- Assert outcomes: saved text, a visible error, retained input, selection, or
  restored focus. A completed click or successful network response alone does
  not establish that the UI reached the intended state.
  See [Playwright best practices](https://playwright.dev/docs/best-practices).

Use retrying browser assertions such as `await expect(locator).toHaveText(...)`
or `toBeFocused()` for eventual UI state. Use bounded polling for a non-DOM outcome
such as a persisted file. Wait for the actual condition, not a fixed delay or
unrelated network-idle signal. Register an event/response wait before triggering
the action when missing that event would race. See [Playwright assertions](https://playwright.dev/docs/test-assertions).

## Isolated and representative fixtures

Use temporary data, profiles, and configuration that cannot overwrite user work.
Reset state between independent tests and release owned servers, files, and browser
contexts even after failures. Keep fixtures small while preserving the trigger:
long content for overflow, enough items for virtualization, or two clients for a
concurrent-update bug. Do not share hidden order dependencies between tests. See
[Playwright fixtures](https://playwright.dev/docs/test-fixtures) for reusable setup
and teardown with test-owned state.

Control external services with fixtures or narrow mocks when their behavior is
outside the test's scope. Keep the application's affected integration real when
that is what the regression concerns. Avoid mocking both sides of a contract and
then claiming the contract works. Stabilize clocks or randomness only where they
affect the result; use the existing fixture lifecycle rather than another test
framework. [Playwright best practices](https://playwright.dev/docs/best-practices)
cover isolation and external dependency handling.

## Visual and interaction evidence

- Render representative content and relevant states, including supported themes
  and narrow layouts when the change affects them. Compare shared components in
  their affected hosts; an empty screen can hide overflow and spacing defects.
- Capture screenshots in a stable browser, viewport, font, and platform setup.
  Inspect failures before replacing baselines. Mask only known nondeterministic
  regions, and keep masks and tolerances from concealing the behavior under test.
  See [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).
- Combine appearance with interaction checks. A screenshot cannot prove keyboard
  access, successful persistence, or preservation of focus during an update.
- For performance work, measure the affected user interaction with a realistic
  fixture. Verify the resulting content as well as responsiveness; a fast empty
  viewport is not a successful virtualization optimization.

## Run and report

Run the focused test first, then the relevant existing checks and any required
project gates. Verify the distributed artifact when the project's packaging rules
require it; a development-server pass covers a different execution path.
Investigate failures using the runner's trace, logs, and screenshots before
raising timeouts or adding retries. Distinguish a missing browser or blocked local
server from an assertion failure.

State what was checked, what passed, and any untested behavior. Keep temporary
captures and generated data out of the repository unless they are intentional
fixtures or reviewed visual baselines. Once the relevant checks pass, rerun or
broaden only for a new change, failure, or unresolved concern.
