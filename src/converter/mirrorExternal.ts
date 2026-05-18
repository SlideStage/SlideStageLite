/**
 * Offline mirror pass for `.hcslides` decks.
 *
 * The pass walks every slide HTML (and the CSS it references) for external
 * resource URLs that match the configured policy, downloads what is in
 * scope, persists the bytes under `assets/_mirror/...`, and rewrites the
 * slide / CSS bytes **in place** to point at the local copies (strategy 1A
 * from the design discussion: static rewrite, no runtime mapping layer).
 *
 * After a successful pass `manifest.offline.ready === true` and the deck
 * loads with zero external network requests for any in-scope resource.
 *
 * The module deliberately does *not* call `fetch` directly: the caller
 * supplies a {@link MirrorFetcher} so that the browser GUI, the CLI script,
 * and unit tests can each plug in their own transport. Everything else is a
 * pure function over the input entries + manifest.
 */

import type {
  Manifest,
  ManifestOffline,
  ManifestOfflineMirroredAsset,
  ManifestOfflinePolicy,
  ManifestOfflineSkippedReason,
  ManifestOfflineSkippedUrl,
} from '../deck/types';
import { normalizePackagePath } from '../deck/pathSafety';

/* ----------------------------------------------------------------------- */
/*  Public types                                                            */
/* ----------------------------------------------------------------------- */

export interface MirrorFetchSuccess {
  ok: true;
  bytes: Uint8Array;
  contentType: string;
  /** Useful for diagnostics; defaults to the requested URL when not set. */
  finalUrl?: string;
}

export interface MirrorFetchFailure {
  ok: false;
  reason: ManifestOfflineSkippedReason;
  detail?: string;
}

export type MirrorFetchResult = MirrorFetchSuccess | MirrorFetchFailure;

export type MirrorFetcher = (url: string) => Promise<MirrorFetchResult>;

export interface MirrorPolicy {
  /** Default `false`: do not mirror `<script src>` for safety. */
  includeScripts?: boolean;
  /** Default `false`: do not mirror `<iframe src>` either. */
  includeIframes?: boolean;
  /** Default 50 MB. URLs larger than this become `too-large` skips. */
  maxAssetBytes?: number;
  /** Default 500 MB. Once exceeded the pass starts emitting `budget-exhausted`. */
  maxTotalBytes?: number;
  /** When set, only URLs whose host suffix-matches an entry are fetched. */
  allowedHosts?: readonly string[];
  /** Host suffixes to skip outright (returns `blocked-by-policy`). */
  blockedHosts?: readonly string[];
}

export interface MirrorProgress {
  phase: 'scan' | 'fetch' | 'rewrite';
  queued: number;
  done: number;
  bytesDownloaded: number;
  currentUrl?: string;
}

export interface MirrorOptions {
  fetcher: MirrorFetcher;
  policy?: MirrorPolicy;
  /** Recorded into `offline.mirrorTool`. */
  toolName?: string;
  toolVersion?: string;
  /** Optional progress sink (GUI). */
  onProgress?: (progress: MirrorProgress) => void;
  /** Override the `mirroredAt` timestamp; useful for deterministic tests. */
  now?: () => Date;
  /** Optional digest implementation. Defaults to `crypto.subtle.digest`. */
  sha256?: (bytes: Uint8Array) => Promise<Uint8Array>;
}

export interface MirrorResult {
  entries: Map<string, Uint8Array>;
  manifest: Manifest;
  offline: ManifestOffline;
  /** Convenience aggregate counters; mirrors `offline.*.length`. */
  stats: { mirrored: number; skipped: number; bytesDownloaded: number };
}

/* ----------------------------------------------------------------------- */
/*  Constants                                                               */
/* ----------------------------------------------------------------------- */

export const DEFAULT_MIRROR_POLICY: Required<
  Pick<MirrorPolicy, 'includeScripts' | 'includeIframes' | 'maxAssetBytes' | 'maxTotalBytes'>
> = {
  includeScripts: false,
  includeIframes: false,
  maxAssetBytes: 50 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
};

export const MIRROR_TOOL_NAME = 'hcslides-mirror';
export const MIRROR_TOOL_VERSION = '0.1.0';
const MIRROR_DIR = 'assets/_mirror';

/* ----------------------------------------------------------------------- */
/*  Patterns                                                                */
/* ----------------------------------------------------------------------- */

const attrPattern = /\b(src|href|poster)=("([^"]*)"|'([^']*)')/gi;
const srcsetPattern = /\bsrcset=("([^"]*)"|'([^']*)')/gi;
const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;
const cssImportStringPattern = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const linkTagPattern = /<link\b[^>]*>/gi;
const scriptTagPattern = /<script\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
const iframeTagPattern = /<iframe\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
const preconnectPattern = /<link\b[^>]*\brel\s*=\s*("(?:preconnect|dns-prefetch)"|'(?:preconnect|dns-prefetch)')[^>]*>/gi;
const externalUrlPattern = /^https?:\/\//i;
const protocolRelativePattern = /^\/\//;
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

/* ----------------------------------------------------------------------- */
/*  URL normalization + classification                                      */
/* ----------------------------------------------------------------------- */

function isExternal(value: string): boolean {
  if (!value) return false;
  if (externalUrlPattern.test(value)) return true;
  if (protocolRelativePattern.test(value)) return true;
  return false;
}

function absolutize(value: string): string | null {
  if (externalUrlPattern.test(value)) return value;
  if (protocolRelativePattern.test(value)) return `https:${value}`;
  return null;
}

function getAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match?.[2] ?? match?.[3] ?? null;
}

function getRelTokens(tag: string): string[] {
  const rel = getAttribute(tag, 'rel');
  if (!rel) return [];
  return rel.toLowerCase().split(/\s+/).filter(Boolean);
}

function isStylesheetLink(tag: string): boolean {
  return getRelTokens(tag).includes('stylesheet');
}

function hostSuffixMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  const s = suffix.toLowerCase().replace(/^\./, '');
  return h === s || h.endsWith(`.${s}`);
}

function classifyHost(
  url: string,
  policy: MirrorPolicy,
): { ok: true } | { ok: false; reason: ManifestOfflineSkippedReason; detail?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'unsupported-scheme', detail: 'invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-scheme', detail: parsed.protocol };
  }
  if (policy.blockedHosts?.some((s) => hostSuffixMatches(parsed.host, s))) {
    return { ok: false, reason: 'blocked-by-policy', detail: `host ${parsed.host} blocked` };
  }
  if (policy.allowedHosts && policy.allowedHosts.length > 0) {
    const ok = policy.allowedHosts.some((s) => hostSuffixMatches(parsed.host, s));
    if (!ok) return { ok: false, reason: 'blocked-by-policy', detail: `host ${parsed.host} not in allowedHosts` };
  }
  return { ok: true };
}

/* ----------------------------------------------------------------------- */
/*  Reference extraction                                                    */
/* ----------------------------------------------------------------------- */

interface ExtractedRef {
  url: string;
  /** Either 'html-attr' | 'srcset' | 'css-url' | 'css-import' | 'script-src'
   *  | 'iframe-src'. Drives category guessing when content-type is missing. */
  kind: ExtractedRefKind;
}

type ExtractedRefKind =
  | 'html-attr'
  | 'srcset'
  | 'css-url'
  | 'css-import'
  | 'script-src'
  | 'iframe-src'
  | 'stylesheet'
  | 'font-preload';

function pushExternal(out: ExtractedRef[], raw: string | null | undefined, kind: ExtractedRefKind): void {
  if (!raw) return;
  const trimmed = raw.trim();
  if (!isExternal(trimmed)) return;
  const abs = absolutize(trimmed);
  if (!abs) return;
  out.push({ url: abs, kind });
}

export function extractExternalRefsFromHtml(html: string, policy: MirrorPolicy): ExtractedRef[] {
  const out: ExtractedRef[] = [];

  // <link rel="stylesheet" href="..."> and <link rel="preload" as="font" href="...">
  for (const match of html.matchAll(linkTagPattern)) {
    const tag = match[0];
    const href = getAttribute(tag, 'href');
    if (!href) continue;
    const rels = getRelTokens(tag);
    if (rels.includes('stylesheet')) {
      pushExternal(out, href, 'stylesheet');
      continue;
    }
    if (rels.includes('preload') && (getAttribute(tag, 'as')?.toLowerCase() ?? '') === 'font') {
      pushExternal(out, href, 'font-preload');
      continue;
    }
    // preconnect/dns-prefetch handled by the stripper at rewrite time.
    if (rels.includes('preconnect') || rels.includes('dns-prefetch')) continue;
    // Other rel values: still mirror the href so things like `rel="icon"` work.
    pushExternal(out, href, 'html-attr');
  }

  // The generic src/href/poster pass below would otherwise re-capture
  // attributes living inside `<link>`, `<script>`, and `<iframe>` tags —
  // which we want to gate explicitly by policy or rel-tag semantics — so
  // we strip them from the scan input first. The dedicated loops above and
  // below remain the canonical source for those URLs.
  const htmlForAttrScan = html
    .replace(linkTagPattern, '')
    .replace(scriptTagPattern, '')
    .replace(iframeTagPattern, '');
  for (const match of htmlForAttrScan.matchAll(attrPattern)) {
    const value = match[3] ?? match[4] ?? '';
    pushExternal(out, value, 'html-attr');
  }

  // srcset (still scanned from the raw html — `<img>` was not stripped).
  for (const match of html.matchAll(srcsetPattern)) {
    const value = match[2] ?? match[3] ?? '';
    for (const candidate of value.split(',')) {
      const ref = candidate.trim().split(/\s+/)[0];
      pushExternal(out, ref, 'srcset');
    }
  }

  if (policy.includeScripts) {
    for (const match of html.matchAll(scriptTagPattern)) {
      pushExternal(out, match[2] ?? match[3] ?? '', 'script-src');
    }
  }

  if (policy.includeIframes) {
    for (const match of html.matchAll(iframeTagPattern)) {
      pushExternal(out, match[2] ?? match[3] ?? '', 'iframe-src');
    }
  }

  // CSS url(...) inside inline <style> blocks: walk anything that looks
  // like a CSS body. We just run the CSS patterns over the whole HTML
  // string — the attribute / link loops above already captured everything
  // that isn't CSS, and `url()` outside CSS is exceedingly rare. Anything
  // we over-collect is harmless (it just becomes a no-op when rewriting
  // and adds one fetch).
  for (const ref of extractExternalRefsFromCss(html)) out.push(ref);

  return out;
}

export function extractExternalRefsFromCss(css: string): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  for (const match of css.matchAll(cssUrlPattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    pushExternal(out, value, 'css-url');
  }
  for (const match of css.matchAll(cssImportStringPattern)) {
    const value = (match[1] ?? match[2] ?? '').trim();
    pushExternal(out, value, 'css-import');
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/*  Mirror plan                                                             */
/* ----------------------------------------------------------------------- */

interface PendingRef {
  url: string;
  kinds: Set<ExtractedRefKind>;
  /** 1-based slide indices that reference this URL transitively. */
  slides: Set<number>;
}

function mergeRef(map: Map<string, PendingRef>, url: string, kind: ExtractedRefKind, slideIdx: number | null): void {
  let entry = map.get(url);
  if (!entry) {
    entry = { url, kinds: new Set(), slides: new Set() };
    map.set(url, entry);
  }
  entry.kinds.add(kind);
  if (slideIdx !== null) entry.slides.add(slideIdx);
}

function planSlides(
  manifest: Manifest,
  entries: Map<string, Uint8Array>,
  policy: MirrorPolicy,
): Map<string, PendingRef> {
  const plan = new Map<string, PendingRef>();
  for (const slide of manifest.slides) {
    const slidePath = normalizePackagePath(slide.file);
    const slideBytes = entries.get(slidePath);
    if (!slideBytes) continue;
    const html = utf8Decoder.decode(slideBytes);
    for (const ref of extractExternalRefsFromHtml(html, policy)) {
      mergeRef(plan, ref.url, ref.kind, slide.index);
    }
  }
  // Also scan any package CSS files for url()/@import — these are reachable
  // via slide HTML but may already be local CSS that links out further.
  for (const [path, bytes] of entries) {
    if (!/\.css$/i.test(path)) continue;
    const css = utf8Decoder.decode(bytes);
    for (const ref of extractExternalRefsFromCss(css)) {
      mergeRef(plan, ref.url, ref.kind, null);
    }
  }
  return plan;
}

/* ----------------------------------------------------------------------- */
/*  Category + extension + path                                             */
/* ----------------------------------------------------------------------- */

type MirrorCategory = 'css' | 'font' | 'img' | 'video' | 'audio' | 'script' | 'other';
type AssetType = 'image' | 'font' | 'style' | 'script' | 'audio' | 'video' | 'other';

const extByType: Array<[RegExp, string]> = [
  [/^text\/css\b/i, 'css'],
  [/^application\/javascript\b|^text\/javascript\b/i, 'js'],
  [/^font\/woff2\b/i, 'woff2'],
  [/^font\/woff\b/i, 'woff'],
  [/^font\/ttf\b|^application\/font-sfnt\b/i, 'ttf'],
  [/^font\/otf\b/i, 'otf'],
  [/^image\/svg\+xml\b/i, 'svg'],
  [/^image\/png\b/i, 'png'],
  [/^image\/jpe?g\b/i, 'jpg'],
  [/^image\/gif\b/i, 'gif'],
  [/^image\/webp\b/i, 'webp'],
  [/^image\/avif\b/i, 'avif'],
  [/^video\/mp4\b/i, 'mp4'],
  [/^video\/webm\b/i, 'webm'],
  [/^audio\/mpeg\b/i, 'mp3'],
  [/^audio\/wav\b/i, 'wav'],
];

const extByUrlSuffix: Array<[RegExp, string]> = [
  [/\.css(?:\?|$)/i, 'css'],
  [/\.js(?:\?|$)/i, 'js'],
  [/\.woff2(?:\?|$)/i, 'woff2'],
  [/\.woff(?:\?|$)/i, 'woff'],
  [/\.ttf(?:\?|$)/i, 'ttf'],
  [/\.otf(?:\?|$)/i, 'otf'],
  [/\.svg(?:\?|$)/i, 'svg'],
  [/\.png(?:\?|$)/i, 'png'],
  [/\.jpe?g(?:\?|$)/i, 'jpg'],
  [/\.gif(?:\?|$)/i, 'gif'],
  [/\.webp(?:\?|$)/i, 'webp'],
  [/\.avif(?:\?|$)/i, 'avif'],
  [/\.mp4(?:\?|$)/i, 'mp4'],
  [/\.webm(?:\?|$)/i, 'webm'],
  [/\.mp3(?:\?|$)/i, 'mp3'],
  [/\.wav(?:\?|$)/i, 'wav'],
];

function pickExtension(url: string, contentType: string): string {
  for (const [pat, ext] of extByType) if (pat.test(contentType)) return ext;
  for (const [pat, ext] of extByUrlSuffix) if (pat.test(url)) return ext;
  return 'bin';
}

function categoryFor(ext: string, kinds: ReadonlySet<ExtractedRefKind>): MirrorCategory {
  if (ext === 'css') return 'css';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
  if (['png', 'jpg', 'gif', 'webp', 'avif', 'svg'].includes(ext)) return 'img';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav'].includes(ext)) return 'audio';
  if (ext === 'js' || kinds.has('script-src')) return 'script';
  return 'other';
}

function assetTypeFor(category: MirrorCategory): AssetType {
  switch (category) {
    case 'css':
      return 'style';
    case 'font':
      return 'font';
    case 'img':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'script':
      return 'script';
    default:
      return 'other';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function defaultSha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(digest);
}

/* ----------------------------------------------------------------------- */
/*  Rewriting                                                               */
/* ----------------------------------------------------------------------- */

function stripPreconnectTags(html: string): string {
  return html.replace(preconnectPattern, '');
}

function rewriteHtmlBody(html: string, urlMap: Map<string, string>): string {
  if (urlMap.size === 0) return stripPreconnectTags(html);
  let out = html;

  // Attributes: src / href / poster
  out = out.replace(attrPattern, (match, attr: string, quoted: string, doubleValue?: string, singleValue?: string) => {
    const quote = quoted.startsWith('"') ? '"' : "'";
    const value = (doubleValue ?? singleValue ?? '').trim();
    const local = lookupLocal(urlMap, value);
    if (!local) return match;
    return `${attr}=${quote}${local}${quote}`;
  });

  // srcset
  out = out.replace(srcsetPattern, (_match, quoted: string, doubleValue?: string, singleValue?: string) => {
    const quote = quoted.startsWith('"') ? '"' : "'";
    const value = (doubleValue ?? singleValue ?? '').trim();
    const rewritten = value
      .split(',')
      .map((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        if (!parts[0]) return candidate;
        const local = lookupLocal(urlMap, parts[0]);
        return [local ?? parts[0], ...parts.slice(1)].join(' ');
      })
      .join(', ');
    return `srcset=${quote}${rewritten}${quote}`;
  });

  // CSS url() and @import inside any <style> blocks (and as a safety net,
  // everywhere — the regex pattern only matches inside CSS-shaped text).
  out = rewriteCssBody(out, urlMap);

  return stripPreconnectTags(out);
}

function rewriteCssBody(css: string, urlMap: Map<string, string>): string {
  const afterUrls = css.replace(
    cssUrlPattern,
    (match, doubleValue?: string, singleValue?: string, bareValue?: string) => {
      const value = (doubleValue ?? singleValue ?? bareValue ?? '').trim();
      const local = lookupLocal(urlMap, value);
      if (!local) return match;
      return `url("${local}")`;
    },
  );
  return afterUrls.replace(
    cssImportStringPattern,
    (match, doubleValue?: string, singleValue?: string) => {
      const value = (doubleValue ?? singleValue ?? '').trim();
      const local = lookupLocal(urlMap, value);
      if (!local) return match;
      return `@import "${local}"`;
    },
  );
}

function lookupLocal(urlMap: Map<string, string>, raw: string): string | null {
  const trimmed = raw.trim();
  if (!isExternal(trimmed)) return null;
  const abs = absolutize(trimmed);
  if (!abs) return null;
  return urlMap.get(abs) ?? null;
}

/* ----------------------------------------------------------------------- */
/*  Path computation: target package path for a mirrored asset             */
/* ----------------------------------------------------------------------- */

function relativeFromSlide(slidePath: string, assetPath: string): string {
  const slideParts = slidePath.split('/').slice(0, -1);
  const targetParts = assetPath.split('/');
  let common = 0;
  while (
    common < slideParts.length &&
    common < targetParts.length - 1 &&
    slideParts[common] === targetParts[common]
  ) {
    common += 1;
  }
  const ups = slideParts.length - common;
  const rest = targetParts.slice(common);
  const out = [...Array.from({ length: ups }, () => '..'), ...rest].join('/');
  return out || assetPath;
}

/* ----------------------------------------------------------------------- */
/*  The actual pass                                                         */
/* ----------------------------------------------------------------------- */

function resolvePolicy(policy?: MirrorPolicy): ManifestOfflinePolicy {
  return {
    includeScripts: policy?.includeScripts ?? DEFAULT_MIRROR_POLICY.includeScripts,
    includeIframes: policy?.includeIframes ?? DEFAULT_MIRROR_POLICY.includeIframes,
    maxAssetBytes: policy?.maxAssetBytes ?? DEFAULT_MIRROR_POLICY.maxAssetBytes,
    maxTotalBytes: policy?.maxTotalBytes ?? DEFAULT_MIRROR_POLICY.maxTotalBytes,
    ...(policy?.allowedHosts ? { allowedHosts: Array.from(policy.allowedHosts) } : {}),
    ...(policy?.blockedHosts ? { blockedHosts: Array.from(policy.blockedHosts) } : {}),
  };
}

/**
 * Run the mirror pass against an in-memory deck. The caller is responsible
 * for sourcing the entries (from `loadDeck`, the converter pipeline, or a
 * fresh unzip) and for writing the rewritten manifest + entries back to
 * disk afterwards.
 */
export async function mirrorExternalAssets(
  input: { entries: Map<string, Uint8Array>; manifest: Manifest },
  options: MirrorOptions,
): Promise<MirrorResult> {
  const policySnapshot = resolvePolicy(options.policy);
  const now = options.now ? options.now() : new Date();
  const sha256 = options.sha256 ?? defaultSha256;
  const toolName = options.toolName ?? MIRROR_TOOL_NAME;
  const toolVersion = options.toolVersion ?? MIRROR_TOOL_VERSION;

  // Work on a defensive copy of entries — never mutate the caller's map.
  const entries = new Map<string, Uint8Array>(input.entries);

  options.onProgress?.({ phase: 'scan', queued: 0, done: 0, bytesDownloaded: 0 });
  const plan = planSlides(input.manifest, entries, policySnapshot);

  const mirroredAssets: ManifestOfflineMirroredAsset[] = [];
  const skippedUrls: ManifestOfflineSkippedUrl[] = [];
  const urlToLocalAbsPath = new Map<string, string>();
  const hashToPath = new Map<string, string>();
  let bytesDownloaded = 0;
  let done = 0;
  const queued = plan.size;

  const pending: Array<{ url: string; ref: PendingRef }> = Array.from(plan.entries(), ([url, ref]) => ({ url, ref }));

  // Sequential fetch keeps the API tiny (no per-host concurrency limits to
  // tune). Real-world deck mirror sizes top out at a few dozen URLs so this
  // is fine in practice; callers needing parallelism can wrap the fetcher.
  while (pending.length > 0) {
    const job = pending.shift()!;
    const { url, ref } = job;
    options.onProgress?.({
      phase: 'fetch',
      queued,
      done,
      bytesDownloaded,
      currentUrl: url,
    });

    const classification = classifyHost(url, policySnapshot);
    if (!classification.ok) {
      skippedUrls.push({ url, reason: classification.reason, detail: classification.detail });
      done += 1;
      continue;
    }

    if (bytesDownloaded >= policySnapshot.maxTotalBytes) {
      skippedUrls.push({
        url,
        reason: 'budget-exhausted',
        detail: `total mirror budget ${policySnapshot.maxTotalBytes} bytes hit before this URL`,
      });
      done += 1;
      continue;
    }

    let result: MirrorFetchResult;
    try {
      result = await options.fetcher(url);
    } catch (error) {
      result = {
        ok: false,
        reason: 'unreachable',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (!result.ok) {
      skippedUrls.push({ url, reason: result.reason, detail: result.detail });
      done += 1;
      continue;
    }

    if (result.bytes.byteLength > policySnapshot.maxAssetBytes) {
      skippedUrls.push({
        url,
        reason: 'too-large',
        detail: `${result.bytes.byteLength} > ${policySnapshot.maxAssetBytes}`,
      });
      done += 1;
      continue;
    }
    if (bytesDownloaded + result.bytes.byteLength > policySnapshot.maxTotalBytes) {
      skippedUrls.push({
        url,
        reason: 'budget-exhausted',
        detail: `would exceed total budget of ${policySnapshot.maxTotalBytes} bytes`,
      });
      done += 1;
      continue;
    }

    const digestBytes = await sha256(result.bytes);
    const hex = bytesToHex(digestBytes);
    const contentHash = `sha256-${hex}`;
    const ext = pickExtension(url, result.contentType);
    const category = categoryFor(ext, ref.kinds);
    const shortHash = hex.slice(0, 16);

    let assetPath: string;
    const dedup = hashToPath.get(contentHash);
    if (dedup) {
      assetPath = dedup;
    } else {
      assetPath = `${MIRROR_DIR}/${category}/${shortHash}.${ext}`;
      hashToPath.set(contentHash, assetPath);
      entries.set(assetPath, result.bytes);
    }

    // For CSS bodies we also need to walk the inline url()/@import refs,
    // because rewriting the parent <link rel="stylesheet" href> alone
    // won't bring in the woff2 files it references. The fetched CSS bytes
    // get rewritten *after* its children land in `urlToLocalAbsPath`, so
    // we queue them here and overwrite the CSS bytes at the rewrite phase.
    if (category === 'css') {
      const cssText = utf8Decoder.decode(result.bytes);
      for (const childRef of extractExternalRefsFromCss(cssText)) {
        if (!plan.has(childRef.url) && !pending.some((j) => j.url === childRef.url)) {
          plan.set(childRef.url, { url: childRef.url, kinds: new Set([childRef.kind]), slides: new Set() });
          pending.push({ url: childRef.url, ref: plan.get(childRef.url)! });
        }
      }
    }

    bytesDownloaded += result.bytes.byteLength;
    urlToLocalAbsPath.set(url, assetPath);

    mirroredAssets.push({
      originalUrl: url,
      path: assetPath,
      contentHash,
      contentType: result.contentType,
      bytes: result.bytes.byteLength,
      fetchedAt: now.toISOString(),
      referencedBy: Array.from(ref.slides).sort((a, b) => a - b),
    });
    done += 1;
  }

  // ── Rewrite phase ─────────────────────────────────────────────────────
  options.onProgress?.({ phase: 'rewrite', queued, done, bytesDownloaded });

  // (a) Rewrite slide HTML, swapping every successfully mirrored URL with
  //     a slide-relative local path.
  for (const slide of input.manifest.slides) {
    const slidePath = normalizePackagePath(slide.file);
    const slideBytes = entries.get(slidePath);
    if (!slideBytes) continue;
    const html = utf8Decoder.decode(slideBytes);
    const slideRelativeMap = new Map<string, string>();
    for (const [url, absPath] of urlToLocalAbsPath) {
      slideRelativeMap.set(url, relativeFromSlide(slidePath, absPath));
    }
    const rewritten = rewriteHtmlBody(html, slideRelativeMap);
    entries.set(slidePath, utf8Encoder.encode(rewritten));
  }

  // (b) Rewrite all CSS bodies (including the mirrored ones) — mirrored CSS
  //     references its sibling woff2 files using paths relative to the CSS
  //     file's location.
  for (const [path, bytes] of Array.from(entries.entries())) {
    if (!/\.css$/i.test(path)) continue;
    const css = utf8Decoder.decode(bytes);
    const relativeMap = new Map<string, string>();
    for (const [url, absPath] of urlToLocalAbsPath) {
      relativeMap.set(url, relativeFromSlide(path, absPath));
    }
    const rewritten = rewriteCssBody(css, relativeMap);
    entries.set(path, utf8Encoder.encode(rewritten));
  }

  // ── Assets index update ───────────────────────────────────────────────
  const manifest = { ...input.manifest };
  const existingAssets = manifest.assets as
    | { totalSize?: number; count?: number; files?: Array<{ path: string; size: number; type: AssetType }> }
    | undefined;
  const existingFiles = Array.isArray(existingAssets?.files) ? [...existingAssets!.files!] : [];
  const existingPaths = new Set(existingFiles.map((f) => f.path));
  for (const asset of mirroredAssets) {
    if (existingPaths.has(asset.path)) continue;
    const category = categoryFor(
      pickExtension(asset.originalUrl, asset.contentType),
      new Set<ExtractedRefKind>(),
    );
    existingFiles.push({
      path: asset.path,
      size: asset.bytes,
      type: assetTypeFor(category),
    });
    existingPaths.add(asset.path);
  }
  manifest.assets = {
    totalSize: existingFiles.reduce((sum, f) => sum + (f.size ?? 0), 0),
    count: existingFiles.length,
    files: existingFiles,
  };

  const offline: ManifestOffline = {
    ready: skippedUrls.length === 0,
    mirroredAt: now.toISOString(),
    mirrorTool: { name: toolName, version: toolVersion },
    policy: policySnapshot,
    mirroredAssets,
    skippedUrls,
  };
  manifest.offline = offline;
  manifest.updatedAt = now.toISOString();

  return {
    entries,
    manifest,
    offline,
    stats: {
      mirrored: mirroredAssets.length,
      skipped: skippedUrls.length,
      bytesDownloaded,
    },
  };
}

/* ----------------------------------------------------------------------- */
/*  Stock fetcher: use whatever `fetch` is around (Node 20+, browsers).    */
/* ----------------------------------------------------------------------- */

export interface NetworkFetcherOptions {
  /** Per-request timeout, default 30 s. */
  timeoutMs?: number;
  /** Pass-through Headers (e.g. `User-Agent`). */
  headers?: Record<string, string>;
}

/**
 * Build a {@link MirrorFetcher} that delegates to the global `fetch`. The
 * wrapper enforces a timeout, normalizes the response into the
 * {@link MirrorFetchResult} contract, and classifies HTTP failures into the
 * spec-defined `unreachable` / `too-large` skip reasons.
 */
export function createNetworkFetcher(options: NetworkFetcherOptions = {}): MirrorFetcher {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const headers = options.headers ?? {};
  return async (url: string): Promise<MirrorFetchResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers,
      });
      if (!response.ok) {
        return { ok: false, reason: 'unreachable', detail: `HTTP ${response.status}` };
      }
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const buf = new Uint8Array(await response.arrayBuffer());
      return { ok: true, bytes: buf, contentType, finalUrl: response.url };
    } catch (error) {
      const reason: ManifestOfflineSkippedReason =
        error instanceof Error && error.name === 'AbortError' ? 'unreachable' : 'unreachable';
      return {
        ok: false,
        reason,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
