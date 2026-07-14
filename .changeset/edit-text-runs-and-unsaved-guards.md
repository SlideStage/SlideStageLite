---
"@slidestage/core": minor
"@slidestage/ui": minor
"@slidestage/lite-preset": minor
---

Slide text editing: mixed-font text runs, desktop save fix, unsaved-exit
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
