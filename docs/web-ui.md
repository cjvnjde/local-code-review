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

To comment on a tooltip, hover menu, or another temporary state, reveal it and press **Ctrl+Shift+F**
while the pointer is still over the page. The current viewport freezes as a screenshot and switches
to **Area** selection: drag around what you want to comment on, then write the note as usual.
**Point** selection also works on the frozen view. The screenshot and available DOM hints come
from the freeze, even if the application changes or the hovered content disappears underneath.
The application keeps running behind the snapshot; this does not pause its scripts or requests.

The **Frozen view** banner stays visible until you choose **Resume**, press **Ctrl+Shift+F** again, or
press **Escape** on the surrounding page. Resuming restores your previous selection mode and
keeps any open note draft. Switching to Browse or resizing the viewport also resumes the page.
Element, Block, and Multiple selection are unavailable while frozen. On macOS, use
**Control+Shift+F (⌃⇧F)**, not Option. The shortcut works with a text field or the note editor
focused without inserting text. The same **Freeze** action is available in the targeting tools.

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

While a note window is open, selecting more of the page adds separate screenshots and metadata,
including while minimized. Move the window aside to reach the area underneath; the text and caret stay put.
Captures remain draft-only for a new note until Save. When viewing a saved note, new selections go to the
next reply instead of changing the original capture or wording, including after an agent has answered.
Only explicitly editing an unanswered original adds evidence to that original. A note supports up to
100 additional captures. Saving is disabled during a capture, and selection is disabled while a note
or reply save is being sent.

Each captured selection has a trash-button **Remove** action while it belongs to a new draft, an
explicit unanswered-note edit, or a reply draft. It removes that capture, not the note's wording or
conversation. Removing the first capture promotes the next selection and drops comparisons tied to
the removed capture. Removing the last leaves an ordinary overall note; a new draft can still be
saved without captures or receive another selection. A multi-element crop or an area's automatically
collected DOM metadata belongs to one capture, so removing it removes that whole selection.
Submitted originals have no removal control while being viewed; answered originals cannot be edited.
Image files and the read-only history are never deleted. Reference previews and history show evidence
without destructive controls. A stale removal from another tab is rejected rather than deleting a
different selection.

Familiar actions use icons instead of redundant labels: trash for remove/delete, pencil for edit,
a clock for history, and a picture for attaching an image. Replies have an always-open input. Hover or focus an icon to
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
- **Arrow / Line** draw from the press to the release; each endpoint stays independently editable.
- **Rectangle** draws a border with an adjustable corner radius. Hold Shift for a square.
- **Circle / ellipse** draws an ellipse inside the dragged box. Hold Shift for a circle.
- **Triangle** draws an upright triangle inside the dragged box.
- **Path** connects clicked points. Drag while placing a point to give it smooth Bézier handles.
  Enter or double-click finishes an open path; clicking its first point closes a path with at least
  three points. Apply also finishes an open path. Escape discards an unfinished path, and Undo
  removes its last point. Choose another tool to finish a path with at least two points.
- **Text** places a label where clicked; type before placing it, or click first and then type.
- The color swatch opens one popover containing saved colors and a custom picker. Custom choices
  are saved in browser storage for later use; Escape closes the color popover before the editor.
- Properties appear only for the active tool or selected drawing: stroke width for strokes, corner
  radius for rectangles, text size and a floating text box for text. Values use screenshot image
  pixels, not CSS viewport coordinates.
- **Select / edit** works immediately, before Apply or saving the note. New shapes automatically
  switch to selection. Drag a border to move a drawing, or its corner/edge handles to resize it;
  the opposite handle stays fixed, and dragging past it flips the box. Pen strokes resize with
  their captured points; text handles scale the font. Arrow and line endpoints move independently.
  The drawing selector also reaches overlapping marks. Recolor, reword, change properties, or delete
  the selected drawing. Clear-all removes marks, not the screenshot.
- Selected paths show their anchors and curve handles. Drag an anchor to move it with its controls;
  drag a control to reshape the curve. Select an anchor, then choose **Smooth point** to create aligned
  tangent handles or **Corner point** to remove its controls. Smooth handles retain their tangent axis
  when one moves; corner controls move independently. Double-click a segment to insert an anchor
  without changing the curve. **Delete point** removes the selected anchor, while the drawing's
  delete icon removes the whole path. Closed paths need three points and open paths need two;
  **Close / open path** switches between them.
- Undo/redo work across new changes and reopened drawings. Familiar actions are icons with
  accessible names and immediate hover/focus tooltips.
- Floating −/+ controls zoom out/in; the percentage resets to 100%, and the Fit icon fits the canvas.
  The wheel and trackpad pinch zoom around the pointer. `+`/`−` zoom, `0` fits, and `1` restores 100%.
  Choose the **Hand** icon and drag to move around a zoomed image. Space-drag and middle-button
  drag remain shortcuts. Navigation never changes the PNG.

The checkmark, **Apply drawing**, uploads a separate PNG containing the original pixels, padding, and marks.
Editable draft captures keep their marks, so reopening those drawings does not flatten the proposal.
An applied drawing on a new draft stays with that draft until the note is saved. When viewing a saved
note, applying a drawing adds the original selected-area image and the annotated proposal to the reply
input; it never changes the answered image. Reply-draft captures keep their drawings until the reply
is saved. An explicit edit of an unanswered original persists its drawing in place. Applying with no
marks removes an editable draft's annotation. Existing image assets are never deleted.

Escape cancels a live drag first, or discards an unfinished path. Otherwise, the close icon and Escape
discard unapplied changes after confirmation when needed.
Image or save failures leave the editor available for correction or retry. A stale edit from
another tab is rejected rather than overwriting a newer proposal or attaching it to another capture.

The page shows the annotated proposal with the original crop expandable below it. The Markdown
links the untouched original and the annotated PNG separately and labels the proposal as requested
changes rather than observed UI. Both are ordinary relative image links usable by image-capable
agents; no SVG support is required. Full editable vectors live in the sealed metadata. Proposals
containing the new vector tools also expose exact ordered marks in the readable JSON: shape bounds,
line endpoints, path anchors, absolute Bézier controls, smooth/corner kinds, closure, colors, and
stroke widths. The coordinate guide identifies the padded canvas origin and original-image offset,
so drawing intent is not confused with captured UI. Legacy-tool-only proposals retain their compact
readable summaries. Reference previews and history show the same evidence without annotation controls.

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

By default, the dedicated profile lives at `$XDG_CONFIG_HOME/lcr/browser/` when
`XDG_CONFIG_HOME` is absolute, otherwise `~/.config/lcr/browser/`, beside `config.json`.
Cookies, logins, and browser storage persist across restarts, projects, and worktrees.
Your everyday browser's extensions and sessions are not inherited. Review files and captures
still belong to each project's output directory.

To keep browser state in the current project's output directory instead:

```sh
lcr --web http://localhost:3000 --browser-profile project
```

This uses `<output-directory>/.browser/`, the location used by older lcr builds. Each worktree
and output directory has its own state. Set `"browserProfile": "project"` in your user
`config.json` to make this the default, or use `--browser-profile shared` to override it for
one run. The default `.review/` directory remains ignored, and custom relative output
directories remain locally excluded.

Existing project profiles are left untouched; the shared profile starts fresh. To keep using
your previous logins, choose `project`. To migrate one profile to shared storage, stop lcr and
its browser, then copy that entire `.browser` directory to the shared `browser` location only
if that destination does not already exist. Do not merge profiles or copy a running browser's data.

Only one run can own a dedicated profile at a time. For simultaneous UI reviews, use `project` in separate
worktrees or output directories. A second run reports the conflict without attaching to or closing
the first browser. After an unclean shutdown, a `.lcr-owner.lock` may remain inside the profile;
remove only that lock after verifying that its lcr process and browser have stopped.

### Attach to your existing browser

To use your existing Chrome session, including its logins and current app state:

1. Start Chrome 144 or newer and enable remote debugging at `chrome://inspect/#remote-debugging`.
2. Open the app at the exact URL you will give to `--web` (including its path, query, and fragment).
3. Run `lcr --web http://localhost:3000 --browser-profile existing`.
4. Allow the connection in Chrome's dialog. lcr waits up to one minute for approval.

lcr reuses the one tab matching that URL without reloading it, preserving form values, scroll, and
in-memory app state. If no tab matches, it opens one in that browser. Duplicate matching tabs produce
an error; close duplicates or use a distinct URL. One app tab can belong to one lcr review at a time.
Different app tabs can be reviewed by separate runs, each with its own Chrome connection.

The default discovery location is Chrome stable's user data directory for your OS. For another
installation or a compatible browser, specify the **user data directory**, not its `Default` or
`Profile 1` subdirectory:

```sh
lcr --web http://localhost:3000 --browser-profile existing --browser-data-dir "/path/to/browser/User Data"
```

You can set `"browserProfile": "existing"` and optionally `"browserDataDir": "/path/to/browser/User Data"`
in your user config. Configured paths resolve beside `config.json`; CLI paths resolve from the
repository root. Both support `~/`. The directory override applies only to `existing` mode.
Use `--browser-profile shared` or `project` to launch a dedicated browser again.

Attachment only reads the browser's `DevToolsActivePort` discovery file and connects on loopback;
it never copies, changes permissions on, or locks the personal profile. Chrome owns the consent
decision. A denied, revoked, missing, or unreadable connection leaves lcr's server available to retry.
On macOS, you may need to allow your terminal access to Chrome under **Privacy & Security → Files & Folders**.

Stopping lcr removes its overlay, event handlers, binding, and reload script, then disconnects.
It leaves Chrome and all tabs open, including any app or review tabs it created. After a crash or
revoked connection, an idle overlay removes itself when its connection requests time out; an
unfinished editor stays visible and switches to browse mode. Reopen the page from the same lcr run
to reconnect, or reload the tab after preserving any unsaved work.

This is a direct Chrome DevTools Protocol connection; no AI, extension, MCP server, or automation
package is required. See Chrome's [existing-session connection flow](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session).
Chrome 136+ [restricts launch flags against the default data directory](https://developer.chrome.com/blog/remote-debugging-port);
use the consent toggle above for an everyday browser session.

### Profile safety

The dedicated profile directory is restricted to its owner on POSIX systems (`0700`; the owner lock is
`0600`); Windows uses the containing directory's account permissions. Moving it outside a checkout
also keeps browser credentials out of repository files. This is ordinary sensitive browser data,
not an encrypted lcr vault: programs running as your user can access it, and the local debugging
connection can control the browser. Use a dedicated development account for logins.
With `existing`, approving Chrome's connection grants debugging access to your personal browser;
lcr uses it for the selected app tab and its review tab. Choose a dedicated profile when that
broader browser access is undesirable.

A shared profile shares site state across all projects. In particular, cookies are not isolated by
port: apps on different localhost ports may receive the same cookies. Local storage and IndexedDB
are scoped by origin, including port. Choose `project` for separate accounts or untrusted projects.
The location alone does not provide isolation from other programs running as your user.

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
LCR_TEST_BROWSER=1 bun test src/web-review/browser.test.ts src/web-review/existing-browser.test.ts src/browser/profile.test.ts
```

The tests use temporary profiles and a temporary local application, including a login cookie
that must persist across worktrees in shared mode and remain isolated in project mode.
