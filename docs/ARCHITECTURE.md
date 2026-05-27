# Architecture

## System Shape

`SlideStageLite` is a static single-page app. The runtime only ever ingests
strict `.stage` packages; converting from other HTML deck formats is the
job of the separate `SlideStage Converter` (see `docs/CONVERTER.md`).

```
local .stage file
        |
        v
FileReader / ArrayBuffer
        |
        v
ZIP reader -> manifest validator -> deck asset registry
        |
        v
React presentation shell
        |
        +--> sandboxed slide iframe
        +--> presenter overlay
        +--> speaker notes / overview UI
        +--> local persistence
```

For users who hold an `html-ppt-skill` / `huashu-design` / single-HTML deck,
the in-app converter (PR-Cv4) accepts those sources, packs them into a
proper `.stage`, and hands the result back to the same loader path.

There is no trusted server-side component. Anything that previously happened in
the source platform backend must either move into the browser or be removed.

## Actual App Layout (post package split, 2026-05-27)

The repo no longer ships a single flat `src/` tree. The Lite app is an
assembly layer over five workspace packages; the root `src/` only holds
the Vite entry, routing shell, and a couple of root-only smoke tests.

```
SlideStageLite/
├── docs/
├── packages/
│   ├── spec/                  # @slidestage/spec — format only, zero runtime deps
│   │   └── src/
│   │       ├── constants.ts
│   │       ├── manifestSchema.ts
│   │       ├── pathSafety.ts
│   │       ├── trustCapabilities.ts
│   │       └── types.ts
│   ├── core/                  # @slidestage/core — headless runtime + converter
│   │   └── src/
│   │       ├── createSlideStage.ts
│   │       ├── deck/
│   │       │   ├── loadDeck.ts
│   │       │   ├── manifestSchema.ts        # re-export from @slidestage/spec
│   │       │   ├── pathSafety.ts
│   │       │   ├── rewriteHtml.ts
│   │       │   ├── trustCapabilities.ts
│   │       │   └── types.ts
│   │       └── converter/
│   │           ├── sniffer.ts
│   │           ├── buildManifest.ts
│   │           ├── pack.ts
│   │           ├── splitReveal.ts
│   │           ├── splitImpress.ts
│   │           ├── splitInlineDeck.ts
│   │           ├── splitRouter.ts
│   │           ├── splitWebComponent.ts
│   │           └── …
│   ├── ui/                    # @slidestage/ui — React shell, no host coupling
│   │   └── src/
│   │       ├── viewer/
│   │       │   ├── DeckViewer.tsx           # generic shell
│   │       │   ├── DeckStage.tsx
│   │       │   ├── Overview.tsx
│   │       │   ├── SpeakerNotesPanel.tsx
│   │       │   ├── NotesPanel.tsx
│   │       │   ├── AudienceView.tsx
│   │       │   ├── useStageLayout.ts
│   │       │   └── viewMath.ts
│   │       ├── presenter/
│   │       │   ├── usePresenter.ts
│   │       │   ├── AnnotationOverlay.tsx
│   │       │   ├── LaserPointer.tsx
│   │       │   ├── Spotlight.tsx
│   │       │   ├── Blackout.tsx
│   │       │   ├── Toolbar.tsx
│   │       │   ├── types.ts
│   │       │   └── transport/
│   │       ├── markdown/
│   │       └── i18n/
│   ├── lite-preset/           # @slidestage/lite-preset — Lite host wiring
│   │   └── src/
│   │       ├── litePreset.tsx
│   │       ├── app/
│   │       ├── viewer/                      # Lite-specific viewer wrappers
│   │       │   ├── DeckViewer.tsx
│   │       │   └── AudienceView.tsx
│   │       ├── browser/
│   │       │   └── stageServiceWorker.ts    # SW client (transport)
│   │       ├── persistence/
│   │       │   ├── annotationStore.ts
│   │       │   ├── notesStore.ts
│   │       │   ├── trustStore.ts
│   │       │   └── legacyMigration.ts
│   │       ├── desktop/                     # Tauri-only adapters
│   │       └── i18n/
│   └── brand/                 # @slidestage/brand — marks/wordmarks/social-cards
│       └── src/
├── src/                       # root app shell only
│   ├── App.tsx
│   ├── main.tsx
│   └── routes.tsx
├── public/
│   └── stage-sw.js
├── tests/
│   └── e2e/
└── package.json
```

The names are guidance, not a migration requirement. The important
boundary is that deck parsing, stage rendering, presenter state, and
persistence stay separate, AND that nothing in `packages/{core,ui}/`
reaches into Lite-only host concerns like the SW or the IndexedDB
schema.

## Core Modules

### Deck Loader

Responsibilities:

- Accept a `File` object that is a `.stage` (ZIP) package.
- Read it as an `ArrayBuffer`.
- Open the ZIP archive in memory.
- Reject unsupported entries before making them available.
- Parse and validate `manifest.json` against `slidestage@1.0`.
- Verify every `slides[].file` exists.
- Build an asset registry that maps package-relative paths to local Blob/Object
  URLs.
- Return a `LoadedDeck` object for the viewer.

Actual shape used by the loader (see `packages/core/src/deck/types.ts`
for the source of truth):

```ts
interface LoadedDeck {
  fileName: string;
  fingerprint: string;
  deckId: string;                 // short fingerprint used by the SW transport
  manifest: Manifest;
  slideUrls: string[];            // virtual /__stage/<deckId>/... URLs (SW)
                                  // or blob: URLs (fallback / Tauri)
  slideHtml: string[];            // self-contained HTML for srcdoc fallback
                                  // (a small placeholder when
                                  // `inlinedHtmlAvailable === false`)
  inlinedHtmlAvailable: boolean;  // false ⇒ slideHtml entries are stub
                                  // placeholders; viewer MUST use src
  totalAssetBytes: number;        // sum of every non-manifest asset
  prefersSrcdoc: boolean;         // viewer hint: render via srcdoc when true
  thumbnailUrls: Array<string | null>;
  revoke: () => void;
}
```

The loader does not track "where this deck came from"; any non-`.stage`
artifact must go through the converter first (see `docs/CONVERTER.md`).
`trustRequirements` and friends are folded into `manifest.compat.requires`
and surfaced via the trust prompt.

The loader accepts an optional `LoadDeckOptions.transport` whose
`DeckAssetTransport` interface lets the viewer plug in the Service Worker
client. When a transport is provided the loader publishes every package
asset (slides included, with relative refs rewritten to virtual URLs) and
returns virtual URLs. When it isn't (Tauri, `file://`, SW unavailable, or
publish failure) the loader silently falls back to inlined `blob:`+`data:`
URLs and flips `prefersSrcdoc = true` so the viewer renders via `srcdoc`.

`LoadDeckOptions` also exposes the **inline-budget** controls used by
the Web build to dodge OOM on oversized decks (146 MB CJK-mirror
decks were SIGTERM-ing the renderer; see
`docs/INCIDENT-BLOB-PARTITIONING.md §6d`):

| option              | default                | meaning                                                   |
|---------------------|------------------------|-----------------------------------------------------------|
| `inlineMode`        | `'always'`             | `'always'` (Tauri) / `'auto'` (Web) / `'never'` (testing) |
| `inlineBudgetBytes` | `16 * 1024 * 1024`     | when `'auto'`, skip the data-URL pass if `totalAssetBytes` exceeds this |

`'auto'` + oversized + transport ⇒ the loader leaves `slideHtml`
entries as `<!-- srcdoc disabled -->` placeholders and sets
`inlinedHtmlAvailable = false`. The App layer
(`App.tsx → openDeckFile`) reacts by auto-granting
`same-origin-storage` (so the iframe sandbox gains `allow-same-origin`
and the SW route is consulted instead of the placeholder srcdoc) and
showing a sticky banner to the user. `'auto'` + oversized + NO
transport throws `E_TOO_LARGE_FOR_INLINE` because there is no
renderable path at all.

### Asset Registry

Lite needs to expose package paths to the iframe without a real backend.
The loader prepares **two parallel materializations of every slide** and
lets the viewer pick per-iframe:

1. **Virtual URLs (`/__stage/<deckId>/<package-relative-path>`).**
   Published into a Service Worker cache by `public/stage-sw.js`. The SW
   serves the bytes with permissive CORS. These URLs are what the viewer
   wires into `<iframe src=...>` **only when the iframe has been trust-
   elevated to include `allow-same-origin`** — Chrome explicitly skips
   service worker control for opaque-origin (`allow-scripts`-only)
   iframes, so the virtual URL would otherwise resolve through the SPA
   fallback and return `index.html` instead of slide HTML.
2. **Inlined `srcdoc` + `data:` URLs.** Every package-relative subresource
   in the slide HTML is rewritten to a `data:` URL before the loader
   exposes it. The viewer hands this self-contained string to
   `<iframe srcdoc=...>`. Because data: URLs don't require a real origin
   to resolve, this works in every host — Tauri WKWebView, `file://`,
   plain web sandboxed iframes, and any browser that disables Service
   Workers.

   **External CDN links survive on the Web**: `<link rel="stylesheet"
   href="https://fonts.googleapis.com/...">` is downgraded to
   `media="print"` plus an `onload` swap to `media="all"`. First paint
   uses the deck's local CSS only; CDN typography upgrades the look
   asynchronously when the request lands. Tauri callers may pass
   `loadDeck(file, { stripExternalLinks: true })` instead — WKWebView
   stalls for tens of seconds per unreachable external URL, so we drop
   them entirely there and accept the system-font fallback.

The viewer's decision lives in
`sandboxAllowsSameOrigin(iframeSandbox)` (see
`packages/core/src/deck/trustCapabilities.ts`, which re-exports from
`packages/spec/src/trustCapabilities.ts`):

```ts
const useSrcdoc =
  isTauri()                   // WKWebView can't reach blob:tauri://
  || deck.prefersSrcdoc        // host has no transport at all
  || !sandboxAllowsSameOrigin(iframeSandbox); // opaque origin → SW bypassed
```

Real-world coverage today:

| Host / Trust state                                  | iframe attribute | transport |
| --------------------------------------------------- | ---------------- | --------- |
| Web build, baseline `allow-scripts`, deck ≤ 16 MiB  | `srcdoc`         | data:     |
| Web build, deck > 16 MiB → auto-elevated            | `src`            | SW virtual URL |
| Web build, trust grants `allow-same-origin`         | `src`            | SW virtual URL |
| Tauri desktop                                       | `srcdoc`         | data:     |
| `file://` / SW disabled / SW registration failed   | `srcdoc`         | data:     |
| `file://` / SW unavailable, deck > 16 MiB           | (load fails: `E_TOO_LARGE_FOR_INLINE`) | — |

Why both formats are kept around: the rewrite cost is paid once at
deck load and the inlined `slideHtml[]` is plain text in the React
DOM. Materializing virtual URLs for assets is essentially free (the
SW only caches bytes that the trust-elevated path will fetch). Keeping
both means the viewer can flip strategy mid-session — e.g. if the user
just granted trust on a previously-loaded deck — without re-walking
the package.

Why this matters: Chrome 131+ partitions `blob:` URLs by
(top-level site, origin) and treats a sandboxed iframe as an opaque
origin distinct from its embedder. Pointing
`<iframe src="blob:http://localhost:5173/...">` at such an iframe
yields `net::ERR_BLOCKED_BY_CLIENT` ("已屏蔽：其他" in zh-CN DevTools).
The two-format strategy avoids the issue: opaque-origin iframes get
`srcdoc` (no blob: URLs anywhere), and same-origin iframes navigate to
a real same-origin URL whose response carries
`Access-Control-Allow-Origin: *`.

The asset registry type kept by the loader is now (source of truth in
`packages/core/src/deck/types.ts`):

```ts
interface StageAsset {
  path: string;            // package-relative, normalized
  type: string;            // Content-Type used verbatim by the transport
  bytes: Uint8Array;       // raw bytes (slides are rewritten before publish)
}

interface DeckAssetTransport {
  virtualUrlFor(deckId: string, path: string): string;
  publishDeck(deckId: string, assets: ReadonlyArray<StageAsset>): Promise<void>;
  unpublishDeck(deckId: string): Promise<void> | void;
}
```

The SW client (`packages/lite-preset/src/browser/stageServiceWorker.ts`)
implements this interface; the loader is otherwise transport-agnostic.

### Viewer Shell

Responsibilities:

- Own the active `LoadedDeck`.
- Display loading, invalid deck, and viewer states.
- Coordinate navigation, overview, speaker notes, fullscreen, and toolbar.
- Pass only the active slide URL and dimensions into `DeckStage`.

### Deck Stage

Responsibilities:

- Render the active slide in an iframe.
- Apply letterbox scaling from `manifest.dimensions`.
- Expose layout data to overlays.
- Keep iframe sandbox strict.

MVP iframe settings:

```html
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
```

Do not add `allow-same-origin` unless a future security review explains why the
risk is acceptable. Slide HTML is untrusted, and same-origin script execution was
a critical issue in the source platform.

How the iframe gets the slide depends on four flags. The viewer
collapses them into `useSrcdoc`:

```ts
const useSrcdoc =
  deck.inlinedHtmlAvailable &&                  // (0)
  (isTauri()                                    // (1)
    || deck.prefersSrcdoc                       // (2)
    || !sandboxAllowsSameOrigin(iframeSandbox)); // (3)
```

- (0) `inlinedHtmlAvailable === false` ⇒ `slideHtml[]` is a placeholder
  body (the loader skipped the inline pass because the deck exceeds
  `inlineBudgetBytes`). Insisting on srcdoc would paint an empty
  slide; the App layer's auto-elevation has already arranged
  `allow-same-origin` on the sandbox so the iframe MUST mount via
  `src={slideUrls[i]}` and let the SW serve the bytes.
- (1) Tauri WKWebView can't reach `blob:tauri://` URLs.
- (2) `prefersSrcdoc` is set by the loader when no transport was
  supplied at all (Tauri, `file://`, SW registration failed); in that
  case there are no virtual URLs to point at and the viewer MUST use
  srcdoc.
- (3) Even on the web with a healthy SW, a sandboxed iframe (`allow-
  scripts` only) is opaque-origin and Chrome bypasses SW interception
  for it. Trust prompts can grant `allow-same-origin`, at which point
  the iframe becomes same-origin with the parent and the SW takes
  over.

When `useSrcdoc` is true the iframe is rendered as
`<iframe srcdoc={slideHtml[index]} />` (every subresource inlined as
data:). When false the iframe is rendered as
`<iframe src={slideUrls[index]} />` (virtual URL routed through the SW).

The same rule applies to `AudienceView`, which mirrors the presenter's
choice over `BroadcastChannel` / Tauri event transport. The
`SerializedAudienceDeck` snapshot now carries `inlinedHtmlAvailable`
and `totalAssetBytes` alongside the existing fields so both windows
make the same src-vs-srcdoc decision. The surrounding `AudienceSnapshot`
also carries the presenter's resolved `iframeSandbox` token string; the
audience window prefers that over re-deriving capabilities from
`manifest.compat.requires`, because App-level auto-elevation (for
oversized decks) can grant `same-origin-storage` even when the manifest
declares no trust requirements.

### Presenter State

Presenter state should be centralized in a reducer-style hook:

```ts
interface PresenterState {
  tool: Tool;
  penColor: string;
  spotlightRadius: number;
  pointerPos: Point | null;
  strokesBySlide: Record<number, Stroke[]>;
  blackout: 'none' | 'black' | 'white';
}
```

All tool mutations should go through this layer so keyboard shortcuts, toolbar
buttons, overlay pointer events, persistence, and optional BroadcastChannel sync
stay consistent.

### Converter (sibling pipeline)

`packages/core/src/converter/` is a **separate** pipeline that produces
`.stage` packages from outside formats. It shares no runtime state with
the loader beyond the manifest/slide type definitions in
`packages/core/src/deck/types.ts` and
`packages/core/src/deck/manifestSchema.ts` (which re-export from
`packages/spec/src/*`).

Two entry points share the same core:

- **Node CLI**: `pnpm convert pack <src> --out <file.stage>` for CI and
  command-line use.
- **In-app**: a "Convert from HTML deck" button in the SPA accepts an
  outside-format file, runs the converter in the browser tab, downloads
  the resulting `.stage`, and (optionally) immediately loads it into the
  viewer.

The converter is described in detail in `docs/CONVERTER.md`. Conceptually:

```
source file/folder
        |
        v
sniffDeck(entries)   // identify shape: inline-deck / WC / router / plain-html / slidestage
        |
        v
buildManifestFromSource(sniff, entries, options)
        |
        v
pack(entries, manifest, { mode: 'split' | 'wrap' })
        |
        v
.stage ZIP (real manifest.json + slide HTML + assets) + convert-report.md
```

### Persistence

Persistence is local and deck-scoped:

- Small settings: `localStorage`.
- Annotation payloads and recent deck metadata: IndexedDB.
- Deck key: fingerprint derived from stable deck data.

Suggested fingerprint input:

```text
manifest.schema + manifest.id + manifest.version + file.size + sha256(first/last chunks)
```

Do not use only `manifest.id`. Different local files can legitimately share an
ID.

## State Ownership

| State | Owner | Persistence |
| --- | --- | --- |
| Open deck file | Viewer shell | Memory only |
| Manifest | `LoadedDeck` | Memory, recent metadata only |
| Slide index | Navigator | `localStorage` by deck fingerprint |
| Tool/color/spotlight radius | Presenter reducer | `localStorage` |
| Annotations | Presenter reducer | IndexedDB by deck fingerprint + slide index |
| Overview / speaker panel open state | Viewer shell | Optional `localStorage` |
| Object URLs | Asset registry | Memory, revoked on deck close |

## Data Flow

### Load Flow

1. User selects a file.
2. `loadDeck(file)` parses and validates it.
3. App revokes URLs from the previous deck.
4. App stores recent metadata and last-opened fingerprint.
5. Viewer renders slide `0` or restored slide index.

### Navigation Flow

1. Keyboard, toolbar, overview, or hash input requests a target slide.
2. Navigator clamps target to `[0, totalSlides - 1]`.
3. Viewer updates active slide index.
4. Stage updates iframe `src`.
5. Overlay reads the same layout and slide index.
6. Last position is persisted.

### Annotation Flow

1. Overlay converts pointer coordinates from viewport to logical stage space.
2. Presenter reducer appends/removes strokes.
3. Overlay renders immediately.
4. Persistence layer debounces IndexedDB writes.
5. On reload of the same deck fingerprint, annotations hydrate before editing is
   enabled.

## Security Model

Lite cannot enforce server-side ownership, but it can still reduce local browser
risk:

- Treat every slide as untrusted active HTML.
- Render slides in sandboxed iframes without `allow-same-origin`.
- Rewrite only safe package-relative asset paths.
- Reject absolute paths, `..`, null bytes, and unsupported entry types.
- Apply size limits before creating large Blobs.
- Avoid passing privileged data into iframe query strings.
- Never expose app internals to slide frames through `postMessage` without
  validating `event.source`.

## Deployment Model

The final build is static:

```
pnpm build -> dist/
```

Any static host can serve `dist/`. The app should not require API proxy config,
environment secrets, cookies, or database migrations.

There is one operational constraint introduced by the Service Worker: the host
must serve `/stage-sw.js` from the **same path as the SPA root** (or, when
the SPA is mounted under a sub-path, must serve the SW from that sub-path)
so the SW's scope covers `/__stage/*`. The build copies `public/stage-sw.js`
into `dist/stage-sw.js`; static hosts (GitHub Pages, Vercel, Cloudflare
Pages, simple `nginx`, `tauri serve` for desktop) need no extra config.

Hosts that do not allow registering a Service Worker (some kiosk modes,
old browsers, `file://`, Tauri webview) will silently fall back to the
`srcdoc` + `data:` URL path described above. See
`docs/SERVICE_WORKER.md` for the full fallback matrix.
