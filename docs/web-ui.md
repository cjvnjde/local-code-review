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
Hiding or switching away from a half-written comment asks before discarding it; saved notes are never removed.

- **Element** (default): click the exact HTML element under the pointer. Start dragging instead and
  that gesture automatically selects an **Area**. Alt + wheel selects a parent.
- **Block**: click a containing block, flex/grid container, table, or list item rather than the exact
  element. For example, Element selects an inline button while Block selects its enclosing section.
  If the element is already a layout block, these may select the same thing. Dragging also selects an area.
- **Area**: explicitly drag a rectangle, including over a canvas or embedded frame.
- **Point**: click to capture a 96 × 96 CSS-pixel neighborhood, clipped to the viewport.
- **Browse**: interact with the app normally while keeping the toolbar and saved pins available.

Selection finishes on release: a click with up to 6 CSS pixels of movement remains an element/block
selection; a larger drag becomes an area. Clicking in selection mode annotates instead of activating
application controls. An element partly outside the viewport captures only its visible portion.
Escape cancels the shared editor's draft or edit as in the main review. From the surrounding page,
Escape closes the note panel, then returns to browsing. Switching away from a half-written comment
asks before discarding it.

The on-page panel embeds the main app's actual editor and note components, not a reduced copy:
the configured Enter/Shift+Enter behavior, Markdown, image paste/drop/picker, image previews,
references, editing, deleting, replies, and live agent answers work the same way in both places.
Saving a visual comment persists it immediately and closes the panel, leaving the page ready for
another selection. Saved visual comments appear under **Overall** above the unchanged Git diff.

Numbered pins reopen notes on the current URL. Element pins follow a unique selector with matching
element metadata; region pins use document coordinates and require the original viewport size.
Missing elements do not silently move to another similar element. **Notes** and **Review** focus the
existing full review tab. **Full conversation** and note references follow ordinary `#note=<ref>`
links there, preserving its current state rather than opening another tab. Code and visual comments
can reference each other with the same short `#ref` tokens and shared picker; previews include their
captured code or page evidence. The main review keeps its normal file tree, diff, settings and controls;
its header's **Open page** control opens or focuses the application.

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

**Capture after** records another observation without changing the original. For an element it
finds the target again and scrolls it into view; for a region it uses the original viewport and
document coordinates. Restore the original route, dialog/menu state, relevant data, and viewport
before comparing. Automatic replay of interactions and pixel-difference scoring are not included.
The complete review shows the crops side by side, with expandable page screenshots and metadata.

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
