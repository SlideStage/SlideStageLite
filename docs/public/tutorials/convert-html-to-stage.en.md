# Convert HTML to `.stage` in SlideStage Lite

This tutorial shows how to use the SlideStage Lite browser converter to turn an HTML deck into a `.stage` file.

Conversion happens locally in the browser. Source files are not uploaded.

## 1. Open the converter

Open SlideStage Lite and choose the HTML deck converter.

It accepts:

- A single `.html` file.
- A folder with an entry HTML file.
- A `.zip` containing an HTML deck.
- An existing `.stage` file.

## 2. Choose the source

For multi-file decks, choose the folder or zip instead of only the entry HTML. This lets the converter include assets such as images, CSS, fonts, and scripts.

## 3. Pick a mode

Use `auto` unless you know the tradeoff.

- `split`: one output HTML file per slide.
- `wrap`: preserve the original deck runtime.
- `single`: plain HTML as one slide.
- `passthrough`: validate and re-emit an existing `.stage`.

Use `wrap` for reveal.js and impress.js when you need their runtime features.

## 4. Review capabilities

If scripts survive conversion, the manifest may include `compat.requires`. Lite will ask for consent during playback.

## 5. Download and verify

Download the generated `.stage`, then open it in Lite immediately.

Check slide order, assets, notes, and trust prompts.

## Troubleshooting

If folder upload is unavailable, zip the folder and upload the zip.

If reveal animations disappear, use `wrap` mode.

If offline assets are missing, run the mirror pass.
