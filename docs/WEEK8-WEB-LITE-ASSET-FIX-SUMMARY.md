# Week8 Web Lite Asset Fix Summary

## Problem

The Web Lite renderer had three linked failures on large mirrored decks:

- Chromium blocked `blob:` URLs in opaque-origin sandboxed iframes.
- Mirrored font CSS behind chained `@import` rules kept unresolved relative
  `../font/*.ttf` paths.
- The week8 deck (about 139 MiB of package assets, mostly CJK fonts) crashed
  the browser because the loader base64-inlined every asset into every
  `srcdoc` slide.

After the OOM path was fixed by routing large decks through the Service Worker,
two regressions surfaced:

- Virtual font URLs were double-prefixed to
  `/__stage/<id>/shared/__stage/<id>/assets/_mirror/font/*.ttf`, causing font
  404s.
- The presenter view worked, but the Web audience popup was blank because it
  did not mirror the presenter's auto-elevated `allow-same-origin` sandbox.

## Fixes

- Web deck loading now uses `inlineMode: 'auto'` with a 16 MiB default budget.
  Oversized decks skip the expensive data-URL pass and set
  `inlinedHtmlAvailable = false`.
- Oversized Web decks with a Service Worker transport are auto-granted
  `same-origin-storage`, which adds `allow-same-origin` and lets the iframe load
  same-origin virtual URLs from `/__stage/<deckId>/...`.
- The viewer shows a dismissible banner explaining that the large deck was
  mounted with same-origin access for efficient rendering.
- CSS `@import` targets are recursively inlined for package-local CSS, so
  mirrored `@font-face` URLs resolve against the imported CSS file before being
  rewritten.
- `/`-leading URLs are treated as external references in the rewriter, so
  already-virtual `/__stage/...` URLs are not rewritten a second time.
- Audience snapshots now include the presenter's resolved `iframeSandbox`.
  `AudienceView` uses that sandbox first, so auto-elevated large decks render in
  the audience popup through the same Service Worker path as the presenter.

## Test Script Coverage

Primary regression tests live in:

- `src/deck/loadDeck.test.ts` for inline budget and chained mirrored font
  rewriting.
- `src/deck/rewriteHtml.test.ts` for recursive `@import` handling and the
  virtual-URL double-prefix guard.
- `src/presenter/usePresentationSync.test.ts` for audience snapshot
  serialization fields.
- `tests/e2e/oversized-deck.spec.ts` for presenter auto-elevation, friendly
  no-Service-Worker error handling, and audience popup rendering.
- `tests/e2e/tricky-assets.spec.ts` for Web `srcdoc` asset rewrite behavior.

Useful verification commands:

```bash
pnpm tsc --noEmit
pnpm test:unit
pnpm exec playwright test tests/e2e/oversized-deck.spec.ts --reporter=list
pnpm test:e2e
pnpm build
```

## Manual Week8 Checklist

After hard-refreshing `localhost:5173` and loading
`hier-mas-week8-en.stage`:

- The presenter shows the auto-elevation banner with the deck size.
- The presenter iframe uses `src="/__stage/<id>/slides/..."`, not `srcdoc`.
- Font requests go to `/__stage/<id>/assets/_mirror/font/*.ttf` with no
  `/shared/__stage/` double prefix and no 404s.
- The visible font stack includes mirrored faces such as Inter / Noto Sans SC.
- The audience popup opens with a non-empty slide and its iframe sandbox
  contains `allow-same-origin`.
