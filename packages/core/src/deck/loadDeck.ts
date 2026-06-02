import { ZodError } from 'zod';
import { parseManifest } from './manifestSchema';
import { normalizePackagePath } from './pathSafety';
import { safeUnzipSync } from './safeUnzip';
import { rewriteHtmlAssetReferences, stripExternalLinkReferences } from './rewriteHtml';
import {
  DEFAULT_INLINE_BUDGET_BYTES,
  DeckLoadError,
  type LoadDeckOptions,
  type LoadedDeck,
  type Manifest,
  type StageAsset,
} from './types';

// HTML body served when the inline-data-URL pass was skipped (because
// the package exceeded `inlineBudgetBytes` or `inlineMode === 'never'`).
// The viewer never paints this — App-level auto-elevation guarantees
// the iframe will mount with `src={slideUrls[i]}` instead of srcdoc —
// but the field has to stay populated to keep `slideHtml.length ===
// slideUrls.length` for downstream consumers that iterate both arrays
// in lockstep.
const SRCDOC_DISABLED_PLACEHOLDER =
  '<!doctype html><meta charset="utf-8"><title>srcdoc disabled</title>' +
  '<!-- SlideStage: inline srcdoc was skipped for this deck; ' +
  'render via slideUrls[i] under a same-origin-elevated sandbox. -->';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const maxPackageBytes = 200 * 1024 * 1024;
const maxDecompressedBytes = 1024 * 1024 * 1024;
const maxEntryBytes = 100 * 1024 * 1024;
const maxManifestBytes = 5 * 1024 * 1024;
const maxSlideHtmlBytes = 5 * 1024 * 1024;

// Note on font MIME types: the @font-face rule technically uses
// `format(...)` for the engine hint, but browsers (notably Safari and
// some headless WebKit builds) refuse data: URLs that carry
// `application/octet-stream` as the MIME — the font never loads and
// no `font-display: swap` fallback animates in either. Always emit
// the canonical font/* MIME so the data: URL works everywhere.
const contentTypes: Array<[RegExp, string]> = [
  [/\.html?$/i, 'text/html;charset=utf-8'],
  [/\.css$/i, 'text/css;charset=utf-8'],
  [/\.js$/i, 'text/javascript;charset=utf-8'],
  [/\.json$/i, 'application/json;charset=utf-8'],
  [/\.svg$/i, 'image/svg+xml'],
  [/\.png$/i, 'image/png'],
  [/\.jpe?g$/i, 'image/jpeg'],
  [/\.gif$/i, 'image/gif'],
  [/\.webp$/i, 'image/webp'],
  [/\.avif$/i, 'image/avif'],
  [/\.ico$/i, 'image/x-icon'],
  [/\.woff2$/i, 'font/woff2'],
  [/\.woff$/i, 'font/woff'],
  [/\.ttf$/i, 'font/ttf'],
  [/\.otf$/i, 'font/otf'],
  [/\.eot$/i, 'application/vnd.ms-fontobject'],
  [/\.mp4$/i, 'video/mp4'],
  [/\.webm$/i, 'video/webm'],
  [/\.mp3$/i, 'audio/mpeg'],
  [/\.wav$/i, 'audio/wav'],
  [/\.ogg$/i, 'audio/ogg'],
];

function getContentType(path: string): string {
  return contentTypes.find(([pattern]) => pattern.test(path))?.[1] ?? 'application/octet-stream';
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new DeckLoadError('E_BAD_MANIFEST', `${label} must be valid UTF-8.`);
  }
}

function normalizeEntries(rawEntries: Record<string, Uint8Array>): Map<string, Uint8Array> {
  let total = 0;
  const entries = new Map<string, Uint8Array>();

  for (const [rawPath, bytes] of Object.entries(rawEntries)) {
    if (rawPath.endsWith('/')) {
      continue;
    }

    const path = normalizePackagePath(rawPath);
    if (bytes.byteLength > maxEntryBytes) {
      throw new DeckLoadError('E_TOO_LARGE', `Package entry is too large: ${path}`);
    }

    total += bytes.byteLength;
    if (total > maxDecompressedBytes) {
      throw new DeckLoadError('E_TOO_LARGE', 'Deck exceeds the decompressed size limit.');
    }

    entries.set(path, bytes);
  }

  return entries;
}

function readManifest(entries: Map<string, Uint8Array>): Manifest {
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) {
    throw new DeckLoadError('E_NO_MANIFEST', 'manifest.json is missing from the package root.');
  }
  if (manifestBytes.byteLength > maxManifestBytes) {
    throw new DeckLoadError('E_TOO_LARGE', 'manifest.json exceeds the size limit.');
  }

  try {
    return parseManifest(JSON.parse(decodeUtf8(manifestBytes, 'manifest.json')));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      throw new DeckLoadError('E_BAD_MANIFEST', 'manifest.json does not match slidestage@1.0.');
    }
    throw error;
  }
}

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  // Content-only fingerprint: byte-identical decks (re-uploaded, renamed, or
  // re-emitted by the converter) must hash to the same value so persisted
  // state like trust grants, annotations, and speaker notes survives.
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// `data:` URLs are inlined into the slide HTML for the `srcdoc` flavor
// of the viewer (Tauri WKWebView; also the SW-unavailable fallback on
// the Web build). Reason: an iframe rendered with `sandbox="allow-scripts"`
// gets an opaque (null) origin. Chrome 131+ partitions `blob:` URLs by
// the creator origin / top-level site, so an opaque-origin iframe can't
// fetch parent-origin `blob:` URLs (every `url(blob:...)`, `<img
// src="blob:...">`, etc. returns "blocked:other"). The data: URL
// rewrite makes each slide self-contained so opacity does not matter.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function createDataUrls(entries: Map<string, Uint8Array>): Map<string, string> {
  const urls = new Map<string, string>();
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json' || /\.html?$/i.test(path)) {
      continue;
    }
    const type = getContentType(path);
    urls.set(path, `data:${type};base64,${bytesToBase64(bytes)}`);
  }
  return urls;
}

function computeTotalAssetBytes(entries: Map<string, Uint8Array>): number {
  let total = 0;
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;
    total += bytes.byteLength;
  }
  return total;
}

function validateManifestPaths(manifest: Manifest, entries: Map<string, Uint8Array>) {
  for (const slide of manifest.slides) {
    const file = normalizePackagePath(slide.file);
    const bytes = entries.get(file);
    if (!bytes) {
      throw new DeckLoadError('E_MISSING_SLIDE', `Slide file is missing: ${slide.file}`);
    }
    if (!/\.html?$/i.test(file)) {
      throw new DeckLoadError('E_BAD_MANIFEST', `Slide file must be HTML: ${slide.file}`);
    }
    if (bytes.byteLength > maxSlideHtmlBytes) {
      throw new DeckLoadError('E_TOO_LARGE', `Slide HTML exceeds the size limit: ${slide.file}`);
    }

    if (slide.thumbnail) {
      normalizePackagePath(slide.thumbnail);
    }
  }

  // Spec §3.11: when `offline.mirroredAssets[]` is present, every recorded
  // path must already exist in the package. A missing entry means the
  // mirror metadata is lying about what's bundled — treat it as a bad
  // manifest so the loader fails fast instead of silently 404-ing later.
  for (const asset of manifest.offline?.mirroredAssets ?? []) {
    const path = normalizePackagePath(asset.path);
    if (!entries.has(path)) {
      throw new DeckLoadError(
        'E_BAD_MANIFEST',
        `offline.mirroredAssets references missing path: ${asset.path}`,
      );
    }
  }
}

interface SlideContent {
  /** URL used by the iframe `src` attribute. */
  url: string;
  /** Inline HTML used by the iframe `srcdoc` attribute. */
  html: string;
  /** Rewritten HTML bytes, used when publishing the slide to the transport. */
  publishedBytes: Uint8Array | null;
}

function makeTextLookup(entries: Map<string, Uint8Array>) {
  return (assetPath: string) => {
    const assetBytes = entries.get(assetPath);
    if (!assetBytes || !/\.(css|svg|txt)$/i.test(assetPath)) {
      return null;
    }
    return decodeUtf8(assetBytes, assetPath);
  };
}

/**
 * Rewrite each slide HTML twice:
 *
 *  - With `data:` URLs everywhere (used by the `srcdoc` flavor, and as
 *    the body of the `blob:` fallback when no transport is present).
 *  - With the transport's virtual URLs (used as the body that the SW
 *    actually serves, so subresource fetches stay same-origin).
 *
 * When `virtualUrlFor` is null, we only emit the data: flavor and the
 * iframe `src` is a `blob:` URL pointing at the data-inlined HTML.
 */
function createSlideContents(
  manifest: Manifest,
  entries: Map<string, Uint8Array>,
  dataUrls: Map<string, string> | null,
  virtualUrlFor: ((path: string) => string) | null,
  objectUrls: string[],
  stripExternalLinks: boolean,
): SlideContent[] {
  const textLookup = makeTextLookup(entries);

  return manifest.slides.map((slide) => {
    const path = normalizePackagePath(slide.file);
    const bytes = entries.get(path);
    if (!bytes) {
      throw new DeckLoadError('E_MISSING_SLIDE', `Slide file is missing: ${slide.file}`);
    }

    const html = decodeUtf8(bytes, path);

    // srcdoc flavor: every package-internal subresource inlined as
    // data:. Self-contained so it works in opaque-origin iframes
    // regardless of how the iframe was loaded. External CSS links are
    // deferred (media="print" + onload swap) by rewriteHtmlAssetReferences,
    // so Google Fonts and other CDN stylesheets still load
    // asynchronously without blocking first paint. Only when
    // `stripExternalLinks` is true — Tauri WKWebView, which stalls
    // ~30s per unreachable external URL — do we drop them entirely.
    //
    // Skipped wholesale when `dataUrls` is null (the budget guard fired
    // and `inlineMode === 'auto'` told us the deck has to render via
    // the transport only). The base64 cost of the inline pass is what
    // crashes the renderer on huge CJK-mirror decks, so we MUST NOT
    // run it just to keep the field populated.
    const dataRewritten =
      dataUrls === null
        ? SRCDOC_DISABLED_PLACEHOLDER
        : (() => {
            const rewritten = rewriteHtmlAssetReferences(
              html,
              path,
              (assetPath) => dataUrls.get(assetPath) ?? null,
              textLookup,
            );
            return stripExternalLinks
              ? stripExternalLinkReferences(rewritten)
              : rewritten;
          })();

    if (!virtualUrlFor) {
      // No transport: iframe will navigate to a blob: of the
      // data-inlined HTML. Modern Chrome allows that initial navigation
      // even from a sandboxed iframe; subresources are data: so storage
      // partitioning never bites. Reachable only when dataUrls !== null
      // — the loader rejects `inlineMode: 'auto'` + oversized + no
      // transport up front (E_TOO_LARGE_FOR_INLINE).
      const blobUrl = URL.createObjectURL(
        new Blob([dataRewritten], { type: 'text/html;charset=utf-8' }),
      );
      objectUrls.push(blobUrl);
      return { url: blobUrl, html: dataRewritten, publishedBytes: null };
    }

    // Transport (Service Worker) is available: rewrite asset references
    // as virtual URLs so the SW can serve them as same-origin assets.
    // Keep the data-inlined HTML around too for the srcdoc fallback on
    // hosts that turn the SW off later. When dataRewritten is the
    // placeholder we still emit the virtual-URL flavour for the
    // transport — that is the *only* renderable copy of the slide.
    const virtualRewritten = rewriteHtmlAssetReferences(
      html,
      path,
      (assetPath) => virtualUrlFor(assetPath) ?? null,
      textLookup,
    );

    return {
      url: virtualUrlFor(path),
      html: dataRewritten,
      publishedBytes: textEncoder.encode(virtualRewritten),
    };
  });
}

function createThumbnailUrls(
  manifest: Manifest,
  virtualUrlFor: ((path: string) => string) | null,
  dataUrls: Map<string, string> | null,
): Array<string | null> {
  return manifest.slides.map((slide) => {
    if (!slide.thumbnail) return null;
    try {
      const path = normalizePackagePath(slide.thumbnail);
      if (virtualUrlFor) {
        return virtualUrlFor(path) ?? null;
      }
      return dataUrls?.get(path) ?? null;
    } catch {
      return null;
    }
  });
}

const textEncoder = new TextEncoder();

function deckIdFromFingerprint(fingerprint: string): string {
  // 16 hex chars = 64 bits of entropy. Collision probability is
  // negligible for the number of decks a single SPA tab will ever
  // host concurrently. We deliberately do not URL-encode this here;
  // the transport handles encoding when building virtual URLs.
  const trimmed = fingerprint.replace(/[^a-f0-9]/gi, '');
  return trimmed.slice(0, 16) || fingerprint;
}

function collectPublishAssets(
  manifest: Manifest,
  entries: Map<string, Uint8Array>,
  slideContents: SlideContent[],
): StageAsset[] {
  const slidePaths = new Map<string, number>();
  manifest.slides.forEach((slide, idx) => {
    slidePaths.set(normalizePackagePath(slide.file), idx);
  });

  const assets: StageAsset[] = [];
  for (const [path, bytes] of entries) {
    if (path === 'manifest.json') continue;

    const slideIdx = slidePaths.get(path);
    if (slideIdx !== undefined) {
      // Slide HTML is published in its *rewritten* form so subresources
      // point at the transport's URLs, not the raw author-supplied refs.
      const rewritten = slideContents[slideIdx].publishedBytes;
      if (!rewritten) continue;
      assets.push({
        path,
        type: 'text/html;charset=utf-8',
        bytes: rewritten,
      });
      continue;
    }

    assets.push({
      path,
      type: getContentType(path),
      bytes,
    });
  }
  return assets;
}

export async function loadDeck(
  file: File,
  options: LoadDeckOptions = {},
): Promise<LoadedDeck> {
  if (file.size > maxPackageBytes) {
    throw new DeckLoadError('E_TOO_LARGE', 'Deck exceeds the package size limit.');
  }

  const transport = options.transport ?? null;
  const stripExternalLinks = options.stripExternalLinks ?? false;
  const inlineMode = options.inlineMode ?? 'always';
  const inlineBudgetBytes = options.inlineBudgetBytes ?? DEFAULT_INLINE_BUDGET_BYTES;
  const bytes = new Uint8Array(await file.arrayBuffer());

  let rawEntries: Record<string, Uint8Array>;
  try {
    // Budget-aware unzip: reject decompression bombs *before* materializing
    // entries, rather than via the post-hoc size check in `normalizeEntries`.
    rawEntries = safeUnzipSync(bytes, {
      maxEntryBytes,
      maxTotalBytes: maxDecompressedBytes,
    });
  } catch (error) {
    // A tripped budget is a real, actionable error — surface it instead of
    // masking it as a generic "not a zip" failure.
    if (error instanceof DeckLoadError) {
      throw error;
    }
    throw new DeckLoadError('E_NOT_ZIP', 'The selected file is not a readable .stage ZIP.');
  }

  const entries = normalizeEntries(rawEntries);
  const manifest = readManifest(entries);
  validateManifestPaths(manifest, entries);

  const totalAssetBytes = computeTotalAssetBytes(entries);

  // Inline-data-URL decision. The base64 inline pass dominates load
  // time and renderer memory for any deck > a few MB; for huge
  // CJK-mirror decks it is what crashes the tab. The Tauri build still
  // uses `'always'` because it has no Service Worker transport — the
  // inline flavour is the only renderable copy there. The Web build
  // sends `'auto'`, which falls back to "transport-only" once the
  // budget is exceeded.
  const inlineRequested =
    inlineMode === 'always' ||
    (inlineMode === 'auto' && totalAssetBytes <= inlineBudgetBytes);
  if (!inlineRequested && !transport) {
    throw new DeckLoadError(
      'E_TOO_LARGE_FOR_INLINE',
      `Deck size (${totalAssetBytes} bytes) exceeds the inline budget ` +
        `(${inlineBudgetBytes} bytes) and no asset transport is available in ` +
        `this environment. Open the deck in a browser that supports ` +
        `Service Workers, or split it into a smaller package.`,
    );
  }
  const inlinedHtmlAvailable = inlineRequested;

  const fingerprint = await fingerprintBytes(bytes);
  const deckId = deckIdFromFingerprint(fingerprint);

  const objectUrls: string[] = [];

  try {
    const dataUrls = inlinedHtmlAvailable ? createDataUrls(entries) : null;
    const virtualUrlFor = transport
      ? (path: string) => transport.virtualUrlFor(deckId, path)
      : null;

    const slideContents = createSlideContents(
      manifest,
      entries,
      dataUrls,
      virtualUrlFor,
      objectUrls,
      stripExternalLinks,
    );

    if (transport) {
      const publishAssets = collectPublishAssets(manifest, entries, slideContents);
      try {
        await transport.publishDeck(deckId, publishAssets);
      } catch (error) {
        // Publish failure means the iframe cannot reach asset URLs; fall
        // through to the caller so it can surface the error rather than
        // silently rendering a broken deck.
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        throw new DeckLoadError(
          'E_TRANSPORT_PUBLISH_FAILED',
          `Failed to publish deck assets: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const slideUrls = slideContents.map((c) => c.url);
    const slideHtml = slideContents.map((c) => c.html);
    const thumbnailUrls = createThumbnailUrls(manifest, virtualUrlFor, dataUrls);

    return {
      fileName: file.name,
      fingerprint,
      deckId,
      manifest,
      slideUrls,
      slideHtml,
      inlinedHtmlAvailable,
      totalAssetBytes,
      thumbnailUrls,
      // `prefersSrcdoc` only means "the host cannot offer virtual
      // URLs at all" (Tauri, file://, SW registration failed, or no
      // transport supplied). When it is true the viewer MUST use
      // srcdoc; when it is false the viewer still gets to choose
      // per-iframe — sandboxed iframes (no `allow-same-origin`) are
      // opaque-origin clients which Chrome won't route through the
      // service worker, so the viewer falls back to srcdoc anyway and
      // only switches to `src={virtualUrl}` once a trust grant
      // elevates the iframe to same-origin.
      //
      // Forced to `false` when `inlinedHtmlAvailable === false`: the
      // srcdoc copy is a placeholder; insisting on srcdoc would paint
      // an empty slide. The caller MUST mount the iframe with
      // `allow-same-origin` (via auto-elevation) so the transport is
      // consulted instead.
      prefersSrcdoc: !transport && inlinedHtmlAvailable,
      revoke: () => {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        if (transport) {
          // Fire-and-forget: unpublish errors should never break tear-down.
          Promise.resolve(transport.unpublishDeck(deckId)).catch(() => {
            // intentionally swallowed
          });
        }
      },
    };
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
