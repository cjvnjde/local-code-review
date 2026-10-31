# Reviewing a live UI

Start your development server, then run lcr inside the project's Git repository:

```sh
lcr --web http://localhost:3000 --id checkout-ui
```

`--web` adds visual annotation to an ordinary Git review. It accepts HTTP(S) URLs on `localhost`,
`127.0.0.1`, or `[::1]`. Working-tree, staged, and untracked changes remain visible by default;
explicit Git diff arguments work as usual, for example `lcr --web http://localhost:3000 main...HEAD`.
Code comments and visual comments share one session, Markdown conversation, note lists, references,
and history. Visual comments are overall notes with captured page evidence, not a separate review type.
`--id`, `--out`, `--port`, `--no-open`, and existing agent connections keep their usual meanings.
The diff range (or `--id` when supplied), not the page URL, identifies the conversation, so the same
review continues when restarted with or without `--web`.

## Select and comment

The dedicated browser opens the actual application URL and the full lcr review in two tabs of the
same window, preserving the app's routing, cookies, APIs, and development-server hot reload.
The annotation tools and pins live in a shadow root; no application code is rewritten, proxied,
or installed into the project.

The app starts in **Element** mode even with the **lcr** tools hidden: click an element or drag an area
immediately. **Click the circle** to toggle selection off for normal page use, then click again to
restore your last selection mode. The circle is purple with an **ON** badge while selection is active,
and dark with an **OFF** badge while browsing. Hold **Alt** to use the app normally for one gesture.
**Hold the circle for 450 ms** to open the optional targeting tools without changing selection mode.
Dragging more than 6 CSS pixels before the hold completes moves the circle instead, without toggling
selection or opening the menu; its position survives reloads in the same tab. Keyboard users can
toggle with Enter/Space and open the tools with Arrow Down while the circle is focused.
The tools are a one-use menu: choosing an action, clicking elsewhere, leaving the menu with keyboard
focus, switching windows, or pressing Escape hides it without changing the chosen targeting mode.
Changing targeting mode or minimizing a note leaves its draft intact. Opening a different saved note
asks before discarding half-written text; saved conversations are never removed by closing a window.

- **Element** (default): click the exact HTML element under the pointer. Start dragging instead and
  that gesture automatically selects an **Area**. Alt + wheel selects a parent.
- **Block**: click a containing block, flex/grid container, table, or list item rather than the exact
  element. For example, Element selects an inline button while Block selects its enclosing section.
  If the element is already a layout block, these may select the same thing. Dragging also selects an area.
- **Multiple**: collect several elements for one note, then choose **Write note**. In Element or
  Block mode, **Shift-click** also adds or removes a target without opening the editor. Outside
  Multiple mode, an ordinary click adds the final target and opens the editor; Enter opens it with the current selection.
  **Clear** or Escape cancels the collection. Keep all targets at least partly visible when capturing;
  a note can include up to 100 targets, each with its own metadata, and one crop covering them together.
- **Area**: explicitly drag a rectangle, including over a canvas or embedded frame. The capture also
  records up to 100 visible intersecting DOM elements with selectors, element bounds, and available
  React/Vue component hints. Hidden and occluded elements are skipped on a best-effort basis.
- **Point**: click to capture a 96 × 96 CSS-pixel neighborhood, clipped to the viewport.
- **Browse**: interact with the app normally. Saved note circles stay hidden while selection is
  **OFF** and return immediately when it is turned **ON**; the notes themselves are unchanged.

Selection finishes on release: a click with up to 6 CSS pixels of movement remains an element/block
selection; a larger drag becomes an area. Clicking in selection mode annotates instead of activating
application controls. An element partly outside the viewport captures only its visible portion.
Escape inside the shared editor cancels its draft or edit as in the main review. From the surrounding
page, Escape closes the note panel, asking before discarding half-written text, then returns to browsing.

The on-page panel embeds the main app's actual editor and note components, not a reduced copy:
the configured Enter/Shift+Enter behavior, Markdown, image paste/drop/picker, image previews,
references, editing, deleting, replies, and live agent answers work the same way in both places.
Changes made in the full review's settings reach both already-open and future page editors, including
the Enter save behavior. They do not replace a draft or move its caret. The review server relays these
preferences because an embedded editor can have a separate browser-storage partition.

The note is a floating window: drag its title bar to move it, or focus the title and use the arrow keys
(Shift moves farther). Drag the bottom-right grip to resize its width and height, or focus the grip
and use the arrow keys (Shift resizes farther). Resizing keeps the editor, text and caret intact.
The window stays within the viewport, with a minimum usable size unless the viewport is smaller.
**−** minimizes it to its title bar; the same control restores it at the chosen size. Minimizing
keeps the editor, draft, selection, and iframe viewport intact. The size carries to other notes until
the page reloads. **×** intentionally discards a new unsaved draft, so that editor has no second Cancel
button. Closing a saved note keeps its conversation; unsubmitted wording changes are discarded.

While a note window is open, selecting more of the page adds captures to **that same note**, including
while it is minimized. Move the window aside to reach the area underneath. New captures keep separate
screenshots and metadata rather than replacing the first selection; the text box and caret stay put.
They remain draft-only for a new note until Save. Additions to an already-saved note are persisted
immediately and survive a stale editor save. A note supports up to 100 additional captures. Saving is
disabled during a capture, and selection is disabled while a save is being sent.

Each captured selection has a trash-button **Remove** action in its caption, both in a draft and in
the main review or a saved note's page window. It removes that capture, not the note's wording or
conversation. Removing the first capture promotes the next selection and drops comparisons tied to
the removed capture. Removing the last leaves an ordinary overall note; a new draft can still be
saved without captures or receive another selection. A multi-element crop or an area's automatically
collected DOM metadata belongs to one capture, so removing it removes that whole selection.
Saved-note removal is persisted immediately. Image files and the read-only history are never deleted.
Reference previews and history show evidence without destructive controls. A stale removal from
another tab is rejected rather than deleting a different selection.

Familiar actions use icons instead of redundant labels: trash for remove/delete, pencil for edit,
an arrow for reply, a clock for history, and a picture for attaching an image. Hover or focus one to
read its immediate tooltip; every icon also has a descriptive accessible name. Compound commands
such as **Save & ask AI** retain text, as do content-bearing labels such as note references.

Saving a visual comment persists it immediately and closes the panel, leaving the page ready for
another selection. Saved visual comments appear under **Overall** above the unchanged Git diff.

Numbered pins reopen notes on their exact captured URL, including its query and fragment. Each selected
element gets a pin bearing the same note number; additional captures share that number too.
Element pins follow a unique selector with matching element metadata. Area pins follow up to three
captured DOM anchors whose selectors, text, and available component names still match and agree on
where the area moved. Missing, duplicate, hidden, or conflicting anchors hide the circle rather than
reuse its old coordinates. Older area captures without usable anchors remain readable in the review
but have no on-page circle. This is DOM matching, not pixel comparison; canvas and iframe contents are
not inspected. Point pins retain document coordinates and require the original viewport size.
Pins scroll offscreen with their targets instead of sticking to the viewport edge. **Notes** and **Review** focus the
existing full review tab. **Full conversation** and note references follow ordinary `#note=<ref>`
links there, preserving its current state rather than opening another tab. Code and visual comments
can reference each other with the same short `#ref` tokens and shared picker; previews include their
captured code or page evidence. The main review keeps its normal file tree, diff, settings and controls;
its header's **Open page** control opens or focuses the application.

## Draw on a capture

Click a capture's selected-area image, annotated proposal, or pencil to open the drawing editor
without opening another tab. It works for the first selection, additional selections, and comparison
captures, from either the live page or the full review. The editor uses the full viewport with one
compact icon toolbar, no title header or footer, and floating zoom controls. On the live page the
note window expands edge to edge, then returns to its chosen size and position. Text and caret stay put.

The editor adds white, drawable padding around the screenshot: 64 CSS pixels per side at the
capture's image scale. This is blank space for arrows and labels, not extra page context. The
original screenshot stays unpadded and unchanged. A dashed outline identifies its bounds only in
the editor; it is not exported.

- **Pen** draws freehand strokes, including into the padding. Its smoothing slider runs from 0%
  (raw pointer input, the default) to 100% (stronger stabilization). The level is saved in browser
  storage and affects new strokes only; it does not reshape existing drawings. Smoothing reduces
  hand jitter at the cost of a little cursor lag while drawing, then preserves the release endpoint.
  Filtered points are saved with the drawing, so reopening and PNG export retain the same result.
- **Arrow** draws from the press to the release.
- **Rectangle** draws a border with an adjustable corner radius.
- **Text** places a label where clicked; type before placing it, or click first and then type.
- The color swatch opens one popover containing saved colors and a custom picker. Custom choices
  are saved in browser storage for later use; Escape closes the color popover before the editor.
- Properties appear only for the active tool or selected drawing: stroke width for strokes, corner
  radius for rectangles, text size and a floating text box for text. Values use screenshot image
  pixels, not CSS viewport coordinates.
- **Select / move** picks an existing drawing to move, recolor, reword, resize its stroke/text, or
  delete. Its drawing selector also lists the marks. Clear-all removes marks, not the screenshot.
- Undo/redo work across new changes and reopened drawings. Familiar actions are icons with
  accessible names and immediate hover/focus tooltips.
- Floating −/+ controls zoom out/in; the percentage resets to 100%, and the Fit icon fits the canvas.
  The wheel and trackpad pinch zoom around the pointer. `+`/`−` zoom, `0` fits, and `1` restores 100%.
  Choose the **Hand** icon and drag to move around a zoomed image. Space-drag and middle-button
  drag remain shortcuts. Navigation never changes the PNG.

The checkmark, **Apply drawing**, uploads a separate PNG containing the original pixels, padding, and marks.
It also keeps the editable marks, so reopening never requires drawing over a flattened proposal.
An applied drawing on a draft stays with that draft until the note is saved; on a saved note it is
persisted immediately, without changing the wording, agent thread, or verdict. Applying with no
marks removes that capture's annotation. Existing image assets are never deleted.

The close icon and Escape discard unapplied changes after confirmation when needed.
Image or save failures leave the editor available for correction or retry. A stale edit from
another tab is rejected rather than overwriting a newer proposal or attaching it to another capture.

The page shows the annotated proposal with the original crop expandable below it. The Markdown
links the untouched original and the annotated PNG separately and labels the proposal as requested
changes rather than observed UI. Both are ordinary relative image links usable by image-capable
agents; no SVG support is required. Full editable vectors live in the sealed metadata, while the
readable metadata summarizes tools and text instead of repeating every pen point. Reference
previews and history show the same evidence without annotation controls.

## Evidence and comparison

Each note records:

- The local URL, page title, capture timestamp, viewport size, device pixel ratio, and scroll offset.
- A selection rectangle in **CSS viewport pixels**, its mode, and a unique selector when available.
- The selected tag, text, a bounded set of identifying attributes, and relevant computed styles.
- Best-effort React/Vue component ancestors, with source files or lines when exposed by the runtime.
- A clean screenshot of the **visible page viewport**, and a separate crop of the selection.

The toolbar, panel, and pins are hidden during screenshots. Image pixel dimensions depend on the
browser's display scale; selection coordinates remain CSS pixels. Ordinary relative image links
resolve beside the review Markdown. Content-addressed attachments are immutable and remain usable
after the page, source, or review changes.

**Capture after** records another observation of the **first selection** without changing the original.
For elements it finds every target of that selection again and brings the group into view; for an
area it requires matching DOM anchors and uses the region they identify. A point capture requires the
original viewport and document position. Restore the original route, dialog/menu state, relevant data,
and viewport before comparing. Additional selections remain separate evidence, not comparisons.
Automatic replay of interactions and pixel-difference scoring are not included. The complete review
shows before/after crops together, with expandable page screenshots and metadata.

A screenshot can contain anything visible on the page. Element metadata excludes form values,
component props, component state, and browser cookies. Component discovery does not need framework
extensions: it reads runtime handles already attached to DOM elements. These are private framework
interfaces and may be absent or change; minified production components may have little useful
metadata. Names and source paths are hints for finding implementation, not verified source anchors.
Closed shadow roots and iframe internals are not inspected; an area selection can still capture
their appearance. Annotation is installed only on the initial page's origin, across its routes and
full reloads. It is not installed in new tabs or external login pages; return to the original
reviewed tab after an external flow.

## Browser lifecycle

lcr discovers an installed Chrome, Chromium, or Edge and connects directly through the Chrome
DevTools Protocol. No browser automation package, extension, or browser download is shipped.
`LCR_BROWSER_PATH` can specify the executable explicitly.

The profile lives at `<output-directory>/.browser/`, separately from your everyday browser profile.
Its cookies and logins persist across restarts, but your normal browser's extensions and sessions
are not inherited. One run should own this profile at a time; concurrent UI reviews in the same
repository can use separate output directories. The default `.review/` directory remains ignored,
and custom relative output directories remain locally excluded.

`--no-open` starts only the review server without opening either tab. Open its printed URL manually
and use **Open page** to launch the app and review together later. Closing the reviewed tab
or browser leaves lcr running; the same button opens it again. Reopening the app in the same browser
keeps the existing review tab rather than opening another. Stopping lcr closes the browser it launched.
The debugging endpoint listens only on loopback. A missing browser or failed launch leaves the review
server available with an error and a retry action.

## Development verification

The ordinary suite runs without a browser. With Chrome installed, exercise the real selection,
screenshot, framework-hint, conversation, comparison, reload, and shared-review workflow with:

```sh
LCR_TEST_BROWSER=1 bun test src/web-review-browser.test.ts
```

The test uses a temporary local application and its own temporary browser profile.
