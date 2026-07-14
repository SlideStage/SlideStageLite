# @slidestage/core — Changelog

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

## 0.1.3

### Patch Changes

- Updated dependencies [4811496]
  - @slidestage/spec@0.1.1

## 0.1.2

See the root [`CHANGELOG.md`](../../CHANGELOG.md) of the SlideStage Lite
repository for the human-readable narrative of each release. This file
exists so the npm tarball ships a per-package changelog stub.

## 0.1.1 — 2026-05-21

- Cosmetic: `converter/buildManifest` sniffer description string now
  reads "SlideStage Lite" instead of "SlideStageLite". No API or schema
  change.

## 0.1.0

- Initial publication of the headless `@slidestage/core` runtime and
  converter primitives.
