import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  injectCaptureProbe,
  runCaptureQueue,
  runSingleCapture,
  __test,
  type CaptureRequest,
} from '@slidestage/lite-preset/desktop/thumbnailCapture';
import {
  noopThumbnailCache,
  type ThumbnailCache,
} from '@slidestage/lite-preset/desktop/thumbnailCache';

describe('injectCaptureProbe', () => {
  it('appends the probe right before </body>', () => {
    const html = '<!doctype html><html><body><h1>hello</h1></body></html>';
    const out = injectCaptureProbe(html, 'slide-1');
    expect(out).toMatch(/<script>[\s\S]*<\/script><\/body>/);
    expect(out).toContain('"slide-1"');
    expect(out).toContain(__test.PROBE_MESSAGE_TAG);
  });

  it('falls back to append when body tag is absent', () => {
    const html = '<p>no body</p>';
    const out = injectCaptureProbe(html, 'root');
    expect(out.startsWith('<p>no body</p>')).toBe(true);
    expect(out).toContain(__test.PROBE_MESSAGE_TAG);
  });

  it('rejects unsafe slide ids', () => {
    expect(() => injectCaptureProbe('<html></html>', '../bad')).toThrow(/unsafe slideId/);
  });
});

interface FakeIframe {
  el: HTMLIFrameElement;
  emit: (data: unknown) => void;
}

function makeFakeIframe(): FakeIframe {
  const el = document.createElement('iframe');
  el.style.position = 'fixed';
  el.style.left = '-100000px';
  document.body.appendChild(el);
  return {
    el,
    emit(data: unknown) {
      window.dispatchEvent(new MessageEvent('message', { data }));
    },
  };
}

describe('runSingleCapture', () => {
  let fake: FakeIframe;
  beforeEach(() => {
    fake = makeFakeIframe();
  });
  afterEach(() => {
    fake.el.remove();
  });

  it('resolves when the probe reports ok', async () => {
    const controller = new AbortController();
    const captured = runSingleCapture(
      {
        slideId: 'slide-1',
        slideHtml: '<html><body>hi</body></html>',
        width: 1920,
        height: 1080,
      },
      { iframe: fake.el, signal: controller.signal },
    );

    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-1',
        status: 'ok',
        bytes: [11, 22, 33],
      });
    }, 0);

    await expect(captured).resolves.toEqual({
      slideId: 'slide-1',
      bytes: new Uint8Array([11, 22, 33]),
    });
  });

  it('rejects when the probe reports an error', async () => {
    const controller = new AbortController();
    const promise = runSingleCapture(
      {
        slideId: 'slide-1',
        slideHtml: '<html></html>',
        width: 100,
        height: 100,
      },
      { iframe: fake.el, signal: controller.signal },
    );

    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-1',
        status: 'error',
        reason: 'no 2d context',
      });
    }, 0);

    await expect(promise).rejects.toThrow(/no 2d context/);
  });

  it('rejects when aborted', async () => {
    const controller = new AbortController();
    const promise = runSingleCapture(
      {
        slideId: 'slide-1',
        slideHtml: '<html></html>',
        width: 100,
        height: 100,
      },
      { iframe: fake.el, signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 0);

    await expect(promise).rejects.toThrow(/aborted/);
  });

  it('ignores messages from other slides', async () => {
    const controller = new AbortController();
    const promise = runSingleCapture(
      {
        slideId: 'slide-target',
        slideHtml: '<html></html>',
        width: 100,
        height: 100,
      },
      { iframe: fake.el, signal: controller.signal },
    );

    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'other-slide',
        status: 'ok',
        bytes: [9],
      });
    }, 0);

    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-target',
        status: 'ok',
        bytes: [1, 2, 3],
      });
    }, 5);

    await expect(promise).resolves.toEqual({
      slideId: 'slide-target',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });
});

describe('runCaptureQueue', () => {
  let fake: FakeIframe;
  beforeEach(() => {
    fake = makeFakeIframe();
  });
  afterEach(() => {
    fake.el.remove();
  });

  function makeRequest(slideId: string): CaptureRequest {
    return {
      slideId,
      slideHtml: '<html><body></body></html>',
      width: 100,
      height: 60,
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

  it('skips slides that already have a cache entry', async () => {
    const cache = makeMemoryCache();
    cache._store.set('slide-a', new Uint8Array([42]));

    const ready: Array<[string, number]> = [];
    const failed: string[] = [];

    const queue = runCaptureQueue(
      fake.el,
      [makeRequest('slide-a'), makeRequest('slide-b')],
      {
        cache,
        fingerprint: 'fp',
        onSlideReady: (slideId, bytes) => ready.push([slideId, bytes[0] ?? -1]),
        onSlideFailed: (failure) => failed.push(failure.slideId),
      },
    );

    // First slide is a cache hit — no probe required.
    // Second slide needs a real capture — emit a probe ok shortly after.
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-b',
        status: 'ok',
        bytes: [99],
      });
    }, 20);

    await queue;
    expect(ready).toEqual([
      ['slide-a', 42],
      ['slide-b', 99],
    ]);
    expect(failed).toEqual([]);
    expect(cache._store.get('slide-b')).toEqual(new Uint8Array([99]));
  });

  it('records per-slide failures without stopping the queue', async () => {
    const cache = makeMemoryCache();
    const ready: string[] = [];
    const failed: string[] = [];

    const queue = runCaptureQueue(
      fake.el,
      [makeRequest('slide-a'), makeRequest('slide-b')],
      {
        cache,
        fingerprint: 'fp',
        onSlideReady: (slideId) => ready.push(slideId),
        onSlideFailed: (failure) => failed.push(failure.slideId),
      },
    );

    // First slide fails → second slide succeeds.
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-a',
        status: 'error',
        reason: 'boom',
      });
    }, 10);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-b',
        status: 'ok',
        bytes: [7],
      });
    }, 30);

    await queue;
    expect(ready).toEqual(['slide-b']);
    expect(failed).toEqual(['slide-a']);
  });

  it('stops walking the queue when aborted between slides', async () => {
    const cache = makeMemoryCache();
    const ready: string[] = [];

    const controller = new AbortController();
    const queue = runCaptureQueue(
      fake.el,
      [makeRequest('slide-a'), makeRequest('slide-b')],
      {
        cache,
        fingerprint: 'fp',
        signal: controller.signal,
        onSlideReady: (slideId) => ready.push(slideId),
      },
    );

    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-a',
        status: 'ok',
        bytes: [1],
      });
      controller.abort();
    }, 10);

    await queue;
    expect(ready).toEqual(['slide-a']);
  });

  it('is a no-op when the request list is empty', async () => {
    const cache = noopThumbnailCache;
    const ready: string[] = [];
    await runCaptureQueue(fake.el, [], {
      cache,
      fingerprint: 'fp',
      onSlideReady: (slideId) => ready.push(slideId),
    });
    expect(ready).toEqual([]);
  });
});
