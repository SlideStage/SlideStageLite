import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __test,
  computeCaptureScale,
  injectPdfCaptureProbe,
  runSinglePdfCapture,
} from '@slidestage/lite-preset/export/slidePdfCapture';

/** Build a minimal, valid-looking PNG payload (8-byte signature + filler). */
function pngBytes(marker = 0, length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[8] = marker & 0xff;
  return bytes;
}

describe('computeCaptureScale', () => {
  it('oversamples small/standard decks up to the default 2x', () => {
    expect(computeCaptureScale(1920, 1080)).toBe(2);
    expect(computeCaptureScale(1280, 720)).toBe(2);
  });

  it('down-scales decks whose oversampled side would exceed the cap', () => {
    // 8000 * 2 = 16000 > 4096 → scale clamps to 4096/8000.
    expect(computeCaptureScale(8000, 4500)).toBeCloseTo(4096 / 8000, 5);
  });

  it('is defensive about degenerate dimensions', () => {
    expect(computeCaptureScale(0, 0)).toBe(1);
    expect(computeCaptureScale(Number.NaN, 100)).toBe(1);
  });
});

describe('decodePngBytes', () => {
  it('accepts a Uint8Array with the PNG signature', () => {
    const decoded = __test.decodePngBytes(pngBytes(7));
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(__test.looksLikePng(decoded!)).toBe(true);
  });

  it('accepts an ArrayBuffer payload', () => {
    const decoded = __test.decodePngBytes(pngBytes(1).buffer);
    expect(decoded).toBeInstanceOf(Uint8Array);
  });

  it('rejects wrong-type, too-short, oversized, and non-PNG payloads', () => {
    expect(__test.decodePngBytes('nope')).toBeNull();
    expect(__test.decodePngBytes(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(
      __test.decodePngBytes(new Uint8Array(__test.MAX_IMAGE_BYTES + 1)),
    ).toBeNull();
    // Right length, wrong magic.
    expect(__test.decodePngBytes(new Uint8Array(32))).toBeNull();
  });
});

describe('injectPdfCaptureProbe', () => {
  it('appends the probe right before </body>', () => {
    const html = '<!doctype html><html><body><h1>hi</h1></body></html>';
    const out = injectPdfCaptureProbe(html, 'pdf-slide-0', 100, 60);
    expect(out).toMatch(/<script>[\s\S]*<\/script><\/body>/);
    expect(out).toContain('pdf-slide-0');
    expect(out).toContain(__test.PROBE_MESSAGE_TAG);
  });

  it('falls back to append when there is no body tag', () => {
    const out = injectPdfCaptureProbe('<p>no body</p>', 'pdf-slide-1', 10, 10);
    expect(out.startsWith('<p>no body</p>')).toBe(true);
    expect(out).toContain(__test.PROBE_MESSAGE_TAG);
  });

  it('rejects unsafe slide ids', () => {
    expect(() => injectPdfCaptureProbe('<html></html>', '../bad', 10, 10)).toThrow(
      /unsafe slideId/,
    );
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
    emit(data: unknown, source: Window | null = el.contentWindow) {
      window.dispatchEvent(new MessageEvent('message', { data, source }));
    },
  };
}

describe('runSinglePdfCapture', () => {
  let fake: FakeIframe;
  beforeEach(() => {
    fake = makeFakeIframe();
  });
  afterEach(() => {
    fake.el.remove();
  });

  it('resolves with decoded bytes when the probe reports ok', async () => {
    const controller = new AbortController();
    const captured = runSinglePdfCapture(
      { slideId: 'pdf-slide-0', slideHtml: '<html><body>hi</body></html>', width: 1920, height: 1080 },
      { iframe: fake.el, signal: controller.signal },
    );

    const payload = pngBytes(42);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'pdf-slide-0',
        status: 'ok',
        bytes: payload,
        width: 3840,
        height: 2160,
      });
    }, 0);

    const result = await captured;
    expect(result.slideId).toBe('pdf-slide-0');
    expect(result.bytes).toEqual(payload);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
  });

  it('rejects when the probe reports an error', async () => {
    const controller = new AbortController();
    const promise = runSinglePdfCapture(
      { slideId: 'pdf-slide-0', slideHtml: '<html></html>', width: 100, height: 100 },
      { iframe: fake.el, signal: controller.signal },
    );
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'pdf-slide-0',
        status: 'error',
        reason: 'no 2d context',
      });
    }, 0);
    await expect(promise).rejects.toThrow(/no 2d context/);
  });

  it('rejects an ok payload that is not a valid PNG', async () => {
    const controller = new AbortController();
    const promise = runSinglePdfCapture(
      { slideId: 'pdf-slide-0', slideHtml: '<html></html>', width: 100, height: 100 },
      { iframe: fake.el, signal: controller.signal },
    );
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'pdf-slide-0',
        status: 'ok',
        bytes: new Uint8Array([1, 2, 3]),
      });
    }, 0);
    await expect(promise).rejects.toThrow(/invalid or oversized/);
  });

  it('ignores messages whose source is not the capture iframe', async () => {
    const controller = new AbortController();
    const promise = runSinglePdfCapture(
      { slideId: 'pdf-slide-0', slideHtml: '<html></html>', width: 100, height: 100 },
      { iframe: fake.el, signal: controller.signal },
    );
    // Forged message from another window — must be ignored.
    setTimeout(() => {
      fake.emit(
        {
          __tag: __test.PROBE_MESSAGE_TAG,
          slideId: 'pdf-slide-0',
          status: 'ok',
          bytes: pngBytes(1),
        },
        window,
      );
    }, 0);
    const genuine = pngBytes(2);
    setTimeout(() => {
      fake.emit({
        __tag: __test.PROBE_MESSAGE_TAG,
        slideId: 'pdf-slide-0',
        status: 'ok',
        bytes: genuine,
      });
    }, 10);
    const result = await promise;
    expect(result.bytes).toEqual(genuine);
  });

  it('rejects when aborted', async () => {
    const controller = new AbortController();
    const promise = runSinglePdfCapture(
      { slideId: 'pdf-slide-0', slideHtml: '<html></html>', width: 100, height: 100 },
      { iframe: fake.el, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 0);
    await expect(promise).rejects.toThrow(/aborted/);
  });
});
