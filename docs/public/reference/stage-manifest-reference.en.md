# `.stage` Manifest Reference

A `.stage` file is a zip archive with a root `manifest.json`. The manifest describes the deck, slide files, dimensions, capabilities, and optional producer metadata.

The authoritative schema lives in `@slidestage/spec`.

## Minimal manifest

```json
{
  "schema": "slidestage@1.0",
  "id": "my-deck",
  "version": "1.0.0",
  "title": "My Deck",
  "subtitle": null,
  "author": null,
  "description": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "architecture": "multi-file",
  "dimensions": { "width": 1920, "height": 1080 },
  "totalSlides": 1,
  "slides": [
    {
      "index": 1,
      "id": "cover",
      "label": "Cover",
      "file": "slides/01-cover.html",
      "thumbnail": null,
      "notes": null
    }
  ]
}
```

## Required fields

- `schema`: must be `slidestage@1.0`.
- `id`: 1-128 chars; no `/`, `\`, `..`, NUL, or control chars.
- `version`: deck content version.
- `title`: human-readable title.
- `createdAt` / `updatedAt`: timestamps, preferably ISO 8601.
- `architecture`: one of the supported architecture values.
- `dimensions`: logical slide width and height.
- `totalSlides`: slide count.
- `slides[]`: non-empty slide list.

## Slide fields

Each slide needs:

- `index`
- `id`
- `label`
- `file`
- `thumbnail`
- `notes`

`file` and `thumbnail` must be safe package-relative paths.

## Architecture values

- `multi-file`
- `multi-file-flat`
- `single-file-deckstage`
- `single-file-html`

The original source framework belongs in `provenance.sourceKind`, not `architecture`.

## Capabilities

`compat.requires` can request:

- `same-origin-storage`
- `broadcast-channel`
- `window-open`

Lite and Pro use these values to show trust prompts and adjust the iframe sandbox.

## Fingerprint

Deck identity is the SHA-256 of the `.stage` zip bytes, not `manifest.id`.

Packers should use deterministic zip mtimes and stable entry ordering to keep fingerprints repeatable.
