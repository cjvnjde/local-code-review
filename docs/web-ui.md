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
**Full review** in the window header returns to the complete conversation.

The note window starts compact and can be moved, resized, or minimized. Captures
use named, aspect-ratio-aware thumbnails; clicking one opens a viewport-wide
viewer. Closing it restores the window and draft. **Remove capture** is beside
each editable capture. **Capture details** holds timestamps, element metadata,
original screenshots, and additional context. The input and save controls stay
visible while evidence scrolls above them.

The floating launcher keeps **Browse / Annotate** visible. Browse lets you use
the app normally; Annotate restores targeting. A separate targeting menu selects
an element, containing block, multiple elements, area, or point, with short hints
for each choice. Hold Alt to interact temporarily, or drag the launcher out of
the way. Point captures retain metadata without a screenshot.

**Add capture** temporarily minimizes the note so you can select more evidence.
The editor returns with its text intact after capture; Escape cancels selection
and returns without discarding the draft. Selecting another element directly
while composing still adds it to the same draft. On a saved note, new captures
belong to a reply rather than replacing its original evidence.

Choose **Annotate** or **Edit drawing** beside a capture. Common tools stay visible;
**More tools** holds additional shapes, paths, and magnification. **Show original**
is directly accessible; hold O for temporary comparison. **Options** controls the
active tool or selection. The header distinguishes the active tool from the
selected drawing, with contextual gesture hints. Striped, labelled margins are
annotation space, not captured page context; these guides are not exported.
Preview and drawing share bottom-right zoom controls. Undo/redo and completion
remain accessible in narrow windows. **Use drawing** returns an image to the draft;
**Save note** still saves the note. **Save drawing** updates an already-saved note.
Originals and editable drawing data are retained.

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
and full-page screenshots. These are enabled by default. **Record recent
interaction and failure metadata** is separately opt-in and off by default.
Settings persist in the same user `lcr/config.json` used at startup.

Under **Capture details**, open **Additional context** to see the inventory,
capture time, byte sizes, availability, and partial-capture markers. Text and
images load only when explicitly opened. The selected-area original and any
annotated proposal remain primary evidence; opening the inventory does not load
the full-page image.

Each bundle keeps separate, immutable parts:

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

HTML excludes form values, editable/hidden content, scripts, and arbitrary
props/state. Diagnostics omit typed values, console arguments, exception text,
headers, bodies, cookies, and storage. URL credentials, queries, and fragments are
removed from diagnostic/CSS source URLs, but paths and semantic labels may still
be sensitive. **Screenshots are not redacted.** Disable unwanted capture before
reviewing sensitive pages.

### Select only the evidence needed

Managed AI handoffs include a bounded manifest inventory, not the stored payloads.
The optional `apply-lcr` skill can read saved IDs/manifests directly from disk;
neither a live browser nor an lcr installation is required for ordinary file reads.
When lcr is available, offline helpers support focused reads:

```sh
lcr context inspect <id> --review <review.md>
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
