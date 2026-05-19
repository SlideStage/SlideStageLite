/**
 * SPA-side client for `public/stage-sw.js`.
 *
 * The Service Worker owns a per-deck CacheStorage bucket and serves
 * `/__stage/<deckId>/<path>` virtual URLs. The Web build of the deck
 * loader needs three things from here:
 *
 *   - registration (idempotent, returns null on unsupported hosts so
 *     the loader can fall back to the inline `data:` + `srcdoc` flavor
 *     used by Tauri / file:// hosting),
 *   - a `publish` + `unpublish` pair that round-trips bytes to the SW
 *     and waits for an ACK,
 *   - a `virtualUrlFor(deckId, path)` helper so the deck loader and the
 *     viewer agree on what URL each asset lives at.
 *
 * The publishing path uses transferable ArrayBuffers so that even a
 * 100 MB deck does not double-allocate in the SPA→SW hop. After a
 * successful publish the SPA's `Uint8Array`s for those assets are
 * detached; the loader treats them as one-shot anyway.
 */

import { isTauri } from '../desktop/env';

const SW_PATH = '/stage-sw.js';
const SW_SCOPE = '/';
export const VIRTUAL_PREFIX = '/__stage/';

const PUBLISH_TIMEOUT_MS = 30_000;
const SHORT_OP_TIMEOUT_MS = 5_000;

export interface StageAsset {
  /** Package-relative path, e.g. `slides/01-cover.html`. */
  path: string;
  /** MIME type, used verbatim as `Content-Type`. */
  type: string;
  /** Asset bytes. Transferred to the SW (the original buffer is detached). */
  bytes: Uint8Array;
}

export interface StageServiceWorkerClient {
  /** Build the URL the viewer should hand the iframe for a deck path. */
  virtualUrlFor(deckId: string, path: string): string;
  /** Send the full asset bundle to the SW and wait for an ACK. */
  publishDeck(deckId: string, assets: ReadonlyArray<StageAsset>): Promise<void>;
  /** Drop a deck's cache once the SPA is done with it. */
  unpublishDeck(deckId: string): Promise<void>;
  /** Drop every cached deck whose id is not in `keep`. */
  cleanupDecks(keep: ReadonlyArray<string>): Promise<void>;
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let warnedUnsupported = false;

function isServiceWorkerHostSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (typeof window === 'undefined') return false;
  // Tauri runs under a custom `tauri://` scheme; service workers are
  // not honored there and we already have a working srcdoc + data: URL
  // path for that build.
  if (isTauri()) return false;
  // file:// hosting can't register service workers either.
  if (window.location && window.location.protocol === 'file:') return false;
  return true;
}

/**
 * Idempotent registration. Returns the registration on success, or null
 * when the host can't (or shouldn't) run the SW — callers must treat
 * `null` as "fall back to the inline flavor".
 */
export function registerStageServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerHostSupported()) {
    if (!warnedUnsupported) {
      warnedUnsupported = true;
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.info(
          '[slidestage] stage-sw not used: host lacks Service Worker support or is Tauri/file://',
        );
      }
    }
    return Promise.resolve(null);
  }

  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(SW_PATH, { scope: SW_SCOPE })
      .catch((error) => {
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn('[slidestage] failed to register stage-sw', error);
        }
        registrationPromise = null;
        return null;
      });
  }
  return registrationPromise;
}

interface PortMessage {
  type: string;
  [key: string]: unknown;
}

async function sendToController(
  controller: ServiceWorker,
  message: PortMessage,
  transfer: Transferable[],
  expectedReply: string,
  timeoutMs: number,
): Promise<PortMessage> {
  return new Promise<PortMessage>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error(`stage-sw ${message.type} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    channel.port1.onmessage = (event) => {
      const data = event.data as PortMessage | undefined;
      clearTimeout(timer);
      channel.port1.close();
      if (!data || typeof data !== 'object') {
        reject(new Error(`stage-sw ${message.type} returned no reply`));
        return;
      }
      if (data.type === 'error') {
        reject(new Error(`stage-sw ${message.type} failed: ${String(data.message)}`));
        return;
      }
      if (data.type !== expectedReply) {
        reject(
          new Error(
            `stage-sw ${message.type} returned unexpected reply ${data.type} (expected ${expectedReply})`,
          ),
        );
        return;
      }
      resolve(data);
    };
    try {
      controller.postMessage(message, [channel.port2, ...transfer]);
    } catch (error) {
      clearTimeout(timer);
      channel.port1.close();
      reject(error);
    }
  });
}

const CONTROLLER_CLAIM_TIMEOUT_MS = 3_000;

async function waitForController(): Promise<ServiceWorker | null> {
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  return new Promise<ServiceWorker | null>((resolve) => {
    let settled = false;
    const finish = (controller: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      clearTimeout(timer);
      resolve(controller);
    };
    const onChange = () => finish(navigator.serviceWorker.controller);
    const timer = setTimeout(() => finish(null), CONTROLLER_CLAIM_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

async function getActiveController(): Promise<ServiceWorker | null> {
  const reg = await registerStageServiceWorker();
  if (!reg) return null;
  // `ready` resolves once a worker is `active` (state === 'activated').
  const ready = await navigator.serviceWorker.ready.catch(() => null);
  if (!ready?.active) return null;
  // On the very first SPA load `clients.claim()` from the SW's `activate`
  // handler hasn't finished propagating yet, so
  // `navigator.serviceWorker.controller` is still null. Subresource
  // fetches for trust-elevated decks (the only iframes the SW can
  // intercept — see notes in `loadDeck.ts`) must hit the SW fast-path,
  // so wait for the controller to land before returning.
  await waitForController();
  return navigator.serviceWorker.controller ?? ready.active;
}

export function virtualUrlFor(deckId: string, path: string): string {
  // Normalize: trim leading slashes so we always end up with exactly
  // one `/` between deckId and path. Encoding the path as components
  // would break the relative-path expectations of the loader's HTML
  // rewriter, so we only URI-encode characters that would otherwise
  // confuse the URL parser.
  const cleanPath = path.replace(/^\/+/, '');
  return `${VIRTUAL_PREFIX}${encodeURIComponent(deckId)}/${cleanPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

export async function publishDeck(
  deckId: string,
  assets: ReadonlyArray<StageAsset>,
): Promise<void> {
  const controller = await getActiveController();
  if (!controller) {
    throw new Error('stage-sw is not active; cannot publish deck');
  }
  const transferAssets = assets.map((asset) => {
    // Make sure we send a copy of the underlying ArrayBuffer so any
    // SharedArrayBuffer-backed views still cross the postMessage
    // boundary correctly, and so we can list it in `transfer` without
    // detaching the loader's other references to the same buffer.
    const standalone = new Uint8Array(asset.bytes.byteLength);
    standalone.set(asset.bytes);
    return {
      path: asset.path,
      type: asset.type,
      bytes: standalone,
    };
  });
  const transferables: Transferable[] = transferAssets.map((asset) => asset.bytes.buffer);
  await sendToController(
    controller,
    { type: 'publish-deck', deckId, assets: transferAssets },
    transferables,
    'published',
    PUBLISH_TIMEOUT_MS,
  );
}

export async function unpublishDeck(deckId: string): Promise<void> {
  const controller = await getActiveController();
  if (!controller) return;
  await sendToController(
    controller,
    { type: 'unpublish-deck', deckId },
    [],
    'unpublished',
    SHORT_OP_TIMEOUT_MS,
  ).catch((error) => {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[slidestage] stage-sw unpublishDeck failed', error);
    }
  });
}

export async function cleanupDecks(keep: ReadonlyArray<string>): Promise<void> {
  const controller = await getActiveController();
  if (!controller) return;
  await sendToController(
    controller,
    { type: 'cleanup-decks', keepDeckIds: Array.from(keep) },
    [],
    'cleaned',
    SHORT_OP_TIMEOUT_MS,
  ).catch((error) => {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[slidestage] stage-sw cleanupDecks failed', error);
    }
  });
}

export async function getStageServiceWorkerClient(): Promise<StageServiceWorkerClient | null> {
  const reg = await registerStageServiceWorker();
  if (!reg) return null;
  return {
    virtualUrlFor,
    publishDeck,
    unpublishDeck,
    cleanupDecks,
  };
}
