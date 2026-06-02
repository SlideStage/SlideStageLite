/* eslint-disable */
/*
 * SlideStageLite Service Worker
 * -----------------------------
 *
 * Why this file exists:
 *   The SPA loads `.stage` decks entirely in the browser and renders each
 *   slide inside an iframe sandboxed with `allow-scripts` only (no
 *   `allow-same-origin`). That sandbox gives the iframe an opaque
 *   ("null") origin. Modern Chrome (131+) partitions `blob:` URLs by
 *   their creator origin/top-level site, so an opaque-origin iframe
 *   can't fetch `blob:` URLs created by the parent — every subresource
 *   referenced via `url(blob:...)`, `<img src="blob:...">`,
 *   `<link href="blob:...">`, `<script src="blob:...">` returns
 *   "blocked:other" and the deck renders unstyled.
 *
 *   The fix is to serve deck assets from the SPA's own origin, behind a
 *   virtual URL prefix that the page can reference like any other static
 *   path. This Service Worker owns that virtual prefix: it caches each
 *   deck's bytes per-deck and responds to subresource fetches from
 *   anywhere in the SPA's scope, including sandboxed iframes.
 *
 * URL contract:
 *   /__stage/<deckId>/<package-relative-path>
 *
 *   `deckId` is opaque to this worker; the SPA derives it from the
 *   loaded deck (today: short prefix of the content fingerprint). The
 *   worker only treats it as the cache namespace and as the URL
 *   segment that disambiguates concurrently-open decks.
 *
 * Storage:
 *   One `CacheStorage` bucket per deck named `slidestage-deck:<deckId>`.
 *   The SPA POSTs all asset bytes up-front via `postMessage`, and we
 *   call `cache.put(virtualUrl, Response)` for each. Subsequent fetches
 *   are a single `cache.match(...)`.
 *
 * Message protocol (SPA → SW, replies on the supplied MessagePort):
 *   { type: 'publish-deck', deckId, assets: [{ path, type, bytes }] }
 *       → { type: 'published', deckId } on success.
 *   { type: 'unpublish-deck', deckId }
 *       → { type: 'unpublished', deckId } once the cache is gone.
 *   { type: 'cleanup-decks', keepDeckIds: [...] }
 *       → { type: 'cleaned', removed: [...] }; drops every
 *         `slidestage-deck:*` cache whose deckId is not in keepDeckIds.
 *   { type: 'ping' } → { type: 'pong' } (used by the SPA to confirm
 *         the controller is alive before publishing).
 *
 * CORS:
 *   Sandboxed iframes have opaque origins, so requests to our virtual
 *   URLs are technically cross-origin from the iframe's point of view.
 *   We emit `Access-Control-Allow-Origin: *` so `@font-face` and other
 *   CORS-restricted fetches succeed. Same-origin navigations don't need
 *   the header, but emitting it unconditionally keeps the rule simple.
 */

const VIRTUAL_PREFIX = '/__stage/';
const CACHE_PREFIX = 'slidestage-deck:';
const CORS_ALL = 'Access-Control-Allow-Origin';

// Schema limits for control messages (DSS-CAND-011). deckId is a 16-hex
// fingerprint prefix (see loadDeck.deckIdFromFingerprint); the generous
// charset/length below still rejects path separators and traversal.
const DECK_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_ASSET_PATH_LEN = 1024;
const MAX_ASSETS_PER_DECK = 20_000;

/**
 * DSS-CAND-011: only the SPA shell may drive deck caches.
 *
 * `message` events carry `event.source` — the Client that sent them. The
 * legitimate publisher is the controlled top-level page, whose document URL
 * lives at the SPA origin root (never under the virtual prefix). A
 * trust-elevated deck iframe, by contrast, runs author code at our real
 * origin from `/__stage/<deckId>/…`; without this check that author code
 * could `navigator.serviceWorker.controller.postMessage(...)` and forge
 * publish/unpublish/cleanup ops for *other* decks. We therefore accept
 * control messages only from a same-origin, top-level window client whose
 * URL is not behind the virtual prefix.
 */
function isTrustedControlSource(source) {
  if (!source || typeof source !== 'object') return false;
  // Reject SharedWorker / nested-frame senders where the platform tells us.
  if (typeof source.type === 'string' && source.type !== 'window') return false;
  if (source.frameType === 'nested') return false;
  const rawUrl = source.url;
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  // Deck asset pages (incl. trust-elevated, same-origin iframes) are untrusted.
  if (url.pathname.startsWith(VIRTUAL_PREFIX)) return false;
  return true;
}

function isValidDeckId(deckId) {
  return typeof deckId === 'string' && DECK_ID_RE.test(deckId);
}

/**
 * Asset paths are appended to `/__stage/<deckId>/` and stored as Cache
 * keys. CacheStorage normalizes `..`, so a path like `../other/evil.html`
 * would poison a sibling deck's namespace — reject traversal, absolute
 * paths, backslashes, schemes, and control characters.
 */
function isSafeAssetPath(path) {
  if (typeof path !== 'string') return false;
  if (!path || path.length > MAX_ASSET_PATH_LEN) return false;
  if (path[0] === '/' || path.includes('\\')) return false;
  if (path.includes('://') || path.startsWith('//')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path
    .split('/')
    .every((segment) => segment !== '..' && segment !== '.' && segment.length > 0);
}

self.addEventListener('install', (event) => {
  // Take over as soon as the SPA reloads; we never want a stale worker
  // to serve a deck after the SPA bundle has been updated.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  const port = event.ports && event.ports[0];

  // DSS-CAND-011: drop control messages from anything but the SPA shell.
  if (!isTrustedControlSource(event.source)) {
    respond(port, {
      type: 'error',
      op: typeof data.type === 'string' ? data.type : 'unknown',
      message: 'Untrusted message source',
    });
    return;
  }

  switch (data.type) {
    case 'ping':
      respond(port, { type: 'pong' });
      break;
    case 'publish-deck':
      event.waitUntil(
        publishDeck(data.deckId, data.assets)
          .then(() => respond(port, { type: 'published', deckId: data.deckId }))
          .catch((error) =>
            respond(port, {
              type: 'error',
              op: 'publish-deck',
              deckId: data.deckId,
              message: String((error && error.message) || error),
            }),
          ),
      );
      break;
    case 'unpublish-deck':
      event.waitUntil(
        unpublishDeck(data.deckId)
          .then(() => respond(port, { type: 'unpublished', deckId: data.deckId }))
          .catch((error) =>
            respond(port, {
              type: 'error',
              op: 'unpublish-deck',
              deckId: data.deckId,
              message: String((error && error.message) || error),
            }),
          ),
      );
      break;
    case 'cleanup-decks':
      event.waitUntil(
        cleanupOldDecks(Array.isArray(data.keepDeckIds) ? data.keepDeckIds : [])
          .then((removed) => respond(port, { type: 'cleaned', removed }))
          .catch((error) =>
            respond(port, {
              type: 'error',
              op: 'cleanup-decks',
              message: String((error && error.message) || error),
            }),
          ),
      );
      break;
    default:
      respond(port, { type: 'error', op: 'unknown', message: 'Unknown message type' });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // We only handle GET; anything else (HEAD, OPTIONS, POST...) is left
  // alone so dev-server tooling keeps working.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(VIRTUAL_PREFIX)) return;

  const route = parseVirtualPath(url.pathname);
  if (!route) return;

  event.respondWith(serveAsset(route.deckId, url.pathname));
});

function parseVirtualPath(pathname) {
  const tail = pathname.slice(VIRTUAL_PREFIX.length);
  const slashIdx = tail.indexOf('/');
  if (slashIdx <= 0) return null;
  const deckId = tail.slice(0, slashIdx);
  const assetPath = tail.slice(slashIdx + 1);
  if (!deckId || !assetPath) return null;
  return { deckId, assetPath };
}

async function serveAsset(deckId, pathname) {
  try {
    const cache = await caches.open(CACHE_PREFIX + deckId);
    const match = await cache.match(pathname);
    if (match) {
      return withCors(match);
    }
  } catch (error) {
    return new Response(
      `Service worker cache error: ${String((error && error.message) || error)}`,
      { status: 500 },
    );
  }
  return new Response('Deck asset not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain;charset=utf-8', [CORS_ALL]: '*' },
  });
}

function withCors(response) {
  // `Response` headers are immutable for cached responses, so we have
  // to rebuild the response to attach CORS. Body is consumed once, then
  // re-emitted from a fresh stream.
  const headers = new Headers(response.headers);
  if (!headers.has(CORS_ALL)) {
    headers.set(CORS_ALL, '*');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function publishDeck(deckId, assets) {
  if (!isValidDeckId(deckId)) {
    throw new Error('publish-deck requires a valid deckId');
  }
  if (!Array.isArray(assets)) {
    throw new Error('publish-deck requires assets to be an array');
  }
  if (assets.length > MAX_ASSETS_PER_DECK) {
    throw new Error('publish-deck asset count exceeds limit');
  }
  const cacheName = CACHE_PREFIX + deckId;
  // Drop any previous version of this deck before writing the new
  // bundle. Otherwise a re-publish with a smaller asset set could leave
  // stale entries behind.
  await caches.delete(cacheName);
  const cache = await caches.open(cacheName);

  for (const asset of assets) {
    if (!asset || !isSafeAssetPath(asset.path)) {
      throw new Error('publish-deck asset has a missing or unsafe path');
    }
    const bytes = asset.bytes;
    if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Uint8Array)) {
      throw new Error(`publish-deck asset bytes for ${asset.path} must be ArrayBuffer or Uint8Array`);
    }
    const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const url = `${VIRTUAL_PREFIX}${deckId}/${asset.path}`;
    const response = new Response(body, {
      headers: {
        'Content-Type': typeof asset.type === 'string' && asset.type ? asset.type : 'application/octet-stream',
        // Decks live for the SPA session only; do not let intermediaries
        // (or the HTTP cache) hang on to them across publishes.
        'Cache-Control': 'no-store',
        [CORS_ALL]: '*',
      },
    });
    await cache.put(url, response);
  }
}

async function unpublishDeck(deckId) {
  if (!isValidDeckId(deckId)) return;
  await caches.delete(CACHE_PREFIX + deckId);
}

async function cleanupOldDecks(keepDeckIds) {
  const keep = new Set(keepDeckIds.filter(isValidDeckId).map((id) => CACHE_PREFIX + id));
  const removed = [];
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
      .map((name) =>
        caches.delete(name).then((ok) => {
          if (ok) removed.push(name.slice(CACHE_PREFIX.length));
        }),
      ),
  );
  return removed;
}

function respond(port, message) {
  if (!port) return;
  try {
    port.postMessage(message);
  } catch {
    // The SPA may have torn down the channel before we got here; that's
    // fine — the deck cache state stands on its own.
  }
}
