# Incident — Web build slides render unstyled (blob: URLs blocked)

**Status:** Resolved
**Date:** 2026-05-19
**Build affected:** SlideStageLite web build (`pnpm dev`, `pnpm build` → static host)
**Build NOT affected:** SlideStageLite Tauri desktop build (already used `srcdoc` + `data:` URLs)
**Resolution:** Service Worker virtual asset host (`public/stage-sw.js`) plus graceful `srcdoc` fallback.

---

## 1. Symptom

In the web build the deck iframe loaded but every external asset shown in
DevTools → Network was annotated:

```
blob:http://localhost:5173/<uuid>     已屏蔽：其他   stylesheet   0.0 kB   0 ms
blob:http://localhost:5173/<uuid>     已屏蔽：其他   stylesheet   0.0 kB   0 ms
... (one row per stylesheet / font / image)
```

The slide HTML itself loaded (status 200), but every CSS rule and image
referenced through `url(blob:...)` / `<link href="blob:...">` /
`<img src="blob:...">` came back blocked with size 0 and time 0. The
visual result was an unstyled, image-less slide with raw fallback fonts.

The same `.stage` package rendered correctly in the Tauri desktop build
and in Chrome ≤ 130.

---

## 2. Root cause

The loader (`src/deck/loadDeck.ts`) used to:

1. Unzip the `.stage` package into a per-deck asset registry.
2. Mint one `blob:` URL per asset via `URL.createObjectURL(...)`.
3. Rewrite slide HTML so `../shared/tokens.css` (etc.) pointed at the
   corresponding blob URL.
4. Hand the slide HTML to the iframe as another `blob:` URL via
   `<iframe sandbox="allow-scripts" src="blob:<spa>/<uuid>">`.

That contract assumed the iframe and parent share the **same blob
URL partition**. Chrome 131 (Edge 131, Brave) shipped **blob URL
partitioning**:

> Blob URLs are now keyed by `(top-level site, origin)`. When the
> creator's origin doesn't match the consumer's origin/partition, the
> blob URL behaves as if it were never created.
>
> — <https://developer.chrome.com/blog/blob-url-partitioning>

A sandboxed iframe with `sandbox="allow-scripts"` has an **opaque
origin** that is by definition distinct from its parent. The iframe
therefore can no longer reach any blob URL minted by the SPA. Every
subresource fetch fails with `net::ERR_BLOCKED_BY_CLIENT`, which the
DevTools `zh-CN` locale renders as "已屏蔽：其他".

We confirmed this by tracing `loadDeck.ts → DeckStage.tsx →
trustCapabilities.ts` and reproducing the same symptom in a clean
Chrome 131 tab without any extensions.

Adding `allow-same-origin` would technically fix the blob issue but
would also let slide HTML run with the SPA's origin — which is exactly
the threat model the sandbox exists to enforce. It was never an
option.

---

## 3. Options considered

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| **A** | Switch web build to the Tauri-style `srcdoc` + inline `data:` URLs for everything. | Tiny diff, works everywhere immediately. | Inflates DOM size 1.5–2× per slide; CSS/img caching becomes per-slide; doesn't scale to large decks. | Tactical, not strategic. |
| **B** | Keep `src=blob:` for the slide but rewrite every internal asset reference to `data:` URLs before creating the slide blob. | Avoids cross-asset blob hops. | Initial blob navigation still subject to partitioning; large decks still pay the data-URL cost. | Half measure. |
| **C** | Register a Service Worker that owns `/__stage/*` and serves deck assets from the SPA's own origin under virtual URLs. | Permanent, performant fix; assets are real same-origin URLs that the iframe can fetch, cache, and reuse; works for both presenter and audience window. | More moving parts; needs to handle SW lifecycle, fallbacks, and operational concerns (deployment scope, cache eviction, debugging). | Initially chosen. |

The user selected Option C explicitly, prioritising the long-term
solution over a quick patch.

### Mid-implementation discovery — Service Workers don't control opaque-origin iframes

After building the full SW pipeline (`public/stage-sw.js`,
`src/browser/stageServiceWorker.ts`, loader transport plumbing) and
landing 313 passing unit tests, Playwright reproduced the original
"empty iframe" symptom in a headless Chromium against the SW. Trace
inspection showed `GET /__stage/<id>/slides/01-cover.html` returning
200, but the response body's SHA-1 matched the SPA's `index.html` —
**Vite's SPA fallback was serving the iframe, not the Service Worker**.

The reason is a deliberate Chrome behavior: a sandboxed iframe without
`allow-same-origin` has an opaque ("null") origin, and Service Workers
are scoped per non-opaque origin. Null-origin clients can never have a
controller, so the SW's `fetch` handler is never even invoked for
their requests. Adding `allow-same-origin` would route everything
through the SW, but that's exactly the security relaxation the
sandbox exists to prevent for untrusted slide HTML.

### Final design (chosen) — hybrid B

After surfacing this in real-world tests (and via 寸止 follow-up the
user explicitly picked **B**: keep the SW, but only let it serve
trust-elevated iframes):

- **Default (`allow-scripts` only, untrusted decks)** → render via
  `srcdoc` with every subresource inlined as `data:` URLs. Same
  approach Tauri has used for months; bullet-proof against blob URL
  partitioning, opaque origins, and any future origin-based blocking.
- **Trust-elevated (`allow-same-origin` granted via manifest's
  `same-origin-storage` / `broadcast-channel` capabilities)** →
  render via `<iframe src="/__stage/<deckId>/...">` so the SW
  intercepts and serves bytes from `CacheStorage`. This keeps slide
  HTML lean even when the deck bundles 100 MB of fonts/imagery.

The loader publishes both materializations of every slide
unconditionally; the viewer collapses the three flags
(`isTauri()`, `deck.prefersSrcdoc`, sandbox tokens) into a single
`useSrcdoc` decision per iframe. See
`src/viewer/DeckViewer.tsx` and `src/viewer/AudienceView.tsx` for
the call sites and `src/deck/trustCapabilities.ts` for the
`sandboxAllowsSameOrigin(...)` helper.

---

## 4. Implementation summary

The full design lives in `docs/SERVICE_WORKER.md`; the architecture
fold-in is in `docs/ARCHITECTURE.md`. The code changes are:

### New files

- `public/stage-sw.js` — Service Worker. Owns `/__stage/*`; serves
  cached asset bytes with `Access-Control-Allow-Origin: *`. Per-deck
  `CacheStorage` buckets named `slidestage-deck:<deckId>`. Supports
  `publish-deck`, `unpublish-deck`, `cleanup-decks`, `ping` via
  `MessagePort`.
- `src/browser/stageServiceWorker.ts` — SPA-side client. Idempotent
  registration, `getStageServiceWorkerClient()`, `virtualUrlFor`,
  `publishDeck`, `unpublishDeck`, `cleanupDecks`. Returns `null` on
  hosts that can't run the SW so the loader can fall back.
- `src/deck/loadDeck.test.ts` — covers the new transport path,
  publish-failure fallback, deterministic `deckId` derivation, and
  `unpublish` on revoke.
- `src/browser/stageServiceWorker.test.ts` — `virtualUrlFor` encoding
  + SW-unsupported fallback.
- `docs/SERVICE_WORKER.md` — design + operations.
- `docs/INCIDENT-BLOB-PARTITIONING.md` — this file.

### Changed files

- `src/deck/types.ts` — `LoadedDeck` gains `deckId` (short
  fingerprint), `prefersSrcdoc` (viewer hint). Adds
  `StageAsset`, `DeckAssetTransport`, `LoadDeckOptions`, and
  `E_TRANSPORT_PUBLISH_FAILED`.
- `src/deck/loadDeck.ts` — accepts an optional transport. When
  available, rewrites slide HTML to virtual URLs and publishes the
  full asset set to the SW. When unavailable (Tauri, file://, SW
  registration failure, publish failure), inlines every asset as
  `data:` URLs and flips `prefersSrcdoc = true`. The legacy
  `blob:`-URL slide path is preserved for backwards-compatible
  callers that still drive `<iframe src={slideUrls[i]}>`.
- `src/app/App.tsx` — calls `registerStageServiceWorker()` at module
  load, resolves a `StageServiceWorkerClient` lazily, threads it into
  `loadDeck`, and runs `cleanupStageDecks([currentDeckId])` after
  every successful load.
- `src/viewer/DeckViewer.tsx`, `src/viewer/AudienceView.tsx` — switch
  the iframe between `src` and `srcdoc` based on
  `deck.prefersSrcdoc` (still always `srcdoc` in Tauri).
- `src/presenter/usePresentationSync.ts` — extends the serialized
  audience deck shape with `deckId` + `prefersSrcdoc` so the audience
  window renders identically.
- `docs/ARCHITECTURE.md` — Asset Registry, Deck Stage, and
  Deployment sections updated; `LoadedDeck` shape refreshed.

---

## 5. Verification

### Unit tests

```
pnpm test
```

All previously-passing suites stayed green, plus the two new files
above. Highlights:

- `loadDeck.test.ts` (Node env, polyfilled `URL.createObjectURL`):
  - publishes every package asset (including rewritten slide HTML) to
    the recording transport with stable ordering and `application/*`
    content types;
  - returns virtual URLs (`/__stage/<deckId>/slides/...`) when a
    transport is supplied;
  - returns a self-contained `data:` URL for `slideHtml` when no
    transport is supplied;
  - derives the same `deckId` for identical content;
  - surfaces publish failures as `DeckLoadError`
    `E_TRANSPORT_PUBLISH_FAILED`;
  - calls `unpublishDeck` on `revoke()`.
- `stageServiceWorker.test.ts` (jsdom): `virtualUrlFor` URL encoding,
  and the "SW unsupported" fallback returning `null` from
  `registerStageServiceWorker()`.

### TypeScript

```
pnpm tsc --noEmit
```

Clean after the test-fixture adjustments (`useThumbnailCapture.test.tsx`
needed `deckId`/`prefersSrcdoc` on its `LoadedDeck` mock).

### Production build

```
pnpm build
```

Build succeeded; `dist/stage-sw.js` is shipped alongside the SPA
bundle and registers under scope `/`.

### Browser end-to-end (Playwright Chromium)

Two scenarios in `tests/e2e/trust-prompt.spec.ts`:

1. **Untrusted deck** (`valid-basic.stage`, no `compat.requires`):
   - `sandbox="allow-scripts"` (baseline only).
   - Iframe rendered with `srcdoc=...<!doctype html>...`.
   - `srcdoc` body contains `Lite Fixture Deck` and **no `blob:`**
     references — assets are inlined as `data:` URLs.
2. **Trust-elevated deck** (`huashu-webcomponent-deck` packed in wrap
   mode, manifest declares all three capabilities):
   - Trust prompt appears, grant elevates sandbox to
     `allow-scripts allow-same-origin allow-popups
     allow-popups-to-escape-sandbox`.
   - Iframe rendered with `src="/__stage/<deckId>/..."` and **no
     `srcdoc`** attribute.
   - Slide content (`<h1>WC 1</h1>`) is visible inside the iframe,
     proving the Service Worker actually intercepted and served the
     HTML.

Both assertions are part of the regular `pnpm test:e2e` run.

---

## 6. Follow-up — Web srcdoc lost Google Fonts

**Status:** Fixed (same incident, 2026-05-19)

After landing the hybrid B design, the user re-tested with a real
Plus-Jakarta-Sans deck and reported that fonts were not loading.
Two distinct bugs surfaced; both are documented below.

### 6a. External CDN stylesheets silently dropped

#### Cause

`loadDeck.ts` unconditionally piped the srcdoc HTML through
`stripExternalLinkReferences`, which deletes every external
`<link rel="stylesheet|preconnect|dns-prefetch|preload">`. That
helper was originally written for the **Tauri WKWebView** where each
unreachable external URL stalls the WebView ~30s before paint. On the
Web build the same helper silently ate Google Fonts (and any other
CDN-served stylesheet) for the default sandbox flavour.

#### Fix

`LoadDeckOptions` now carries a `stripExternalLinks` flag (default
`false`). `loadDeck` only strips external links when the caller opts
in. `App.tsx` passes `stripExternalLinks: isTauri()` so:

- Web build (`isTauri() === false`): external stylesheet links survive,
  but are downgraded to `media="print"` with an `onload` swap (see
  `rewriteHtml.ts → deferExternalStylesheetLinks`). First paint is not
  blocked; CDN fonts upgrade the look as soon as they land.
- Tauri build (`isTauri() === true`): external links are dropped, the
  deck gracefully degrades to system fonts, the WebView never stalls
  on an unreachable CDN.

#### Coverage

- Unit (`src/deck/loadDeck.test.ts`):
  - "keeps external stylesheet links (deferred) in the srcdoc flavour
    by default"
  - "strips external stylesheet links when stripExternalLinks is
    enabled (Tauri)"
- E2E (`tests/e2e/tricky-assets.spec.ts`): the regenerated
  tricky-assets fixture now includes a Plus-Jakarta-Sans `<link>` plus
  a `<link rel="preconnect">`. The test asserts both survive in the
  rendered srcdoc — the stylesheet with `media="print"` + `onload`
  swap, and the preconnect untouched.

### 6b. Mirrored fonts produced wrong MIME for non-woff2 formats

#### Cause

Even after the Web build kept CDN links alive, the user's mirrored
deck (CDN URLs already pulled into `assets/_mirror/font/...`) still
showed default typography. Tracing the rewrite pipeline showed the
inlined @font-face emitted

```css
src: url("data:application/octet-stream;base64,...") format("truetype");
```

for `.ttf` / `.otf` / `.woff` / `.eot` / `.avif` files because
`getContentType()` only had entries for `.html / .css / .js / .json /
.svg / .png / .jpe?g / .gif / .webp / .woff2? / .mp4 / .mp3`. The
`woff2?` pattern also coerced `.woff` to `font/woff2`, which Safari
WebKit silently rejects.

Browsers technically use the `format(...)` hint to pick a parser, but
Safari (and headless WebKit) refuses data: URLs with
`application/octet-stream` MIME for fonts outright, and the
`font-display: swap` fallback never animates in either — the slide
just paints with the OS default forever.

#### Fix

`src/deck/loadDeck.ts → contentTypes` now distinguishes every common
font/media extension:

| extension | MIME                            |
|-----------|---------------------------------|
| `.woff2`  | `font/woff2`                    |
| `.woff`   | `font/woff`                     |
| `.ttf`    | `font/ttf`                      |
| `.otf`    | `font/otf`                      |
| `.eot`    | `application/vnd.ms-fontobject` |
| `.avif`   | `image/avif`                    |
| `.ico`    | `image/x-icon`                  |
| `.webm`   | `video/webm`                    |
| `.wav`    | `audio/wav`                     |
| `.ogg`    | `audio/ogg`                     |

The Service Worker transport reads `assets[].type` straight from the
loader, so trust-elevated decks pick up the new MIMEs too — `Content-
Type` on every virtual URL response is now correct without any SW-side
change.

#### Coverage

`src/deck/loadDeck.test.ts → "loadDeck with mirrored assets"`:

- Builds a synthetic mirrored deck (slide HTML with a
  `<link rel="stylesheet" href="../assets/_mirror/css/...">`, a CSS
  file declaring two `@font-face`s pointing at sibling-relative
  `.woff2` and `.ttf` URLs, and the font payloads themselves).
- Asserts the inlined `<style data-slidestage-inline-css>` block
  emits `data:font/woff2;base64,...` for the woff2 source AND
  `data:font/ttf;base64,...` for the truetype source.
- Asserts no leftover `../font/<hash>` sibling-relative URL escapes
  into the rendered HTML.

### 6c. Mirrored fonts behind a chained `@import` still 404'd

#### Cause

The user's actual deck (`hier_mas Research Deck — Week 7`) chains a
shared design-tokens CSS that `@import`s the mirrored CSS file, which
in turn declares the `@font-face`s:

```css
/* shared/tokens.css */
:root { --sans: 'Inter', system-ui, sans-serif; }
@import url("../assets/_mirror/css/8de586a6c979fced.css");
```

```css
/* assets/_mirror/css/8de586a6c979fced.css */
@font-face {
  font-family: 'Inter';
  src: url("../font/d0f4bc7faca46837.ttf") format('truetype');
}
```

The first inline pass (`<link rel="stylesheet" href="tokens.css">` →
`<style data-slidestage-inline-css="shared/tokens.css">`) rewrote the
`@import url("...")` to point at a `data:text/css;base64,...` URL of
the mirrored CSS body — technically correct but operationally broken,
because:

1. `data:` URLs have no base, so `url("../font/...ttf")` inside the
   imported body has no anchor to resolve against.
2. The `srcdoc` iframe has an opaque (`null`) origin, so even if the
   browser tried to resolve the relative URL it would treat the base
   as the page itself (`about:srcdoc`) and produce a 404.

The result was identical to the pre-fix symptom: the inline `<style>`
contained a `@import url("data:text/css;...")` whose body referenced
sibling-relative font URLs that resolved to nothing. DevTools showed
no font network requests at all (because the parent fetched the
`data:` CSS synchronously and silently failed every `url(...)`
descendant).

#### Fix

`src/deck/rewriteHtml.ts` now **recursively inlines** `@import`
targets when a `lookupText(path)` function is available (it always is
in the loader):

```ts
// New: cssImportInlinePattern matches both @import url(...) and
// @import "..." string forms.
const cssImportInlinePattern =
  /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)|"([^"]*)"|'([^']*)')\s*;?/gi;

const IMPORT_INLINE_DEPTH = 8; // hard cap on inline recursion

function inlineCssImports(css, fromPath, lookup, lookupText, visited, depth) {
  if (!lookupText || depth >= IMPORT_INLINE_DEPTH) return css;
  return css.replace(cssImportInlinePattern, (match, ...captures) => {
    const ref = captures.find(Boolean)?.trim();
    if (!ref) return match;
    const resolved = resolvePackageReference(fromPath, ref);
    if (!resolved) return match;             // external (https:/data:) — leave it
    if (visited.has(resolved)) return '';     // cycle break: drop inner @import
    const importedCss = lookupText(resolved);
    if (importedCss === null) return match;
    const nextVisited = new Set(visited);
    nextVisited.add(resolved);
    const innerProcessed = rewriteCssBody(
      importedCss, resolved, lookup, lookupText, nextVisited, depth + 1,
    );
    return `/* slidestage:inlined @import ${resolved} */\n${innerProcessed}\n/* slidestage:end @import ${resolved} */\n`;
  });
}
```

`rewriteCssBody` is now a three-phase pipeline:

1. **Phase 1**: splice `@import` targets we have the bytes for (with
   cycle protection via `visited`).
2. **Phase 2**: rewrite `url(...)` references against the **current**
   base path — every `url("../font/...")` inside a spliced body uses
   the imported file's path as the base, not the parent's.
3. **Phase 3**: rewrite any remaining `@import "..."` string-form
   survivors (external CDN, dynamic, etc.) to lookup URLs.

The same `lookupText` is now also threaded through
`rewriteRemainingCss`, so inline `<style>@import url("...")</style>`
blocks authored directly in slide HTML get spliced too.

#### Coverage

- `src/deck/rewriteHtml.test.ts → "@import string form"` adds four
  new cases:
  - Recursive inlining of `@import url(...)` with nested url() refs
    resolved against the imported file.
  - Recursive inlining of `@import "..."` string form.
  - Graceful fallback when the imported file isn't in `lookupText`
    (e.g. external https://) — the @import stays put.
  - Cycle break test: `a.css @import b.css; b.css @import a.css;` —
    the inner @import is dropped and both rule sets survive.
  - Deep chain test: 4-level @import chain still produces the leaf
    font as a `data:font/woff2;base64,...` URL.
- `src/deck/loadDeck.test.ts → "loadDeck with chained @import
  mirrored fonts (real-world structure)"` reconstructs the exact
  three-file layout from the user's broken deck (`shared/tokens.css`
  → `@import url("../assets/_mirror/css/...")` → three `.ttf`
  `@font-face`s) and asserts:
  - the `<style data-slidestage-inline-css>` block contains the
    `slidestage:inlined @import` marker;
  - no `@import url(` or `@import "` survives in the final body;
  - all three font files are inlined as `url("data:font/ttf;base64,...")`;
  - no `../font/<hash>.ttf` sibling-relative URL escapes.
- `tests/e2e/tricky-assets.spec.ts` was updated to assert the new
  recursive-inline behaviour: the inlined CSS now contains the
  `slidestage:inlined @import` breadcrumb and zero surviving
  `@import url(`.
- Hand verification with the user's real `hier-mas-week7-en.stage`
  (one-shot Playwright probe, not enrolled in CI): zero `..ttf`
  network requests, zero `blob:` requests, body `font-family`
  computes to `Inter, ...` from a declared `@font-face`, only
  remaining font request is the deferred Google Fonts CDN
  (`fonts.gstatic.com/.../plusjakartasans/...woff2 → 200`).

### 6d. Oversized CJK-font decks OOMed the renderer

#### Cause

After fixing 6a/6b/6c, the user dropped in
`hier-mas-week8-en.stage` (85 MB compressed, **146 MB uncompressed**,
72 files including **34 CJK fonts** of 10–15 MB each). The renderer
process exited with `code: 5` (Chrome's SIGTERM-on-OOM) within a few
seconds. The crash happened **before** any slide painted.

Root cause was structural in the loader, not the rewriter:

1. `loadDeck.ts → createDataUrls(entries)` base64-encodes EVERY non-
   slide asset upfront and stores the resulting strings in a
   `Map<string,string>`. 88 MB of fonts × 1.33 base64 inflation = ~117
   MB of strings before any slide is even touched.
2. `createSlideContents()` then rewrites each slide HTML, inlining
   every referenced data URL. With a 28-slide deck and shared
   `tokens.css → @import mirrored.css` chains (whose @font-face
   declarations 6c now correctly inlines), each slide's rewritten
   HTML balloons to ~100 MB. Total V8 string heap pressure pushes
   the renderer past its limit.
3. The viewer was preparing to throw the inlined srcdoc away anyway
   (the trust pipeline would auto-elevate to same-origin for big
   decks, which uses `<iframe src={virtualUrl}>` not srcdoc), so the
   entire inline pass was wasted memory.

The pre-fix architecture **always** produced both flavours (srcdoc
+ virtual URL) so the viewer could flip between them instantly,
which made step 1 unconditional. Cheap on a 2 MB deck, fatal on a
146 MB one.

#### Fix

`LoadDeckOptions` grew two new fields:

| field                | meaning                                                        |
|----------------------|----------------------------------------------------------------|
| `inlineMode`         | `'always'` (default, Tauri) / `'auto'` (Web) / `'never'` (test) |
| `inlineBudgetBytes`  | total uncompressed-bytes ceiling for `'auto'`; default 16 MiB  |

`loadDeck.ts` now:

```ts
const totalAssetBytes = computeTotalAssetBytes(entries);
const inlineRequested =
  inlineMode === 'always' ||
  (inlineMode === 'auto' && totalAssetBytes <= inlineBudgetBytes);
if (!inlineRequested && !transport) {
  throw new DeckLoadError('E_TOO_LARGE_FOR_INLINE', '...');
}
const dataUrls = inlineRequested ? createDataUrls(entries) : null;
```

When `inlineRequested === false` the entire base64 pass is skipped,
every slide's `html` field gets a tiny placeholder body
(`<!-- SlideStage: inline srcdoc was skipped for this deck; ... -->`),
and `LoadedDeck.inlinedHtmlAvailable` is set to `false`. The
transport (Service Worker) still receives the rewritten slide
HTML and every package asset — the deck is fully renderable, just
not via srcdoc.

`App.tsx → openDeckFile` then auto-elevates oversized decks:

```ts
if (!nextDeck.inlinedHtmlAvailable && requiredCaps.length === 0) {
  saveTrustGrant(nextDeck.fingerprint, ['same-origin-storage']);
  enterDeck(nextDeck, ['same-origin-storage'], { autoElevatedFor: 'size' });
  return;
}
```

The `same-origin-storage` capability adds `allow-same-origin` to the
iframe sandbox, which makes Chrome route subresource fetches through
the SW — so the SW serves every font as a normal same-origin asset
and the renderer never sees a single base64 blob. The user is
notified via a sticky banner:

> This deck weighs in at 139 MB. To render it efficiently,
> SlideStageLite mounted it with same-origin access (so the in-tab
> service worker can serve its assets without inlining every byte as
> a data: URL). The deck can read browser storage for this site
> while it is open.

`DeckViewer` and `AudienceView` guard against the
"oversized + srcdoc" misuse:

```ts
const useSrcdoc =
  deck.inlinedHtmlAvailable &&
  (isTauri() || deck.prefersSrcdoc || !sandboxAllowsSameOrigin(iframeSandbox));
```

The audience BroadcastChannel snapshot
(`SerializedAudienceDeck`) now carries `inlinedHtmlAvailable` and
`totalAssetBytes` so the audience window applies the same decision.

When `inlineMode === 'auto'` AND oversized AND no transport, the
loader throws `E_TOO_LARGE_FOR_INLINE` with a localized
("E_TOO_LARGE_FOR_INLINE: This deck is larger than the inline budget…
Try opening it in Chrome, Brave, or the SlideStage desktop app, or
repackage the deck with smaller fonts/images.") message; App.tsx
swaps in the friendly copy instead of leaking the raw error.

#### Coverage

- `src/deck/loadDeck.test.ts → "loadDeck inlineMode budget"` (7
  cases): `always` keeps inlining at any size; `auto` + small
  inlines; `auto` + oversized + transport skips inline (asserts
  `inlinedHtmlAvailable === false`, slideHtml is the placeholder,
  the transport still got every asset, the published HTML has
  virtual URLs not the placeholder); `auto` + oversized + NO
  transport throws `E_TOO_LARGE_FOR_INLINE`; `never` skips
  unconditionally; `never` + no transport throws too;
  `totalAssetBytes` excludes manifest.json.
- `tests/e2e/oversized-deck.spec.ts`: 20 MB fixture
  (`pnpm fixtures → tests/fixtures/oversized.stage`) auto-elevates,
  banner is visible, iframe sandbox contains `allow-same-origin`,
  iframe `src` points at `/__stage/<id>/slides/`, `srcdoc` is
  absent, no `blob:` network hits, dismiss button hides the
  banner. A second test stubs `navigator.serviceWorker.register`
  to reject and confirms the friendly `E_TOO_LARGE_FOR_INLINE`
  error surfaces with no banner.
- Hand verification with `hier-mas-week8-en.stage` (146 MB,
  one-shot Playwright probe, not enrolled in CI): renderer **did
  not crash**, banner shows "139 MB", SW served 46 stage requests
  (43 of them fonts), zero `blob:` requests, computed
  `font-family` is `Inter, "Noto Sans SC", -apple-system,
  sans-serif`, total load time 1.9 s.

### 6e. Same fix re-introduced a double-prefix font 404

#### Cause

The 6d patch routed oversized decks through the SW transport, so
the lookup function in `rewriteCssBody` started returning
**absolute virtual URLs** like `/__stage/<id>/<path>` instead of
the previous `data:` URLs. The recursive `@import` inliner (from
6c) does three passes inside `rewriteCssBody`:

1. **Phase 1** — splice every package-local `@import` body
   recursively, with each inner call using *its own* file path as
   the base.
2. **Phase 2** — rewrite every `url(...)` in the now-flattened body
   using the **outer** file's path as the base.
3. **Phase 3** — rewrite any string-form `@import "..."` survivors.

For data: URLs phase 2 was a safe no-op because
`isExternalReference("data:...")` short-circuits
`resolvePackageReference`. But `isExternalReference` did **not**
recognise `/`-leading absolute paths, so the already-rewritten
inner URL `/__stage/<id>/assets/_mirror/font/x.ttf` was treated as
a relative path and re-resolved against the outer file's
directory (`shared/`):

```
inner:   url("../font/x.ttf")
phase 1: spliced into tokens.css; phase A in the inner call rewrites
         it against assets/_mirror/css/088c0dbe4ed1de23.css
         → url("/__stage/abc/assets/_mirror/font/x.ttf")  ✓
phase 2: outer call walks again, base = "shared/tokens.css", and
         resolvePackageReference("shared/tokens.css",
                                 "/__stage/abc/assets/_mirror/font/x.ttf")
         normalises to "shared/__stage/abc/assets/_mirror/font/x.ttf"
         and lookup("shared/__stage/...") returns
         "/__stage/abc/shared/__stage/abc/assets/_mirror/font/x.ttf"
         → 404 on the SW.
```

DevTools showed dozens of these:

```
http://127.0.0.1:5173/__stage/<id>/shared/__stage/<id>/assets/_mirror/font/e7a1aaf7eda9f2fa.ttf  → 404 (font)
```

`week8` rendered with system-font fallbacks instead of the
mirrored CJK + Inter faces.

#### Fix

Single-line guard in `src/deck/pathSafety.ts → isExternalReference`:

```ts
export function isExternalReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('#') ||
    // Any absolute path: `//foo` and `/foo`. Both forms cannot be
    // package-relative — `normalizePackagePath` rejects leading
    // slashes — so we treat them as external and leave them alone.
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('mailto:') ||
    externalSchemePattern.test(trimmed)
  );
}
```

This makes phase 2 a true no-op for any URL that's already
absolute, regardless of scheme.

#### Coverage

- `src/deck/rewriteHtml.test.ts → "does not double-prefix
  already-virtual URLs when the lookup returns absolute paths"`:
  reconstructs the exact tokens.css → mirrored.css → font.ttf chain
  with a virtual-URL lookup and asserts the final body contains
  the single-prefixed `/__stage/abc/assets/_mirror/font/x.ttf` and
  no `/__stage/abc/shared/__stage/` substring.
- Hand verification re-ran the one-shot week8 diag probe: every
  url() in the published slide HTML is single-prefixed, the SW
  served all 130 stage requests, zero 404/5xx responses.

### 6f. Auto-elevated deck rendered in presenter but blanked the audience window

#### Cause

After 6d/6e, the presenter view worked: oversized decks auto-granted
`same-origin-storage`, the presenter iframe sandbox gained
`allow-same-origin`, and the slide mounted via `/__stage/<id>/...`.

The Web audience popup still came up blank because it was re-deriving
its sandbox locally:

```ts
const requiredCaps = normalizeCapabilities(deck.manifest.compat?.requires);
const grant = requiredCaps.length > 0 ? loadTrustGrant(deck.fingerprint, requiredCaps) : null;
const iframeSandbox = grant ? sandboxTokensFor(grant.capabilities) : BASE_SANDBOX_TOKEN;
```

That logic works for explicitly trusted decks, but an auto-elevated
oversized deck has **no** `compat.requires`; the App layer grants
`same-origin-storage` because of size, not because the package asked
for it. So the audience popup fell back to `allow-scripts` only. With
an opaque-origin iframe, Chrome bypasses the Service Worker and the
`/__stage/<id>/slides/...` iframe navigation resolves to the SPA
fallback instead of the slide HTML.

#### Fix

The presenter now ships the resolved sandbox token string in every
audience snapshot:

```ts
snapshot: {
  deck: serializeAudienceDeck(deck),
  presentation,
  iframeSandbox,
}
```

`AudienceView` stores that value as `presenterSandbox` and prefers it
over local trust-store derivation:

```ts
const iframeSandbox = presenterSandbox ?? deriveFromLocalTrustStore();
```

This makes the audience window mirror the exact runtime posture the
presenter is using, including App-level auto-elevation grants that are
not declared in the manifest.

#### Coverage

- `src/presenter/usePresentationSync.test.ts` now asserts the snapshot
  envelope accepts `iframeSandbox` and that `inlinedHtmlAvailable` /
  `totalAssetBytes` survive deck serialization.
- `tests/e2e/oversized-deck.spec.ts → "oversized deck: audience popup
  also mounts via SW (mirrors presenter sandbox)"` loads the oversized
  fixture, opens the audience popup, asserts the popup iframe sandbox
  contains `allow-same-origin`, asserts its `src` is
  `/__stage/<id>/slides/01-cover.html`, asserts `srcdoc` is absent,
  and verifies the slide content is visible inside the audience frame.

---

## 7. Followups

None blocking. Possible enhancements tracked separately:

- Surface SW-related warnings in the UI ("Running in compatibility
  mode — slides are inlined as data: URLs") for hosts where the SW
  silently falls back.
- Background-prefetch sibling slides into the SW cache on idle.
- Move the SW path / scope into a build-time config so the SPA can be
  mounted under arbitrary sub-paths without source edits.
