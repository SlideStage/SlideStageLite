# @slidestage/ui — Changelog

See the root [`CHANGELOG.md`](../../CHANGELOG.md) of the SlideStage Lite
repository for the human-readable narrative of each release.

## 0.1.2 — 2026-05-27

- `markdown/renderMarkdown` now supports GFM tables. The renderer
  recognises a header row plus a `| --- | --- |` separator (with the
  optional `:---:` / `---:` / `:---` alignment markers) and emits
  `<table> / <thead> / <tbody>` HTML with `style="text-align:…"` on
  each `<th>` / `<td>` when an alignment is declared. Short rows are
  padded with empty cells, long rows are truncated to the header
  arity, and a `Param | Description` opener immediately after a
  paragraph correctly terminates the paragraph instead of being
  absorbed into it.
- The defensive `sanitizeHtml` pass keeps the new table-family tags
  (`<table> / <thead> / <tbody> / <tr> / <th> / <td>`) — the only
  table attribute the renderer emits is `style="text-align:…"`, and
  the existing `on*` handler stripper still runs over the result.
- `__internal` exports two new test hooks: `tryRenderTable` and
  `isTableSeparator`. The full GFM-table contract (10 vitest cases) is
  pinned in `src/markdown/renderMarkdown.test.ts`.
- This upstream unblocks the rootwebsite docs page, which had been
  vendoring its own copy of `renderMarkdown.ts` to ship table
  support. Consumers should bump their `@slidestage/ui` dep to
  `^0.1.2` and switch the imports back to the npm subpath; the
  vendored copy can be deleted afterward.

## 0.1.1 — 2026-05-21

- `DeckStage` registers a `window.focus` listener that reclaims focus
  into the deck container whenever the host window regains focus
  (Alt/Cmd-Tab back, dismissing a system dialog). This keeps
  window-scoped keyboard shortcuts responsive without requiring an
  OS-level global shortcut hook on the host app.

## 0.1.0

- Initial publication of the shared SlideStage React UI primitives:
  viewer, presenter, audience, overlays.
