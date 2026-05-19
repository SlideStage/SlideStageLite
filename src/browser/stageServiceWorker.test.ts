import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { virtualUrlFor } from './stageServiceWorker';

describe('virtualUrlFor', () => {
  it('builds the documented /__stage/<deckId>/<path> shape', () => {
    expect(virtualUrlFor('deadbeefdeadbeef', 'slides/01.html')).toBe(
      '/__stage/deadbeefdeadbeef/slides/01.html',
    );
  });

  it('strips leading slashes on the path so callers can be sloppy', () => {
    expect(virtualUrlFor('abc', '/slides/01.html')).toBe('/__stage/abc/slides/01.html');
    expect(virtualUrlFor('abc', '///slides/01.html')).toBe('/__stage/abc/slides/01.html');
  });

  it('URI-encodes each segment but keeps the path separator readable', () => {
    expect(virtualUrlFor('deck#1', 'shared/with space.css')).toBe(
      '/__stage/deck%231/shared/with%20space.css',
    );
    // The slash must NOT be encoded — otherwise iframe URL resolution
    // would resolve relative refs in the slide HTML against the wrong
    // base.
    expect(virtualUrlFor('id', 'a/b/c.css')).toBe('/__stage/id/a/b/c.css');
  });

  it('returns a stable URL for the same deckId / path pair', () => {
    expect(virtualUrlFor('xx', 'a.css')).toBe(virtualUrlFor('xx', 'a.css'));
  });
});

describe('registerStageServiceWorker', () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    // Reset module-level memoization between tests by re-importing —
    // see the dynamic import inside each test.
    vi.resetModules();
  });

  afterEach(() => {
    // Restore navigator if a test stubbed it out.
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: originalNavigator,
    });
  });

  it('returns null when navigator.serviceWorker is unavailable', async () => {
    // jsdom does not ship a service-worker container; the helper should
    // detect that and degrade silently rather than throw.
    const mod = await import('./stageServiceWorker');
    const reg = await mod.registerStageServiceWorker();
    expect(reg).toBeNull();
  });

  it('publishDeck rejects when the host has no SW controller', async () => {
    const mod = await import('./stageServiceWorker');
    await expect(
      mod.publishDeck('abc', [
        { path: 'a.html', type: 'text/html;charset=utf-8', bytes: new Uint8Array([1]) },
      ]),
    ).rejects.toThrow(/stage-sw is not active/);
  });

  it('unpublishDeck and cleanupDecks are no-ops when SW is unavailable', async () => {
    const mod = await import('./stageServiceWorker');
    await expect(mod.unpublishDeck('abc')).resolves.toBeUndefined();
    await expect(mod.cleanupDecks(['abc'])).resolves.toBeUndefined();
  });

  it('getStageServiceWorkerClient resolves null when registration cannot happen', async () => {
    const mod = await import('./stageServiceWorker');
    const client = await mod.getStageServiceWorkerClient();
    expect(client).toBeNull();
  });
});
