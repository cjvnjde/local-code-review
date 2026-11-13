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
**Open full review** returns to the complete conversation.

The input and save controls stay at the bottom of the note window while screenshots
and capture details scroll above them. Clicking a screenshot opens a viewer across
the browser viewport; closing it restores the note window and its draft.

The **lcr** circle toggles annotation and normal browsing. Hold Alt to interact
with the app temporarily. The targeting tools still support element, area, and
point captures; metadata-only point captures have no screenshot. Additional
selections made while composing a draft are retained. Capture details are
expandable in the note. Existing drawings are displayed as images; the drawing
editor and interactive comparison tools are not included in this branch.

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
