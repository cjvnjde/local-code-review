# Reviewing a live UI

Start the local app, then run inside its Git repository:

```sh
lcr --web http://localhost:3000 --id checkout-ui
```

Web capture works alongside the Git diff and uses the same Markdown conversation.
It requires installed Chrome, Chromium, or Edge. Only local HTTP(S) URLs are accepted.

The overlay in the reviewed page lets you select an element or area. Its editor
is the same React note editor as the main review, embedded in a frame from the lcr
server. Write feedback, add images or a suggestion, and save. Captured screenshots
and element metadata remain in the review file, with pictures stored beside it.
**Full review** in the window header returns to the complete conversation.

The note window starts compact and can be moved, resized, or minimized. Captures
use named thumbnails; clicking one opens a viewer across the browser viewport.
Closing the viewer restores the window and its draft. **Capture details** holds
timestamps, element metadata, original screenshots, and selection removal. The
input and save controls stay visible while evidence scrolls above them.

The floating button shows the active capture mode. Click it to choose element,
block, multiple-element, area, or point targeting. **Browse page** lets you use
the app normally; **Annotate page** restores targeting. Hold Alt to interact
temporarily, or drag the floating button out of the way. Point captures retain
metadata without a screenshot.

**Add capture** temporarily minimizes the note so you can select more evidence.
The editor returns with its text intact after capture; Escape cancels selection
and returns without discarding the draft. Selecting another element directly
while composing still adds it to the same draft. On a saved note, new captures
belong to a reply rather than replacing its original evidence.

Choose **Draw** or **Edit drawing** beside a thumbnail to annotate it. Common
tools stay visible; **More tools** holds additional shapes, paths, magnification,
and original-image preview. **Options** shows settings for the active tool or
selection. Undo/redo and completion stay visible even in a narrow window.
**Use drawing** returns an image to the draft; **Save note** still saves the note.
**Save drawing** updates a drawing on an already-saved note. Originals and
editable drawing data are retained.

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
and full-page screenshots. All are enabled by default; turn off any evidence you
do not want saved, especially on pages with sensitive content. Changes persist in
the same user `lcr/config.json` used at startup. Saved context IDs and manifests
remain readable by the optional `apply-lcr` skill or `lcr context`.
