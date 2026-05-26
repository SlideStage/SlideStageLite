// `.stage` container types are owned by `@slidestage/spec` (the format
// SoT introduced in Phase B of `docs/ECOSYSTEM_IMPROVEMENT_PLAN.md`).
// We re-export the spec types here so existing imports
// (`@slidestage/core/deck/types`) keep working, then add the runtime-only
// types that describe how the Lite/Pro players actually deliver a deck
// — those don't belong in the spec because they describe the renderer,
// not the on-disk contract.

export type {
  ArchitectureKind,
  Manifest,
  ManifestOffline,
  ManifestOfflineMirroredAsset,
  ManifestOfflinePolicy,
  ManifestOfflineSkippedReason,
  ManifestOfflineSkippedUrl,
  ManifestProvenance,
  ManifestSlide,
  TrustCapability,
  DeckLoadErrorCode,
} from '@slidestage/spec/types';
export { DeckLoadError } from '@slidestage/spec/types';

/**
 * Bytes-only payload the loader hands to a {@link DeckAssetTransport}.
 *
 * `bytes` is the asset body; the transport is responsible for serving
 * it back at the URL produced by {@link DeckAssetTransport.virtualUrlFor}.
 */
export interface StageAsset {
  /** Package-relative path inside the `.stage` archive. */
  path: string;
  /** MIME type the transport should hand back as `Content-Type`. */
  type: string;
  /** Asset bytes. The transport may detach the backing buffer. */
  bytes: Uint8Array;
}

/**
 * Pluggable backend that hosts a deck's assets at same-origin virtual
 * URLs. The Web build wires this to the Service Worker in
 * `src/browser/stageServiceWorker.ts`; tests can supply an in-memory
 * stub.
 *
 * When a transport is provided, the loader hands every deck asset
 * (slides, fonts, images, css...) to the transport up-front and
 * rewrites slide HTML so references point at the URLs the transport
 * promised. The deck's iframe can then load those URLs without
 * tripping over Chrome's blob: URL partitioning — the URLs live in the
 * SPA's origin and look like ordinary same-origin assets to the
 * sandboxed iframe.
 */
export interface DeckAssetTransport {
  /**
   * Build the URL that {@link publishDeck}'s asset at `path` will be
   * served from. Must be deterministic so the loader can rewrite slide
   * HTML before {@link publishDeck} resolves.
   */
  virtualUrlFor(deckId: string, path: string): string;
  /**
   * Hand the full asset bundle over to the transport. Resolves once
   * every asset is reachable through {@link virtualUrlFor}.
   */
  publishDeck(deckId: string, assets: ReadonlyArray<StageAsset>): Promise<void>;
  /**
   * Drop the deck's bundle. May be no-op (e.g. on app teardown when
   * the host is going away anyway).
   */
  unpublishDeck(deckId: string): Promise<void> | void;
}

export interface LoadDeckOptions {
  /**
   * When provided, the loader publishes asset bytes to the transport
   * and the returned `slideUrls` point at the transport's virtual
   * URLs (same-origin, served from `/__stage/...`). When omitted, the
   * loader falls back to `blob:` URLs with `data:`-inlined asset refs;
   * the viewer must then render slides via `srcdoc` instead of `src`.
   */
  transport?: DeckAssetTransport | null;
  /**
   * When true, strip every external `<link rel="stylesheet|preconnect
   * |dns-prefetch|preload">` from the `srcdoc` flavour of slide HTML.
   * Reserved for hosts that cannot recover from a slow/unreachable CDN
   * — i.e. Tauri WKWebView, where each unreachable Google Fonts URL
   * stalls the WebView for ~30s before paint. Defaults to `false`: on
   * the Web build we keep the link, downgrade it to `media="print"`
   * (see {@link rewriteHtml}'s `deferExternalStylesheetLinks`) so it
   * loads asynchronously and the deck still picks up CDN typography
   * once it lands. Setting this to `true` on the Web silently breaks
   * Google Fonts-style decks; the App-level caller is responsible for
   * choosing the right value via `isTauri()`.
   */
  stripExternalLinks?: boolean;
  /**
   * Controls whether the loader pre-computes the `data:`-URL-inlined
   * `srcdoc` flavour of every slide HTML.
   *
   * - `'always'` (default, used by Tauri where there is no SW): every
   *   slide is inlined regardless of size. Lets the viewer flip
   *   between transport and srcdoc instantly.
   * - `'auto'` (used by Web): inline only when total uncompressed
   *   asset bytes are `<= inlineBudgetBytes`. Above the threshold the
   *   loader skips `createDataUrls` entirely (its base64 cost is what
   *   crashes the renderer on huge CJK-font decks) and the deck MUST
   *   be rendered via the transport. Caller's responsibility to ensure
   *   the iframe has `allow-same-origin` — see the App-level
   *   auto-elevation policy.
   * - `'never'`: refuse to inline. Useful for testing the trusted
   *   path even on small decks.
   *
   * When the budget is exceeded and no transport is available the
   * loader throws {@link DeckLoadError} with code
   * `E_TOO_LARGE_FOR_INLINE` — there is no safe way to display the
   * deck in that environment.
   */
  inlineMode?: 'always' | 'auto' | 'never';
  /**
   * Total-uncompressed-bytes ceiling for the `'auto'` inline mode.
   * Defaults to {@link DEFAULT_INLINE_BUDGET_BYTES} = 16 MiB. The
   * raw asset bytes get base64-encoded (×1.33 inflation) AND copied
   * into every slide's srcdoc that references them, so even a 16
   * MiB raw budget can produce several hundred MiB of HTML on a
   * 28-slide deck. The default value was picked to give comfortable
   * headroom for typical web-font decks while still tripping on the
   * known-bad CJK-mirror cases (40 MiB+ of fonts).
   */
  inlineBudgetBytes?: number;
}

/**
 * Default inline budget for the `'auto'` mode of {@link LoadDeckOptions.inlineMode}.
 *
 * 16 MiB raw bytes ≈ 21 MiB base64 per slide. At 28 slides (the largest
 * we have observed without crashes) that is ~600 MiB of HTML strings,
 * right at the V8 string-heap pressure boundary. Decks above this size
 * MUST be rendered via the transport (Service Worker) instead.
 */
export const DEFAULT_INLINE_BUDGET_BYTES = 16 * 1024 * 1024;

export interface LoadedDeck {
  fileName: string;
  fingerprint: string;
  /**
   * Short stable identifier derived from {@link fingerprint}. Used as
   * the transport namespace (e.g. URL segment) and as the React `key`
   * for deck-scoped subtrees. Stable across reloads of the same deck.
   */
  deckId: string;
  manifest: import('@slidestage/spec/types').Manifest;
  /**
   * Per-slide URLs the iframe should load via `src`.
   *
   * - With a transport (Web build, Service Worker available): virtual
   *   URLs like `/__stage/<deckId>/slides/01.html`. Same-origin, so
   *   the sandboxed iframe can fetch its subresources without hitting
   *   Chrome's blob: URL partitioning.
   * - Without a transport (Tauri, file://, hosts that block service
   *   workers): `blob:` URLs whose HTML body has every asset reference
   *   inlined as `data:` URLs. The viewer should additionally render
   *   the active iframe via `srcdoc` instead of `src` (see
   *   {@link prefersSrcdoc}).
   */
  slideUrls: string[];
  /**
   * Per-slide rewritten HTML strings whose subresources are inlined as
   * `data:` URLs. Populated when the loader decided to inline (see
   * {@link inlinedHtmlAvailable}). When `inlinedHtmlAvailable === false`
   * each entry is a small "<!-- srcdoc disabled -->" placeholder and the
   * viewer MUST render via `src={slideUrls[i]}` only. Same length and
   * order as {@link slideUrls}.
   */
  slideHtml: string[];
  /**
   * `false` means the loader skipped the data-URL inline pass (because
   * the package exceeds {@link LoadDeckOptions.inlineBudgetBytes}, or
   * because `inlineMode` was explicitly `'never'`). In that case the
   * viewer cannot fall back to `srcdoc` for opaque-origin iframes — the
   * caller must arrange a same-origin sandbox (via a trust grant that
   * adds `allow-same-origin`) before the iframe is mounted.
   */
  inlinedHtmlAvailable: boolean;
  /**
   * Total uncompressed bytes of every asset entry in the package
   * (excluding `manifest.json`). Used by the App layer to drive the
   * auto-elevation policy for oversized decks.
   */
  totalAssetBytes: number;
  /**
   * Thumbnail URLs in the same scheme as {@link slideUrls} (virtual
   * URL when a transport is present, otherwise raw `blob:` URL).
   */
  thumbnailUrls: Array<string | null>;
  /**
   * Hint to the viewer: when true, the active slide iframe should be
   * rendered with `srcdoc={slideHtml[i]}` instead of `src={slideUrls[i]}`.
   * True whenever the loader could not publish to a transport, since
   * the resulting `slideUrls` are `blob:` URLs that no longer carry
   * usable subresources in modern Chromium. The Tauri build also sets
   * this via the existing isTauri() branch.
   */
  prefersSrcdoc: boolean;
  /**
   * Release resources held by the deck. Revokes any object URLs and
   * (best-effort) unpublishes the deck from its transport.
   */
  revoke: () => void;
}
