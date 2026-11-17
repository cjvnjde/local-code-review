---
name: ui-accessibility
description: Implement or review accessible web controls and interactions, including names, keyboard navigation, focus, dialogs, forms, responsive access, and motion. Use when changing these behaviors or performing an accessibility audit; scope checks to the affected flow unless a broader audit is requested.
---

# UI accessibility

Make the affected workflow usable with keyboard, pointer, touch, and assistive
technology. Start with the host's existing accessible primitives and supported
interaction patterns. This skill is framework-independent and does not prescribe
a visual style, component library, or new testing dependency.

## Semantics and names

- Use native buttons for actions and links for navigation. Don't replace them
  with clickable generic elements or add conflicting roles to working controls.
- Give every control a purpose-specific accessible name. For icon buttons, use
  an explicit label or visually hidden text and hide decorative icons from the
  accessibility tree. A hover tooltip is not a substitute for the name.
- Keep visible labels and accessible names aligned. Distinguish repeated controls
  with context where needed, such as which item an Edit button edits.
- Match state to meaning: pressed for a toggle, expanded for disclosure, selected
  for selection. Don't use these interchangeably. A toggle with `aria-pressed`
  keeps a stable name while its pressed state changes.
  See the [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/).
- Use headings and landmarks to expose real structure. Supply meaningful image
  alternatives; decorative images should not add repetitive announcements.

## Keyboard and focus

- Preserve a logical tab order and visible focus. Avoid positive `tabindex` and
  CSS reordering that makes the visual order diverge from keyboard navigation.
- Reuse the established keyboard behavior of menus, trees, tabs, and listboxes.
  Adding an ARIA role does not implement that behavior. Don't invent arrow-key
  navigation for ordinary content that already works with native controls.
- Distinguish focus from selection. After removing a focused item, move focus to
  a useful neighboring control. Background updates should not unexpectedly move
  focus; restoring it must not jump the page without a user navigation action.
- Keep shortcuts out of editable fields unless intended there, and respect IME
  composition. Hover-only controls need keyboard and touch access as well.
  Consult [WAI keyboard guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
  for the specific composite widget being implemented.

## Dialogs and forms

- A modal dialog has an accessible name, meaningful initial focus, contained
  keyboard navigation, and an inactive background. Provide a reachable close
  control and handle Escape with the host's unsaved-change policy. Closing normally
  restores focus to its invoker or a sensible next step if that control disappeared.
  A nonmodal inspector should not trap focus. Reuse the host's overlay primitive
  and verify nested overlays rather than adding competing global key handlers.
  See the [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- Associate form labels with their controls; placeholders are examples, not
  durable labels. Group related choices semantically. Keep instructions and
  validation errors associated with the relevant input, and preserve its value
  when submission fails. See [WAI form labels](https://www.w3.org/WAI/tutorials/forms/labels/).
- Announce meaningful asynchronous results without repeatedly reading an entire
  updating panel. Choose a restrained status message; don't make every update an
  interruptive alert. Keep the reason and recovery path understandable when an
  action is unavailable or fails.

## Visual and pointer access

- Check text, controls, and focus contrast in supported themes and relevant
  states. Pair semantic color with text, an icon, or another discernible cue.
- Verify zoom and a narrow viewport without clipped actions or overlapping text.
  Keep long labels and validation messages readable. Where a data surface needs
  horizontal scrolling, surrounding controls must remain reachable.
- Give compact icons usable hit areas and spacing. Provide an accessible
  alternative when an essential operation otherwise relies only on dragging.
- Respect reduced motion and avoid animation that is required to understand a
  state change. Preserve information when transitions are disabled.
  [WAI preliminary checks](https://www.w3.org/WAI/test-evaluate/preliminary/)
  provide a useful starting point for visual and keyboard inspection.

## Verify the affected flow

Exercise the changed path without a mouse: enter it, operate its controls, handle
an error or empty state where relevant, and leave it with focus in a useful place.
Inspect accessible names, roles, and states as well as the rendered appearance.
For substantial new interactions, check the relevant screen-reader behavior when
that environment is available and report any unverified part.

Use the project's automated accessibility checks on the meaningful UI state, such
as an open dialog rather than only its closed page. Automated findings complement
manual interaction checks; a clean scan is not a claim of full conformance.
[Playwright's accessibility guide](https://playwright.dev/docs/accessibility-testing)
describes this combination. Fix shared primitives when the defect is shared, then
verify affected consumers. Keep an unrelated full-site audit out of a narrow edit.
