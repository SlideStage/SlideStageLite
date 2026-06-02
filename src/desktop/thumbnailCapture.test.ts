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

describe('decodeThumbnailBytes (DSS-CAND-016)', () => {
  it('accepts a well-formed WebP payload', () => {
    const valid = (() => {
      const arr = new Array<number>(20).fill(0);
      arr[0] = 0x52;
      arr[1] = 0x49;
      arr[2] = 0x46;
      arr[3] = 0x46;
      arr[8] = 0x57;
      arr[9] = 0x45;
      arr[10] = 0x42;
      arr[11] = 0x50;
      return arr;
    })();
    const decoded = __test.decodeThumbnailBytes(valid);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(__test.looksLikeWebp(decoded!)).toBe(true);
  });

  it('rejects non-arrays, short, oversized, and non-WebP payloads', () => {
    expect(__test.decodeThumbnailBytes('nope')).toBeNull();
    expect(__test.decodeThumbnailBytes([1, 2, 3])).toBeNull();
    expect(__test.decodeThumbnailBytes(new Array(__test.MAX_THUMBNAIL_BYTES + 1).fill(0x52))).toBeNull();
    // Right length, wrong magic.
    expect(__test.decodeThumbnailBytes(new Array(32).fill(0))).toBeNull();
  });
});

interface FakeIframe {
  el: HTMLIFrameElement;
  emit: (data: unknown, source?: Window | null) => void;
}

function makeFakeIframe(): FakeIframe {
  const el = document.createElement('iframe');
  el.style.position = 'fixed';
  el.style.left = '-100000px';
  document.body.appendChild(el);
  return {
    el,
    // Default the message source to the iframe's own contentWindow so the
    // DSS-CAND-016 sender check accepts it. Pass an explicit source to
    // exercise the rejection path.
    emit(data: unknown, source: Window | null = el.contentWindow) {
      window.dispatchEvent(new MessageEvent('message', { data, source }));
    },
  };
}

/**
 * Build a minimal, valid-looking WebP byte array (RIFF/WEBP magic + a
 * recognizable marker byte) so the capture's payload validation accepts
 * it. `marker` lets a test assert which payload was delivered.
 */
function webpBytes(marker: number, length = __test.MIN_THUMBNAIL_BYTES): number[] {
  const arr = new Array<number>(length).fill(0);
  arr[0] = 0x52; // R
  arr[1] = 0x49; // I
  arr[2] = 0x46; // F
  arr[3] = 0x46; // F
  arr[8] = 0x57; // W
  arr[9] = 0x45; // E
  arr[10] = 0x42; // B
  arr[11] = 0x50; // P
  arr[12] = marker & 0xff;
  return arr;
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

    const payload = webpBytes(33);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-1',
        status: 'ok',
        bytes: payload,
      });
    }, 0);

    await expect(captured).resolves.toEqual({
      slideId: 'slide-1',
      bytes: new Uint8Array(payload),
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

    const targetPayload = webpBytes(7);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'other-slide',
        status: 'ok',
        bytes: webpBytes(9),
      });
    }, 0);

    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-target',
        status: 'ok',
        bytes: targetPayload,
      });
    }, 5);

    await expect(promise).resolves.toEqual({
      slideId: 'slide-target',
      bytes: new Uint8Array(targetPayload),
    });
  });

  it('ignores messages whose source is not the capture iframe (DSS-CAND-016)', async () => {
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

    // A message that looks perfect but comes from another window/frame.
    setTimeout(() => {
      fake.emit(
        {
          __tag: __test.PROBE_MESSAGE_TAG,
          slideId: 'slide-1',
          status: 'ok',
          bytes: webpBytes(1),
        },
        window,
      );
    }, 0);
    // The genuine capture (from the iframe) lands shortly after and wins.
    const genuine = webpBytes(2);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-1',
        status: 'ok',
        bytes: genuine,
      });
    }, 10);

    await expect(promise).resolves.toEqual({
      slideId: 'slide-1',
      bytes: new Uint8Array(genuine),
    });
  });

  it('rejects an ok payload that is not a valid WebP (DSS-CAND-016)', async () => {
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
        status: 'ok',
        bytes: [11, 22, 33], // too short, wrong magic
      });
    }, 0);

    await expect(promise).rejects.toThrow(/invalid or oversized/);
  });

  it('rejects an ok payload that exceeds the size cap (DSS-CAND-016)', async () => {
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
        status: 'ok',
        bytes: webpBytes(1, __test.MAX_THUMBNAIL_BYTES + 1),
      });
    }, 0);

    await expect(promise).rejects.toThrow(/invalid or oversized/);
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
        // Marker byte lives at index 12 for fresh WebP captures; cache
        // hits store a raw single byte, so read index 0 there.
        onSlideReady: (slideId, bytes) =>
          ready.push([slideId, bytes.length > 12 ? (bytes[12] ?? -1) : (bytes[0] ?? -1)]),
        onSlideFailed: (failure) => failed.push(failure.slideId),
      },
    );

    // First slide is a cache hit — no probe required.
    // Second slide needs a real capture — emit a probe ok shortly after.
    const slideBPayload = webpBytes(99);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'slide-b',
        status: 'ok',
        bytes: slideBPayload,
      });
    }, 20);

    await queue;
    expect(ready).toEqual([
      ['slide-a', 42],
      ['slide-b', 99],
    ]);
    expect(failed).toEqual([]);
    expect(cache._store.get('slide-b')).toEqual(new Uint8Array(slideBPayload));
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
        bytes: webpBytes(7),
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
        bytes: webpBytes(1),
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
