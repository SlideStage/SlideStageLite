# @slidestage/ui — Changelog

## 0.2.0

### Minor Changes

- aada661: In-place slide text editing with patch persistence and edited-copy export.

  An "Edit" toggle in the viewer toolbar (both single-window and presenter
  layouts) turns pure-text leaf elements inside the sandboxed slide iframe
  into `contentEditable` targets: click to edit, Enter/blur commits, Escape
  cancels. Each commit crosses the agent→host bridge as a validated `edit`
  message carrying a structural selector (`body>tag:nth-of-type(n)>...`)
  plus before/after TEXT (never HTML), and is persisted per deck under
  `slidestage-lite:edits:<fingerprint>` (capped at 500 patches / 1 MiB).
  The `.stage` file is never modified, so the fingerprint — and trust
  grants, annotations, notes — stay stable.

  Patches re-apply at load time through the new `LoadDeckOptions.
transformSlideHtml` hook, so both render flavors (inlined `srcdoc` and
  SW-published bytes), the audience window, thumbnails, and PDF export all
  carry the edits. Leaving edit mode silently reloads the deck from the
  retained source file to converge every surface; patches whose target no
  longer matches are skipped and surfaced as an "N edits could not be
  applied" notice. "Export copy" bakes the patches into a repacked
  `<name>.edited.stage` (all untouched entries byte-identical, manifest
  bytes verbatim); "Discard edits" clears the store and restores the
  original text.

  New public surface:

  - `@slidestage/core`: `deck/slidePatches` (`SlideTextPatch`,
    `applySlidePatchesToHtml`, `SLIDE_PATCH_SELECTOR_RE`, validators),
    `LoadDeckOptions.transformSlideHtml` (+ `TransformSlideHtmlContext`),
    `converter/pack.packStageEntries`, and edit-mode support in the runtime
    agent (`edit-mode` host command, `edit` report).
  - `@slidestage/ui`: `SlideEdit` + `parseSlideEdit`, the `edit` case in
    `parseAgentMessage`, `useSlideBridge` `editMode`/`onEdit` options,
    `DeckViewerEditing` header controls, and the `editing` prop on
    `DeckViewer` (`DeckViewerEditingApi`).
  - `@slidestage/lite-preset`: `persistence/editsStore`,
    `viewer/useDeckEdits`, `export/exportEditedStage`,
    `export/downloadStage`, and `getSourceFile`/`onRequestReload` props on
    the lite `DeckViewer`.

- 56bd8e4: Slide text editing: mixed-font text runs, desktop save fix, unsaved-exit
  reminders.

  - **Desktop export actually writes to disk.** The Tauri capability file
    was missing `fs:allow-write-file`, so "Export copy" and "Export PDF"
    silently failed after the native save dialog on macOS/Windows. The
    permission is granted now (scoped at runtime to the dialog-picked path
    only), together with `dialog:allow-ask` / `dialog:allow-confirm` —
    the latter also un-breaks the "Install Now" confirm of the manual
    update check. Export failures (edited copy and PDF) now surface as a
    dismissible red notice chip instead of only a button tooltip
    (`useDeckPdfExport` gained `dismissError`, `useDeckEdits` gained
    `onDismissExportError`).
  - **Per-run editing inside mixed-content elements.** Clicking a text run
    that shares its parent with differently-styled siblings (e.g.
    `<h1>投资组合<span>实证分析</span></h1>`) now edits just that run: the
    agent resolves the click to the direct text node via
    `caretPositionFromPoint`/`caretRangeFromPoint`, wraps it in a temporary
    contentEditable span, and commits a patch carrying a new optional
    `textNode` index (`SlideTextPatch.textNode`, validated end-to-end).
    Application sets that text node's `nodeValue` only; sibling elements
    are untouched. Emptying a run commits as cancel (an empty text node
    would vanish on reparse and shift sibling indices).
  - **Unsaved-edit exit reminders.** Edits made this session that were not
    exported to a `.stage` copy now prompt before they leave the screen:
    web `beforeunload`, desktop window-close + macOS Cmd+Q/menu quit (via
    a Rust-side `set_unsaved_edits` flag and a custom quit menu item), and
    the in-app "close deck" button. `saveStageFile` resolves `false` when
    the native save dialog is cancelled so the reminder stays armed;
    `useDeckEdits` exposes the new `unsaved` flag (`DeckEditsApi`).

- 7686d49: Mirror the presenter's live text selection ("划词") to the audience window.

  The in-iframe runtime agent now watches `selectionchange` on the presenter
  slide and forwards the bounding rects of the highlighted text (a new
  `selection` agent→host message). The rects travel on the existing
  presenter→audience sync channel as a retained `AudiencePresentationState.selection`
  field, and the audience renders them with a new presentational
  `SelectionOverlay` (mounted inside `.logical-stage`, so it lines up 1:1 with
  the slide underneath). Selecting, extending, switching slides, and clicking
  to collapse all behave like a native selection — collapsing clears the
  mirrored highlight.

  New public surface:

  - `@slidestage/core` runtime agent: presenter-side selection capture.
  - `@slidestage/ui`: `SelectionRect` type + `parseSelectionRects`, the
    `selection` case in `parseAgentMessage`, `useSlideBridge`'s `onSelection`
    callback, `AudiencePresentationState.selection` (+ strict sync-channel
    validation), and the `SelectionOverlay` component
    (`@slidestage/ui/presenter/SelectionOverlay`).

### Patch Changes

- 89cc61d: Fix keyboard-shortcut conflicts, modifier-key hijacking, eraser hover-erase,
  and silent open failures while a deck is on screen.

  - `usePresenterShortcuts` (`@slidestage/ui`): bare-key and Shift+key tool
    shortcuts no longer fire while Ctrl/Cmd/Alt is held. Previously Cmd+B
    (bookmarks) toggled blackout, Ctrl+W (close tab) toggled whiteout,
    Cmd+Shift+S (save as) activated the spotlight, Cmd+1..5 (tab switch)
    changed pen colors, and Cmd+[ (history back) nudged the spotlight radius.
    Cmd/Ctrl+Z (undo) is unchanged.
  - `AnnotationOverlay` (`@slidestage/ui`): the eraser only erases while a
    button/contact is actually pressed (`event.buttons !== 0`). Merely hovering
    the slide with the eraser selected no longer wipes annotations.
  - `LiteApp` (`@slidestage/lite-preset`): the viewer shortcuts `O` (overview)
    and `S` (speaker notes) now require the bare, unmodified key. This fixes
    the documented Shift+S = spotlight shortcut also toggling the speaker
    panel, and stops Cmd+O / Ctrl+S style system combos from being hijacked
    for navigation.
  - `LiteApp` (`@slidestage/lite-preset`): load errors that happen while a
    deck is already open (desktop file-open of a corrupt deck, denied trust
    prompt) now surface as a dismissible error chip instead of failing
    silently; the landing page no longer shows a stale error after the deck
    is closed.

- Updated dependencies [aada661]
- Updated dependencies [56bd8e4]
- Updated dependencies [7686d49]
  - @slidestage/core@0.2.0

## 0.1.3

### Patch Changes

- @slidestage/core@0.1.3

## 0.1.2

### Patch Changes

- 5468558: `markdown/renderMarkdown` now supports GFM tables. The renderer recognises
  a header row plus a `| --- | --- |` separator (with the optional `:---:` /
  `---:` / `:---` alignment markers) and emits `<table> / <thead> / <tbody>`
  HTML with `style="text-align:..."` on each `<th>` / `<td>` when an
  alignment is declared. Short rows are padded with empty cells, long rows
  are truncated to the header arity, and a `Param | Description` opener
  immediately after a paragraph correctly terminates the paragraph instead
  of being absorbed into it.

  The defensive `sanitizeHtml` pass keeps the new table-family tags
  (`<table> / <thead> / <tbody> / <tr> / <th> / <td>`) — the only
  table attribute the renderer emits is `style="text-align:..."`, and the
  existing `on*` handler stripper still runs over the result.

  `__internal` exports two new test hooks: `tryRenderTable` and
  `isTableSeparator`. The full GFM-table contract (10 vitest cases) is
  pinned in `src/markdown/renderMarkdown.test.ts`.

  This upstream unblocks the rootwebsite docs page, which had been vendoring
  its own copy of `renderMarkdown.ts` to ship table support. Consumers
  should bump their `@slidestage/ui` dep to `^0.1.2` and switch the imports
  back to the npm subpath; the vendored copy can be deleted afterward.

  Because `@slidestage/core`, `@slidestage/ui`, and `@slidestage/lite-preset`
  are a `fixed` group in `.changeset/config.json`, this `patch` against
  `@slidestage/ui` also patch-bumps `@slidestage/core` and
  `@slidestage/lite-preset` to keep the triad in lockstep — no behavioural
  change in `core` / `lite-preset`.

  - @slidestage/core@0.1.2

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
