# Open and Present a `.stage` Deck in SlideStage Lite

This tutorial is for first-time SlideStage Lite users. You will open a `.stage` file, enter the viewer, and use the basic presenter tools.

## Prerequisites

You need a valid `.stage` file and either the web or desktop version of SlideStage Lite.

Lite does not upload the deck. The file is read locally.

## 1. Open the deck

On the Lite landing page, either drop the `.stage` file onto the open area or select it with the file picker.

Lite reads the zip, parses `manifest.json`, checks slide paths, and enters the viewer.

## 2. Handle trust prompts

Some decks request extra capabilities:

- `same-origin-storage`
- `broadcast-channel`
- `window-open`

Lite asks for consent per deck fingerprint. Cancel if you do not trust the deck.

## 3. Present

Use the viewer toolbar for:

- Previous/next slide.
- Overview.
- Fullscreen.
- Blackout/whiteout.
- Laser and spotlight.
- Pen, highlighter, and eraser.

Annotations are stored in logical slide coordinates so they survive resizing.

## 4. Speaker notes

If `manifest.slides[].notes` is present, Lite shows notes in presenter view.

Packers usually extract notes from sidecar Markdown files or inline `<aside class="notes">` blocks.

## 5. Audience window

Open the audience window when you need a second display. It mirrors slide index, pointer state, blackout, spotlight, and annotations.

## Troubleshooting

If Lite rejects the file, verify the `.stage` package first.

If a reveal.js or impress.js deck loses runtime behavior, repack it with `wrap` mode.

If assets disappear offline, generate an offline mirrored package.
