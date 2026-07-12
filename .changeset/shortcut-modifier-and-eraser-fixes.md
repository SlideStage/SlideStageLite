---
"@slidestage/ui": patch
"@slidestage/lite-preset": patch
---

Fix keyboard-shortcut conflicts, modifier-key hijacking, eraser hover-erase,
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
