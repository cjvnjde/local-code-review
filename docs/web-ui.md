# Reviewing a live UI

Start the local app, then run inside its Git repository:

```sh
lcr --web http://localhost:3000 --id checkout-ui
```

Web capture works alongside the Git diff and uses the same Markdown conversation.
It requires installed Chrome, Chromium, or Edge. Only local HTTP(S) URLs are accepted.

The overlay in the reviewed page lets you select an element or area. Its editor
is the same React note editor as the main review, embedded in a frame from the lcr
server. Write feedback, annotate images or add a suggestion, and save. Captured screenshots
and element metadata remain in the review file, with pictures stored beside it.
The external-link icon in the window header opens the full review.

The note window can be moved, resized from any side or its corner, or minimized.
Capture titles stay on one line with ellipsis; their full titles are available
on hover. Clicking an editable thumbnail opens the drawing editor directly;
read-only images open the viewer. Closing either restores the window and draft.
The bin icon removes a capture. **Capture details** contains nested collapsibles
for metadata, originals, and context, without nested scroll areas. Classification
shares the window title bar with close/minimize; there is no second header or help
icon. **Add capture** sits left of Cancel/Save.
Text, evidence, and previews expand the note naturally. Long notes scroll at the
overlay's page level, not inside the note; creating a note leaves the reviewed
page's scroll position unchanged. Notifications appear at the page corner outside
the floating note window. Reopening a note scrolls to and highlights its captured
block on the page. In the diff, after-capture and page-targeting actions belong to
the agent workflow rather than extra note buttons.

The floating launcher keeps **Browse / Annotate** visible. Browse lets you use
the app normally; Annotate restores targeting. A separate targeting menu selects
an element, containing block, multiple elements, area, or point. Hold Alt to
interact temporarily, or drag the launcher out of the way. Point captures retain
metadata without a screenshot.

**Add capture** temporarily minimizes the note so you can select more evidence.
The editor returns with its text intact after capture; Escape cancels selection
and returns without discarding the draft. Selecting another element directly
while composing still adds it to the same draft. On a saved note, new captures
belong to a reply rather than replacing its original evidence.

Drawing tools share one compact header with undo/redo, original-view, checkmark,
and close icons. **More tools** appears only when there is insufficient width.
Parameters for the active tool or selection stay inline on wide screens and use
**Options** only on narrow screens; the color circle opens the palette, which stays
open while adjusting a custom color. New text labels have transparent backgrounds.
Hold O to compare the original temporarily. Striped margins are drawing space and
are not exported. Zoom controls remain bottom-right.
The checkmark returns an image to the draft, or updates an already-saved drawing;
**Save note** still saves the note. Originals and editable drawing data are retained.

Compatible original screenshots also offer a **Pixel difference** overlay with changed
pixel counts and percentages. URL, viewport, DPR, selection geometry, scroll, and
decoded dimensions must match. Drawn proposals are never evidence for this metric.
Threshold and anti-alias controls are explicit; comparison is lazy and bounded to
2,000,000 pixels and 8,192 pixels per dimension. Browser decoding uses sRGB, with
transparency compared over white. Existing wipe and side-by-side views remain.

## Pre-capture privacy

Use the overlay's privacy controls to mark rectangular regions before capturing or
freezing. Pixels are replaced in memory before either the original screenshot or
its crop is written. Frozen crops retain those masks server-side. This is not an
editable drawing layer and cannot be undone from a saved capture.

Masked captures omit DOM/text/style/diagnostic context, full-page images, title,
and URL path, with explicit omission metadata. Invalid geometry fails closed.
Masks belong to that viewport, not a selector that can safely follow page changes:
choose fresh regions for later captures. Previously saved evidence is unchanged;
adding a mask does not retroactively sanitize it. Review the saved image before
sharing, and avoid capturing sensitive content outside the marked regions.

## Accessibility

**Check page accessibility** runs bundled axe-core only when requested. No CDN,
extension, screenshots, or automatic agent dispatch is involved. The scan excludes
the lcr overlay/editor, does not return raw node HTML, and covers the top-level
document and open shadow roots. Iframes require manual review. Privacy mode also
withholds target selectors and page-derived details.

Violations and incomplete/manual-review findings remain distinct. Select findings
and save them as real review notes with rule, impact, targets, engine, time, and
page provenance. Only selected findings are persisted; saving them again does not
duplicate notes. Automated checks do not establish accessibility conformance.

## Browser profiles

- `--browser-profile shared` (default) uses lcr's dedicated browser profile under
  the user's configuration directory.
- `--browser-profile project` stores a dedicated profile in the review output
  directory.
- `--browser-profile existing` attaches to a matching tab in a running compatible
  browser without reloading it. Enable remote debugging in Chrome and approve its
  connection prompt. Personal browser state is not copied.

For another compatible installation, pass
`--browser-data-dir "/path/to/browser/User Data"`. `--no-open` defers attachment
until **Open page** is chosen in the review.

Stopping lcr removes its overlay. Existing-browser mode leaves the browser and
its tabs running. A tab can belong to one review at a time. A page that blocks the
embedded editor through its content security policy can still be reviewed from
the full lcr page.

## Context

**Settings → Capture context** controls on-demand context bundles, selected HTML,
and full-page screenshots with HTML/CSS/JS sources. These are enabled by default.
**Record recent interaction and failure metadata** is separately opt-in and off by default.
Settings persist in the same user `lcr/config.json` used at startup.

Under **Capture details**, open **Additional context** to see the inventory,
capture time, byte sizes, availability, and partial-capture markers. Text and
images load only when explicitly opened. The selected-area original and any
annotated proposal remain primary evidence; opening the inventory does not load
the full-page image.

Each bundle keeps separate, immutable parts. Its ID plus the unique part name
addresses one piece of evidence; available parts also record their own SHA-256 and
byte size. Reading one part does not read or require any sibling payload:

- **Full-page sources:** capture-time document HTML plus inline and loaded
  stylesheet/script sources, stored as inert text evidence. External resources
  come from the attached browser, not new server-side fetches. Size/deadline limits
  and unavailable resources are reported per part. Point and privacy-region
  captures omit these parts; frozen selections reuse their original snapshot.
- **Layout:** selected targets, up to six ancestors and four nearby siblings per
  target, bounded to 40 nodes. Includes geometry, flex/grid constraints,
  overflow/stacking, selected styles, and explicit semantic labels/states.
  Area selections use a bounded spatial scan, not an exhaustive accessibility tree.
- **CSS rules:** bounded matched rules and inline declarations for up to 12
  captured nodes, including referenced safe numeric/color custom properties
  across those nodes. Stylesheet locations use zero-based browser coordinates.
  Matched rules are not a winning-cascade calculation; unknown query activation
  and missing source locations stay unknown.
- **Environment:** browser, locale, theme hints, media preferences, visual viewport,
  focus/hover identities, and visible dialog/expanded states. An app can expose its
  build explicitly with `<meta name="lcr-build-id" content="your-build-id">`.
  Without that marker, running-app identity is unavailable—not inferred from Git.
- **Repository:** capture-time HEAD and a bounded fingerprint of tracked index and
  regular working-file contents. No source content is saved. Untracked files,
  symlink contents, and submodule contents are excluded; oversized or unreadable
  evidence is marked unavailable. This is checkout identity, not a cleanliness
  test or proof of which application build is running.
- **Interactions and diagnostics:** when opted in, at most 50 events per stream
  from the last minute. Includes browse-mode interactions, Alt-assisted clicks,
  console warning/error occurrence metadata, and HTTP/request failures.
  Disabling recording clears live buffers, not existing saved bundles.

These are historical observations, not a replayable browser session. CSS,
screenshots, and checkout identity are collected in a bounded interval, not one
atomic instant. Frozen selections reuse their original evidence rather than
querying a newer page. Each part reports exclusions, unavailable evidence, or
truncation; missing evidence never proves that something was absent.

Selected HTML excludes form values, editable/hidden content, scripts, and arbitrary
props/state. Full-page HTML/CSS/JS is raw source: it can contain hidden content,
embedded data, credentials, or application secrets. Disable full-page context
when that is inappropriate. Diagnostics omit typed values, console arguments,
exception text, headers, bodies, cookies, and storage. URL credentials, queries,
and fragments are removed from diagnostic/CSS provenance URLs, but paths and
semantic labels may still be sensitive. Screenshots are unredacted unless you
selected privacy regions before capture. Inspect saved evidence before sharing.

### Select only the evidence needed

Managed AI handoffs include a bounded manifest inventory, not the stored payloads.
The optional `apply-lcr` skill can read saved IDs/manifests directly from disk;
neither a live browser nor an lcr installation is required for ordinary file reads.
When lcr is available, offline helpers support focused reads:

```sh
lcr context inspect <id> --review <review.md>
lcr context read <id> --review <review.md> --part selected-html
lcr context read <id> --review <review.md> --part full-page-html
lcr context read <id> --review <review.md> --part full-page
lcr context read <id> --review <review.md> --part layout \
  --selector 'button#checkout' --property gap
lcr context read <id> --review <review.md> --part css-rules --property --space
lcr context read <id> --review <review.md> --part diagnostics \
  --since 2026-11-15T10:00:00Z --until 2026-11-15T10:01:00Z --select /events
```

Use the exact saved selector; it also retains the captured ancestors/siblings
associated with that target. `--select` is a JSON Pointer, not executable code.
Filters apply before pointer selection. `--offset`/`--limit` paginate the resulting
JSON with UTF-8 byte offsets and `nextOffset`, not the original part. Invalid
queries and unsupported evidence shapes fail explicitly; they never fall back to
loading the entire payload. Authenticated HTTP part reads support the same
`selector`, `property`, `since`, `until`, and `select` query parameters.
