# @slidestage/ui — Changelog

See the root [`CHANGELOG.md`](../../CHANGELOG.md) of the SlideStage Lite
repository for the human-readable narrative of each release.

## 0.1.1 — 2026-05-21

- `DeckStage` registers a `window.focus` listener that reclaims focus
  into the deck container whenever the host window regains focus
  (Alt/Cmd-Tab back, dismissing a system dialog). This keeps
  window-scoped keyboard shortcuts responsive without requiring an
  OS-level global shortcut hook on the host app.

## 0.1.0

- Initial publication of the shared SlideStage React UI primitives:
  viewer, presenter, audience, overlays.
