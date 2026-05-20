/**
 * Thumbnail side-car cache (desktop only).
 *
 * Storage contract — keep in lockstep with `src-tauri/src/lib.rs`:
 *   <APP_DATA>/SlideStageLite/thumbnails/<fingerprint>/<slideId>.webp
 *
 * fingerprint is the deck-bytes SHA-256 (so cache entries are
 * version-isolated by construction). slideId mirrors
 * `manifest.slides[].id` and must match `[A-Za-z0-9._-]` to keep the
 * on-disk path safe.
 *
 * The Web build never persists thumbnails — there's no FS to write to,
 * and re-capturing on every load would be wasteful. We export a no-op
 * shim so callers don't have to branch on isTauri() at every call site.
 *
 * IMPORTANT: The Tauri runtime client (`@tauri-apps/api/core`) is
 * imported via `await import(...)` inside the Tauri-flavour methods
 * below. Static-importing it at the top of the module would pull the
 * Tauri client into the Web bundle, blowing up the main chunk size for
 * users who will never touch it.
 */
import { isTauri } from './env';

const SLIDE_ID_RE = /^[A-Za-z0-9._-]+$/;

export function slideIdIsSafe(id: string): boolean {
  return id.length > 0 && id.length <= 128 && id !== '.' && id !== '..' && SLIDE_ID_RE.test(id);
}

const FINGERPRINT_RE = /^[A-Za-z0-9_-]+$/;

function fingerprintOk(fingerprint: string): boolean {
  return fingerprint.length > 0 && fingerprint.length <= 128 && FINGERPRINT_RE.test(fingerprint);
}

export interface ThumbnailCache {
  /** Returns the WebP bytes for a cached slide, or null if absent. */
  read(fingerprint: string, slideId: string): Promise<Uint8Array | null>;
  /** Persists WebP bytes; idempotent. Throws on quota / IO errors. */
  write(fingerprint: string, slideId: string, bytes: Uint8Array): Promise<void>;
  /** Lists slide IDs that already have a cached thumbnail. */
  list(fingerprint: string): Promise<string[]>;
  /** Best-effort: removes every thumbnail for a deck. */
  clear(fingerprint: string): Promise<void>;
}

/**
 * Web/noop implementation. Keeps the call sites uniform — useful in
 * tests and in the browser build, where there is no persistent FS.
 */
export const noopThumbnailCache: ThumbnailCache = {
  read: async () => null,
  write: async () => {},
  list: async () => [],
  clear: async () => {},
};

function assertSafe(fingerprint: string, slideId: string): void {
  if (!fingerprintOk(fingerprint)) {
    throw new Error(`thumbnailCache: unsafe fingerprint "${fingerprint}"`);
  }
  if (!slideIdIsSafe(slideId)) {
    throw new Error(`thumbnailCache: unsafe slideId "${slideId}"`);
  }
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeRef: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (invokeRef) return invokeRef;
  const mod = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
  invokeRef = mod.invoke;
  return invokeRef;
}

/** Test seam — replaces the lazily-resolved invoke implementation. */
export function __setInvokeForTests(fn: InvokeFn | null): void {
  invokeRef = fn;
}

/**
 * Tauri implementation — delegates to the Rust commands declared in
 * `src-tauri/src/lib.rs` (`thumbnail_cache_*`). All IO failures bubble up
 * as rejected promises so the capture queue can flag them as warnings
 * without crashing playback.
 */
export const tauriThumbnailCache: ThumbnailCache = {
  async read(fingerprint, slideId) {
    assertSafe(fingerprint, slideId);
    const invoke = await getInvoke();
    const bytes = await invoke<number[] | null>('thumbnail_cache_get', {
      fingerprint,
      slideId,
    });
    return bytes ? new Uint8Array(bytes) : null;
  },
  async write(fingerprint, slideId, bytes) {
    assertSafe(fingerprint, slideId);
    if (bytes.byteLength === 0) {
      throw new Error('thumbnailCache: refusing to persist empty bytes');
    }
    const invoke = await getInvoke();
    await invoke<void>('thumbnail_cache_put', {
      fingerprint,
      slideId,
      bytes: Array.from(bytes),
    });
  },
  async list(fingerprint) {
    if (!fingerprintOk(fingerprint)) {
      throw new Error(`thumbnailCache: unsafe fingerprint "${fingerprint}"`);
    }
    const invoke = await getInvoke();
    return invoke<string[]>('thumbnail_cache_list', { fingerprint });
  },
  async clear(fingerprint) {
    if (!fingerprintOk(fingerprint)) {
      throw new Error(`thumbnailCache: unsafe fingerprint "${fingerprint}"`);
    }
    const invoke = await getInvoke();
    await invoke<void>('thumbnail_cache_clear', { fingerprint });
  },
};

/**
 * Pick the right backend for the current runtime. Web builds get the
 * noop shim; Tauri builds get the Rust-backed cache.
 */
export function pickThumbnailCache(): ThumbnailCache {
  return isTauri() ? tauriThumbnailCache : noopThumbnailCache;
}

/**
 * Convert cached WebP bytes into an object URL the React tree can
 * hand straight to <img src=...>. Callers own the returned URL and
 * must call URL.revokeObjectURL when they're done.
 */
export function thumbnailBytesToObjectUrl(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: 'image/webp' });
  return URL.createObjectURL(blob);
}
