---
"@slidestage/core": minor
"@slidestage/ui": minor
"@slidestage/lite-preset": minor
---

In-place slide text editing with patch persistence and edited-copy export.

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
