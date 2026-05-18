import { unzipSync } from 'fflate';
import { ZodError } from 'zod';
import { parseManifest } from './manifestSchema';
import { normalizePackagePath } from './pathSafety';
import { rewriteHtmlAssetReferences, stripExternalLinkReferences } from './rewriteHtml';
import { DeckLoadError, type LoadedDeck, type Manifest } from './types';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const maxPackageBytes = 200 * 1024 * 1024;
const maxDecompressedBytes = 1024 * 1024 * 1024;
const maxEntryBytes = 100 * 1024 * 1024;
const maxManifestBytes = 5 * 1024 * 1024;
const maxSlideHtmlBytes = 5 * 1024 * 1024;

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
  [/\.woff2?$/i, 'font/woff2'],
  [/\.mp4$/i, 'video/mp4'],
  [/\.mp3$/i, 'audio/mpeg'],
];

function getContentType(path: string): string {
  return contentTypes.find(([pattern]) => pattern.test(path))?.[1] ?? 'application/octet-stream';
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer as ArrayBuffer], { type });
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
      throw new DeckLoadError('E_BAD_MANIFEST', 'manifest.json does not match hcslides@1.0.');
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

function createRawUrls(entries: Map<string, Uint8Array>, objectUrls: string[]): Map<string, string> {
  const urls = new Map<string, string>();

  for (const [path, bytes] of entries) {
    if (path === 'manifest.json' || /\.html?$/i.test(path)) {
      continue;
    }

    const url = URL.createObjectURL(blobFromBytes(bytes, getContentType(path)));
    objectUrls.push(url);
    urls.set(path, url);
  }

  return urls;
}

// `data:` URLs are inlined into the slide HTML and used by the iframe
// `srcdoc` flavor (DeckStage in Tauri). Reason: an iframe rendered via
// `srcdoc` has the opaque `null` origin and cannot read `blob:` URLs that
// belong to the parent window's origin. Switching internal references to
// `data:` URLs sidesteps the cross-origin block entirely. Web builds keep
// using the cheaper blob: flavour above.
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
  url: string;
  html: string;
}

function createSlideContents(
  manifest: Manifest,
  entries: Map<string, Uint8Array>,
  blobUrls: Map<string, string>,
  dataUrls: Map<string, string>,
  objectUrls: string[],
): SlideContent[] {
  const textLookup = (assetPath: string) => {
    const assetBytes = entries.get(assetPath);
    if (!assetBytes || !/\.(css|svg|txt)$/i.test(assetPath)) {
      return null;
    }
    return decodeUtf8(assetBytes, assetPath);
  };

  return manifest.slides.map((slide) => {
    const path = normalizePackagePath(slide.file);
    const bytes = entries.get(path);
    if (!bytes) {
      throw new DeckLoadError('E_MISSING_SLIDE', `Slide file is missing: ${slide.file}`);
    }

    const html = decodeUtf8(bytes, path);

    // Web flavour: src=blob:URL. Cheap and streamable; matches the
    // pre-Tauri behaviour and powers DeckStage's src= path.
    const blobRewritten = rewriteHtmlAssetReferences(
      html,
      path,
      (assetPath) => blobUrls.get(assetPath) ?? null,
      textLookup,
    );
    const url = URL.createObjectURL(new Blob([blobRewritten], { type: 'text/html;charset=utf-8' }));
    objectUrls.push(url);

    // Desktop flavour: srcdoc with internal refs swapped to data: URLs so
    // the null-origin iframe can still load images/css/fonts without
    // tripping over the cross-origin blob: restriction. We also drop any
    // external CDN <link> tags — when the host can't reach them (think
    // fonts.googleapis from a firewalled network), the TLS timeout keeps
    // the iframe half-painted for tens of seconds.
    const inlineRewritten = stripExternalLinkReferences(
      rewriteHtmlAssetReferences(
        html,
        path,
        (assetPath) => dataUrls.get(assetPath) ?? null,
        textLookup,
      ),
    );

    return { url, html: inlineRewritten };
  });
}

function createThumbnailUrls(manifest: Manifest, rawUrls: Map<string, string>): Array<string | null> {
  return manifest.slides.map((slide) => {
    if (!slide.thumbnail) {
      return null;
    }

    try {
      return rawUrls.get(normalizePackagePath(slide.thumbnail)) ?? null;
    } catch {
      return null;
    }
  });
}

export async function loadDeck(file: File): Promise<LoadedDeck> {
  if (file.size > maxPackageBytes) {
    throw new DeckLoadError('E_TOO_LARGE', 'Deck exceeds the package size limit.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let rawEntries: Record<string, Uint8Array>;
  try {
    rawEntries = unzipSync(bytes);
  } catch {
    throw new DeckLoadError('E_NOT_ZIP', 'The selected file is not a readable .hcslides ZIP.');
  }

  const entries = normalizeEntries(rawEntries);
  const manifest = readManifest(entries);
  validateManifestPaths(manifest, entries);

  const objectUrls: string[] = [];

  try {
    const rawUrls = createRawUrls(entries, objectUrls);
    const dataUrls = createDataUrls(entries);
    const slideContents = createSlideContents(manifest, entries, rawUrls, dataUrls, objectUrls);
    const slideUrls = slideContents.map((c) => c.url);
    const slideHtml = slideContents.map((c) => c.html);
    const thumbnailUrls = createThumbnailUrls(manifest, rawUrls);
    const fingerprint = await fingerprintBytes(bytes);

    return {
      fileName: file.name,
      fingerprint,
      manifest,
      slideUrls,
      slideHtml,
      thumbnailUrls,
      revoke: () => {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
      },
    };
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
