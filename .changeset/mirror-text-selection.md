---
"@slidestage/core": minor
"@slidestage/ui": minor
---

Mirror the presenter's live text selection ("划词") to the audience window.

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
