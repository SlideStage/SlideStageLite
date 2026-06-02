import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Unit tests for the security-critical message gate in `public/stage-sw.js`
 * (DSS-CAND-011). The worker is plain JS served verbatim to the browser, so
 * we evaluate it inside a mocked Service Worker global scope and drive the
 * captured `message` handler with synthetic events.
 */

const SW_SOURCE = readFileSync(resolve('public/stage-sw.js'), 'utf8');
const SW_ORIGIN = 'https://app.example';

type Listener = (event: unknown) => void;

interface FakeCache {
  store: Map<string, unknown>;
  put(url: string, response: unknown): Promise<void>;
  match(url: string): Promise<unknown>;
}

interface SwHarness {
  dispatchMessage(data: unknown, source: unknown): Promise<Record<string, unknown> | undefined>;
  caches: Map<string, FakeCache>;
}

function makeHarness(): SwHarness {
  const listeners = new Map<string, Listener>();
  const cacheStore = new Map<string, FakeCache>();

  const fakeCaches = {
    open(name: string): Promise<FakeCache> {
      let cache = cacheStore.get(name);
      if (!cache) {
        const store = new Map<string, unknown>();
        cache = {
          store,
          put(url: string, response: unknown) {
            // Mirror CacheStorage URL normalization closely enough to catch
            // traversal: resolve against the SW origin.
            store.set(new URL(url, SW_ORIGIN).pathname, response);
            return Promise.resolve();
          },
          match(url: string) {
            return Promise.resolve(store.get(new URL(url, SW_ORIGIN).pathname));
          },
        };
        cacheStore.set(name, cache);
      }
      return Promise.resolve(cache);
    },
    delete(name: string): Promise<boolean> {
      return Promise.resolve(cacheStore.delete(name));
    },
    keys(): Promise<string[]> {
      return Promise.resolve([...cacheStore.keys()]);
    },
  };

  const fakeSelf = {
    location: { origin: SW_ORIGIN },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener(type: string, handler: Listener) {
      listeners.set(type, handler);
    },
  };

  // Evaluate the worker with `self` and `caches` injected; Response/Headers/URL
  // resolve to Node globals.
  const factory = new Function('self', 'caches', SW_SOURCE);
  factory(fakeSelf, fakeCaches);

  const messageHandler = listeners.get('message');
  if (!messageHandler) throw new Error('stage-sw did not register a message handler');

  return {
    caches: cacheStore,
    async dispatchMessage(data, source) {
      const replies: Record<string, unknown>[] = [];
      const waits: Promise<unknown>[] = [];
      const port = {
        postMessage: (message: Record<string, unknown>) => replies.push(message),
      };
      const event = {
        data,
        source,
        ports: [port],
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      };
      messageHandler(event);
      await Promise.all(waits.map((p) => Promise.resolve(p).catch(() => undefined)));
      return replies[0];
    },
  };
}

const trustedSource = { type: 'window', frameType: 'top-level', url: `${SW_ORIGIN}/index.html` };

function assetBundle() {
  return [{ path: 'slides/01.html', type: 'text/html', bytes: new Uint8Array([1, 2, 3]) }];
}

describe('stage-sw message gate (DSS-CAND-011)', () => {
  let sw: SwHarness;
  beforeEach(() => {
    sw = makeHarness();
  });

  it('answers ping for the trusted SPA shell', async () => {
    const reply = await sw.dispatchMessage({ type: 'ping' }, trustedSource);
    expect(reply).toEqual({ type: 'pong' });
  });

  it('publishes a deck from the trusted SPA shell', async () => {
    const reply = await sw.dispatchMessage(
      { type: 'publish-deck', deckId: 'deadbeefdeadbeef', assets: assetBundle() },
      trustedSource,
    );
    expect(reply).toMatchObject({ type: 'published', deckId: 'deadbeefdeadbeef' });
    expect(sw.caches.has('slidestage-deck:deadbeefdeadbeef')).toBe(true);
  });

  it('rejects messages from a deck asset page (virtual prefix)', async () => {
    const reply = await sw.dispatchMessage(
      { type: 'publish-deck', deckId: 'deadbeefdeadbeef', assets: assetBundle() },
      { type: 'window', frameType: 'nested', url: `${SW_ORIGIN}/__stage/deadbeefdeadbeef/index.html` },
    );
    expect(reply).toMatchObject({ type: 'error', message: 'Untrusted message source' });
    expect(sw.caches.size).toBe(0);
  });

  it('rejects cross-origin senders', async () => {
    const reply = await sw.dispatchMessage(
      { type: 'cleanup-decks', keepDeckIds: [] },
      { type: 'window', frameType: 'top-level', url: 'https://evil.example/index.html' },
    );
    expect(reply).toMatchObject({ type: 'error', message: 'Untrusted message source' });
  });

  it('rejects non-window senders', async () => {
    const reply = await sw.dispatchMessage(
      { type: 'ping' },
      { type: 'worker', url: `${SW_ORIGIN}/worker.js` },
    );
    expect(reply).toMatchObject({ type: 'error', message: 'Untrusted message source' });
  });

  it('rejects a missing source', async () => {
    const reply = await sw.dispatchMessage({ type: 'ping' }, null);
    expect(reply).toMatchObject({ type: 'error', message: 'Untrusted message source' });
  });

  it('rejects an unsafe asset path even from the trusted shell (cache poisoning)', async () => {
    const reply = await sw.dispatchMessage(
      {
        type: 'publish-deck',
        deckId: 'deadbeefdeadbeef',
        assets: [{ path: '../other/evil.html', type: 'text/html', bytes: new Uint8Array([1]) }],
      },
      trustedSource,
    );
    expect(reply).toMatchObject({ type: 'error', op: 'publish-deck' });
    expect(String(reply?.message)).toMatch(/unsafe path/);
  });

  it('rejects an invalid deckId from the trusted shell', async () => {
    const reply = await sw.dispatchMessage(
      { type: 'publish-deck', deckId: 'a/b', assets: assetBundle() },
      trustedSource,
    );
    expect(reply).toMatchObject({ type: 'error', op: 'publish-deck' });
    expect(String(reply?.message)).toMatch(/valid deckId/);
  });
});
