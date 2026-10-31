# Reviewing a live UI

Start your development server, then run lcr inside the project's Git repository:

```sh
lcr --web http://localhost:3000 --id checkout-ui
```

`--web` selects a UI review instead of a Git diff. It accepts HTTP(S) URLs on `localhost`,
`127.0.0.1`, or `[::1]`, and cannot be combined with Git diff arguments. `--id`, `--out`, `--port`,
`--no-open`, and the existing agent connection options keep their usual meanings. A named review
continues its conversation across restarts. Without a name, the starting URL and branch identify it.
Use a separate name for a UI review and a diff review when you want separate conversations.

## Select and comment

The dedicated browser opens the actual application URL, preserving its routing, cookies, APIs,
and development-server hot reload. The annotation toolbar and pins live in a shadow root; no
application code is rewritten, proxied, or installed into the project.

- **Browse**: interact with the app normally, including forms, menus, and navigation.
- **Element**: hover and click an HTML element. Alt + wheel selects a parent.
- **Block**: select a containing block, flex/grid container, table, or list item.
- **Area**: drag a rectangle, including over a canvas or embedded frame.
- **Point**: click to capture a 96 × 96 CSS-pixel neighborhood, clipped to the viewport.

Clicking in selection mode annotates instead of activating application controls. An element partly
outside the viewport captures only its visible portion. Escape closes the note panel, then returns
to browsing. Switching away from a half-written comment asks before discarding it.

Saving immediately writes a note into the existing Markdown conversation. Numbered pins reopen
notes on the current URL. Element pins follow a unique selector with matching element metadata;
region pins use document coordinates and require the original viewport size. Missing elements do
not silently move to another similar element. The Notes button still lists every saved UI note.

The on-page panel shows compact text conversations, live agent answers, and a reply editor. The
**Review** and **Full conversation** buttons open the complete lcr UI, where Markdown, images,
references, edit/delete actions, resolution, search, and browser history are available. Agent
readiness and delivery use the same adapters as code reviews.

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

`--no-open` starts only the review server. Open its printed URL manually and use **Open review
browser** to launch later. Closing the reviewed tab or browser leaves lcr running; the same button
opens it again. Stopping lcr closes the browser it launched. The debugging endpoint listens only
on loopback. A missing browser or failed launch leaves the review server available with an error
and a retry action.

## Development verification

The ordinary suite runs without a browser. With Chrome installed, exercise the real selection,
screenshot, framework-hint, conversation, comparison, reload, and shared-review workflow with:

```sh
LCR_TEST_BROWSER=1 bun test src/web-review-browser.test.ts
```

The test uses a temporary local application and its own temporary browser profile.
