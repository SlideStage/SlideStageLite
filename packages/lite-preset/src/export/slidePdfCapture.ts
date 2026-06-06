/**
 * Full-resolution slide rasterizer for PDF export.
 *
 * This is a sibling of the thumbnail capture pipeline
 * (`desktop/thumbnailCapture.ts`): it uses the same in-iframe SVG
 * `foreignObject` → `<canvas>` technique that already ships for
 * thumbnails, so it inherits the same trust model (runs entirely inside a
 * `sandbox="allow-scripts"` iframe with no extra capability grants, and
 * only works on slide HTML whose assets are already inlined as `data:`
 * URLs by the loader).
 *
 * It deliberately does NOT reuse the thumbnail module's hardened
 * (DSS-CAND-016) decode path, because the two have different
 * requirements:
 *   - Thumbnails: tiny down-scaled WebP (≤256 KiB), `number[]` payload.
 *   - PDF pages: full-resolution PNG (can be several MiB), transferred as
 *     a `Uint8Array` so the postMessage copy stays cheap.
 *
 * Each capture still validates the bytes it accepts (PNG magic + a
 * generous-but-bounded size cap) and the message sender, so a malicious
 * slide cannot make the parent embed arbitrary or unbounded payloads.
 */
import { slideIdIsSafe } from '../desktop/thumbnailCache';

export interface PdfCaptureRequest {
  /** Stable correlation id for this capture (use the slide array index). */
  slideId: string;
  /** Inlined slide HTML (assets already rewritten to `data:` URLs). */
  slideHtml: string;
  /** Logical slide width in CSS px (from `manifest.dimensions`). */
  width: number;
  /** Logical slide height in CSS px (from `manifest.dimensions`). */
  height: number;
}

export interface PdfCaptureResult {
  slideId: string;
  /** Encoded PNG bytes. */
  bytes: Uint8Array;
  /** Rasterized pixel width (logical × capture scale). */
  width: number;
  /** Rasterized pixel height (logical × capture scale). */
  height: number;
}

export interface PdfCaptureScaleOptions {
  /** Oversampling factor for crisp text. Default 2 (retina-like). */
  scale?: number;
  /** Hard cap on the longest output side, in px. Default 4096. */
  maxDim?: number;
}

/** Default oversampling factor (retina-like) for PDF page rasters. */
export const DEFAULT_CAPTURE_SCALE = 2;
/** Hard cap on the longest output side, bounding canvas memory. */
export const MAX_OUTPUT_DIM = 4096;

const SETTLE_MS = 350;
const TIMEOUT_MS = 15_000;

const PROBE_MESSAGE_TAG = 'slidestage:pdf-capture';

// Bound the bytes we accept back from the (untrusted) capture iframe. A
// 4096×2304 PNG is comfortably under this; the cap mainly stops a
// malicious slide from posting an unbounded payload.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MIN_IMAGE_BYTES = 8; // length of the PNG signature

/** Eight-byte PNG file signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Resolve the effective capture scale: oversample up to {@link scale} but
 * never let the longest output side exceed {@link maxDim} (so absurdly
 * large decks down-scale instead of exhausting canvas memory).
 */
export function computeCaptureScale(
  width: number,
  height: number,
  options: PdfCaptureScaleOptions = {},
): number {
  const scale = options.scale ?? DEFAULT_CAPTURE_SCALE;
  const maxDim = options.maxDim ?? MAX_OUTPUT_DIM;
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  const capped = Math.min(scale, maxDim / longest);
  return capped > 0 ? capped : 1;
}

/** True when `bytes` start with the 8-byte PNG signature. */
function looksLikePng(bytes: Uint8Array): boolean {
  if (bytes.length < MIN_IMAGE_BYTES) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Validate and normalize a probe `bytes` payload into a `Uint8Array`.
 * Returns null when the payload is the wrong type, out of size bounds, or
 * not a PNG — the caller then treats the capture as failed.
 */
export function decodePngBytes(raw: unknown): Uint8Array | null {
  let bytes: Uint8Array | null = null;
  if (raw instanceof Uint8Array) {
    bytes = raw;
  } else if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw);
  } else if (Array.isArray(raw)) {
    bytes = Uint8Array.from(raw, (value) =>
      typeof value === 'number' && value >= 0 ? value & 0xff : 0,
    );
  }
  if (!bytes) return null;
  if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) return null;
  return looksLikePng(bytes) ? bytes : null;
}

interface ProbeOutboundMessage {
  __tag: typeof PROBE_MESSAGE_TAG;
  slideId: string;
  status: 'ok' | 'error';
  bytes?: unknown;
  width?: number;
  height?: number;
  reason?: string;
}

/**
 * Inline probe script. Mirrors the thumbnail probe's foreignObject
 * rasterizer but encodes a full-resolution PNG and posts the bytes back
 * as a transferable `Uint8Array`.
 */
function probeScript(slideId: string, targetWidth: number, targetHeight: number): string {
  // language=javascript
  return `
    (function () {
      var SLIDE_ID = ${JSON.stringify(slideId)};
      var TARGET_W = ${targetWidth};
      var TARGET_H = ${targetHeight};
      var SETTLE_MS = ${SETTLE_MS};
      var TAG = ${JSON.stringify(PROBE_MESSAGE_TAG)};

      function report(payload, transfer) {
        try {
          parent.postMessage(
            Object.assign({ __tag: TAG, slideId: SLIDE_ID }, payload),
            '*',
            transfer || [],
          );
        } catch (err) {
          try {
            parent.postMessage(Object.assign({ __tag: TAG, slideId: SLIDE_ID }, payload), '*');
          } catch (err2) {
            // parent gone — nothing we can do
          }
        }
      }

      function fail(reason) {
        report({ status: 'error', reason: String(reason) });
      }

      function waitForAssets() {
        var imgPromises = Array.prototype.slice.call(document.images).map(function (img) {
          if (img.complete) return Promise.resolve();
          return new Promise(function (resolve) {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        });
        var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        return Promise.all([fonts].concat(imgPromises));
      }

      function cloneDocument() {
        var clone = document.documentElement.cloneNode(true);
        if (!clone.getAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        }
        clone.style.width = (document.documentElement.clientWidth || window.innerWidth) + 'px';
        clone.style.height = (document.documentElement.clientHeight || window.innerHeight) + 'px';
        return new XMLSerializer().serializeToString(clone);
      }

      function rasterize(svgUrl, srcWidth, srcHeight) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          var timeout = setTimeout(function () {
            reject(new Error('image load timeout'));
          }, ${Math.floor(TIMEOUT_MS / 2)});
          img.onload = function () {
            clearTimeout(timeout);
            try {
              var canvas = document.createElement('canvas');
              canvas.width = TARGET_W;
              canvas.height = TARGET_H;
              var ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('no 2d context'));
                return;
              }
              // White matte so transparent slides don't render black in
              // the PDF.
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, TARGET_W, TARGET_H);
              ctx.drawImage(img, 0, 0, srcWidth, srcHeight, 0, 0, TARGET_W, TARGET_H);
              canvas.toBlob(
                function (blob) {
                  if (!blob) {
                    reject(new Error('toBlob returned null'));
                    return;
                  }
                  blob.arrayBuffer().then(function (buf) {
                    resolve(new Uint8Array(buf));
                  }, reject);
                },
                'image/png',
              );
            } catch (err) {
              reject(err);
            }
          };
          img.onerror = function (event) {
            clearTimeout(timeout);
            reject(new Error('image load failed: ' + (event && event.message ? event.message : 'unknown')));
          };
          img.src = svgUrl;
        });
      }

      function capture(srcWidth, srcHeight) {
        var inner = cloneDocument();
        var svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' +
          srcWidth +
          '" height="' +
          srcHeight +
          '" viewBox="0 0 ' + srcWidth + ' ' + srcHeight + '">' +
          '<foreignObject x="0" y="0" width="' + srcWidth + '" height="' + srcHeight + '">' +
          inner +
          '</foreignObject>' +
          '</svg>';
        var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        return rasterize(url, srcWidth, srcHeight);
      }

      function run() {
        waitForAssets()
          .catch(function () {})
          .then(function () {
            return new Promise(function (resolve) { setTimeout(resolve, SETTLE_MS); });
          })
          .then(function () {
            var w = document.documentElement.clientWidth || window.innerWidth;
            var h = document.documentElement.clientHeight || window.innerHeight;
            return capture(w, h);
          })
          .then(function (bytes) {
            report({ status: 'ok', bytes: bytes, width: TARGET_W, height: TARGET_H }, [bytes.buffer]);
          })
          .catch(function (err) {
            fail((err && err.message) || err);
          });
      }

      if (document.readyState === 'complete') {
        run();
      } else {
        window.addEventListener('load', run, { once: true });
      }

      setTimeout(function () { fail('probe timeout'); }, ${TIMEOUT_MS});
    })();
  `;
}

/**
 * Inject the full-resolution capture probe into a slide HTML payload.
 * Returns a fresh srcdoc string suitable for `<iframe srcdoc>`.
 */
export function injectPdfCaptureProbe(
  slideHtml: string,
  slideId: string,
  targetWidth: number,
  targetHeight: number,
): string {
  if (!slideIdIsSafe(slideId)) {
    throw new Error(`slidePdfCapture: unsafe slideId "${slideId}"`);
  }
  const probe = `<script>${probeScript(slideId, targetWidth, targetHeight)}</script>`;
  const closingBody = /<\/body\s*>/i;
  if (closingBody.test(slideHtml)) {
    return slideHtml.replace(closingBody, `${probe}$&`);
  }
  return `${slideHtml}\n${probe}`;
}

interface CaptureContext {
  iframe: HTMLIFrameElement;
  signal: AbortSignal;
  scale?: number;
}

/**
 * Run a single full-resolution capture pass on a pre-mounted iframe. The
 * caller owns the iframe lifecycle; we swap its `srcdoc` and await the
 * probe's postMessage.
 */
export function runSinglePdfCapture(
  request: PdfCaptureRequest,
  ctx: CaptureContext,
): Promise<PdfCaptureResult> {
  return new Promise<PdfCaptureResult>((resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }

    const captureScale = computeCaptureScale(request.width, request.height, {
      scale: ctx.scale,
    });
    const targetWidth = Math.max(1, Math.round(request.width * captureScale));
    const targetHeight = Math.max(1, Math.round(request.height * captureScale));

    function teardown(): void {
      window.removeEventListener('message', onMessage);
      ctx.signal.removeEventListener('abort', onAbort);
      window.clearTimeout(timer);
    }

    function onMessage(event: MessageEvent): void {
      // Only accept messages from the capture iframe itself.
      if (event.source !== ctx.iframe.contentWindow) return;
      const data = event.data as ProbeOutboundMessage | undefined;
      if (!data || data.__tag !== PROBE_MESSAGE_TAG) return;
      if (data.slideId !== request.slideId) return;
      teardown();
      if (data.status === 'ok') {
        const bytes = decodePngBytes(data.bytes);
        if (!bytes) {
          reject(new Error('capture produced an invalid or oversized image'));
          return;
        }
        resolve({
          slideId: request.slideId,
          bytes,
          width: typeof data.width === 'number' ? data.width : targetWidth,
          height: typeof data.height === 'number' ? data.height : targetHeight,
        });
      } else {
        reject(new Error(data.reason ?? 'capture failed'));
      }
    }

    function onAbort(): void {
      teardown();
      reject(new DOMException('aborted', 'AbortError'));
    }

    const timer = window.setTimeout(() => {
      teardown();
      reject(new Error('capture timeout'));
    }, TIMEOUT_MS + 2_000);

    window.addEventListener('message', onMessage);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    ctx.iframe.style.width = `${request.width}px`;
    ctx.iframe.style.height = `${request.height}px`;
    ctx.iframe.srcdoc = injectPdfCaptureProbe(
      request.slideHtml,
      request.slideId,
      targetWidth,
      targetHeight,
    );
  });
}

/**
 * Build the hidden, off-screen, sandboxed iframe used to host capture
 * passes. Sized to logical slide dimensions; `runSinglePdfCapture`
 * resizes per request.
 */
export function createPdfCaptureIframe(width: number, height: number): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('title', 'pdf-export-capture-worker');
  // Same sandbox baseline as the playback + thumbnail iframes.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.contain = 'strict';
  return iframe;
}

/** Test-only export — surfaces internals for vitest. */
export const __test = {
  PROBE_MESSAGE_TAG,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_BYTES,
  looksLikePng,
  decodePngBytes,
  computeCaptureScale,
};
