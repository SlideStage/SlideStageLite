import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedDeck, Manifest } from '@slidestage/core/deck/types';
import { __test } from '@slidestage/lite-preset/desktop/thumbnailCapture';
import type { ThumbnailCache } from '@slidestage/lite-preset/desktop/thumbnailCache';
import {
  useThumbnailCapture,
  type ThumbnailCaptureState,
} from '@slidestage/lite-preset/desktop/useThumbnailCapture';

function makeManifest(): Manifest {
  return {
    schema: 'slidestage@1.0',
    id: 'test-deck',
    version: '0.0.1',
    title: 'Test Deck',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 2,
    slides: [
      { index: 1, id: 'slide-a', label: 'A', file: 'slides/a.html', thumbnail: null, notes: null },
      { index: 2, id: 'slide-b', label: 'B', file: 'slides/b.html', thumbnail: null, notes: null },
    ],
  };
}

function makeDeck(): LoadedDeck {
  return {
    fileName: 'test.stage',
    fingerprint: 'deadbeef'.repeat(8),
    deckId: 'deadbeefdeadbeef',
    manifest: makeManifest(),
    slideUrls: ['blob:1', 'blob:2'],
    slideHtml: ['<html></html>', '<html></html>'],
    thumbnailUrls: [null, null],
    prefersSrcdoc: true,
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    revoke: () => {},
  };
}

function makeMemoryCache(): ThumbnailCache & { _store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    _store: store,
    async read(_fp, slideId) {
      return store.get(slideId) ?? null;
    },
    async write(_fp, slideId, bytes) {
      store.set(slideId, bytes);
    },
    async list() {
      return [...store.keys()];
    },
    async clear() {
      store.clear();
    },
  };
}

const lastState: { current: ThumbnailCaptureState | null } = { current: null };

function Harness({ deck, cache }: { deck: LoadedDeck; cache: ThumbnailCache }) {
  const state = useThumbnailCapture(deck, { cache, force: true });
  lastState.current = state;
  return null;
}

describe('useThumbnailCapture', () => {
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;
  let nextUrlId: number;
  let revokedUrls: string[];

  beforeEach(() => {
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    nextUrlId = 0;
    revokedUrls = [];
    URL.createObjectURL = vi.fn(() => `blob:mock-${++nextUrlId}`);
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    lastState.current = null;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  // Minimal valid WebP (RIFF/WEBP magic + padding) so the capture's
  // DSS-CAND-016 payload validation accepts it.
  function webpBytes(): number[] {
    const arr = new Array<number>(__test.MIN_THUMBNAIL_BYTES).fill(0);
    arr[0] = 0x52;
    arr[1] = 0x49;
    arr[2] = 0x46;
    arr[3] = 0x46;
    arr[8] = 0x57;
    arr[9] = 0x45;
    arr[10] = 0x42;
    arr[11] = 0x50;
    return arr;
  }

  function emitProbe(slideId: string, bytes: number[] = webpBytes()): void {
    // The capture only accepts messages whose source is its own iframe
    // (DSS-CAND-016), so mirror that here.
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="thumbnail-capture-worker"]',
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          __tag: __test.PROBE_MESSAGE_TAG,
          slideId,
          status: 'ok',
          bytes,
        },
        source: iframe?.contentWindow ?? null,
      }),
    );
  }

  it('starts capturing when slides have no manifest thumbnail', async () => {
    const cache = makeMemoryCache();
    const deck = makeDeck();

    await act(async () => {
      render(<Harness deck={deck} cache={cache} />);
    });

    expect(lastState.current?.status).toBe('capturing');

    await waitFor(() => {
      // The hidden iframe should have been mounted by the hook.
      expect(document.querySelector('iframe[title="thumbnail-capture-worker"]')).not.toBeNull();
    });

    await act(async () => {
      emitProbe('slide-a');
    });
    await waitFor(() => {
      expect(lastState.current?.capturedCount).toBe(1);
    });

    await act(async () => {
      emitProbe('slide-b');
    });
    await waitFor(() => {
      expect(lastState.current?.capturedCount).toBe(2);
      expect(lastState.current?.status).toBe('done');
    });

    expect(lastState.current?.thumbnailUrls.every((u) => typeof u === 'string')).toBe(true);
    expect(cache._store.size).toBe(2);
  });

  it('serves cache hits without invoking the capture iframe', async () => {
    const cache = makeMemoryCache();
    cache._store.set('slide-a', new Uint8Array([1]));
    cache._store.set('slide-b', new Uint8Array([2]));
    const deck = makeDeck();

    await act(async () => {
      render(<Harness deck={deck} cache={cache} />);
    });

    await waitFor(() => {
      expect(lastState.current?.status).toBe('done');
      expect(lastState.current?.capturedCount).toBe(2);
    });

    expect(lastState.current?.thumbnailUrls.every((u) => typeof u === 'string')).toBe(true);
  });

  it('falls back to noop when neither Tauri nor force is set', async () => {
    const cache = makeMemoryCache();
    const deck = makeDeck();

    function ForceOff() {
      const state = useThumbnailCapture(deck, { cache, force: false });
      lastState.current = state;
      return null;
    }

    await act(async () => {
      render(<ForceOff />);
    });

    expect(lastState.current?.status).toBe('noop');
    expect(lastState.current?.thumbnailUrls).toEqual([null, null]);
    expect(document.querySelector('iframe[title="thumbnail-capture-worker"]')).toBeNull();
  });

  it('reports status=done when nothing needs capturing', async () => {
    const cache = makeMemoryCache();
    const deck = makeDeck();
    deck.thumbnailUrls = ['blob:original-1', 'blob:original-2'];

    await act(async () => {
      render(<Harness deck={deck} cache={cache} />);
    });

    expect(lastState.current?.status).toBe('done');
    expect(lastState.current?.thumbnailUrls).toEqual(['blob:original-1', 'blob:original-2']);
  });

  it('cleans up the iframe on unmount', async () => {
    const cache = makeMemoryCache();
    const deck = makeDeck();

    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Harness deck={deck} cache={cache} />);
    });

    await waitFor(() => {
      expect(document.querySelector('iframe[title="thumbnail-capture-worker"]')).not.toBeNull();
    });

    await act(async () => {
      view!.unmount();
    });

    expect(document.querySelector('iframe[title="thumbnail-capture-worker"]')).toBeNull();
  });
});
