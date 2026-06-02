/**
 * Headless thumbnail capture pipeline.
 *
 * Pipeline (per slide):
 *   1. Mount a hidden iframe in the main window sized to the deck's
 *      logical dimensions (typically 1920×1080).
 *   2. Feed it the already-inlined slide HTML, plus a small JS probe
 *      that calls `captureBitmap()` once fonts/images have settled.
 *   3. The probe posts the captured WebP bytes back to the parent via
 *      `window.postMessage`. We resolve the queue item and move on.
 *
 * Why an in-process iframe instead of a separate Tauri WebviewWindow:
 *   - In Tauri 2 a hidden WebviewWindow still spawns a full OS window
 *     and triggers macOS focus/space transitions on creation; an
 *     off-screen iframe is invisible to the user and shares the same
 *     renderer subtree.
 *   - The slide HTML we feed it has already been rewritten so every
 *     internal asset is a `data:` URL (see `loadDeck.createSlideContents`),
 *     so foreignObject rendering works without same-origin escalation.
 *
 * The probe is kept TINY and dependency-free — it must run inside the
 * sandbox=allow-scripts iframe with no extra capability grants.
 */
import { slideIdIsSafe, type ThumbnailCache } from './thumbnailCache';

export interface CaptureRequest {
  slideId: string;
  slideHtml: string;
  width: number;
  height: number;
}

export interface CaptureResult {
  slideId: string;
  bytes: Uint8Array;
}

export interface CaptureFailure {
  slideId: string;
  reason: string;
}

const TARGET_WIDTH = 480;
const TARGET_HEIGHT = 270;
const QUALITY = 0.85;
const SETTLE_MS = 320;
const TIMEOUT_MS = 8_000;

const PROBE_MESSAGE_TAG = 'slidestage:thumbnail-capture';

// DSS-CAND-016: bound the bytes we accept from the (untrusted) capture
// iframe. The probe and any author script share that window, so a
// malicious slide can post messages; we can't fully attribute them, but
// we can refuse anything that isn't a small WebP. Upper bound matches the
// Rust cache's per-entry limit (256 KiB) so a capture we accept always
// fits the on-disk cache; lower bound covers the 12-byte RIFF/WEBP header.
const MAX_THUMBNAIL_BYTES = 256 * 1024;
const MIN_THUMBNAIL_BYTES = 16;

/** True when `bytes` start with the RIFF/WEBP container magic. */
function looksLikeWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= MIN_THUMBNAIL_BYTES &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46 && // 'F'
    bytes[8] === 0x57 && // 'W'
    bytes[9] === 0x45 && // 'E'
    bytes[10] === 0x42 && // 'B'
    bytes[11] === 0x50 // 'P'
  );
}

/**
 * Validate and decode the probe's `bytes` payload. Returns null when the
 * payload is missing, the wrong type, out of size bounds, or not a WebP —
 * the caller then treats the capture as failed rather than caching garbage.
 */
function decodeThumbnailBytes(raw: unknown): Uint8Array | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < MIN_THUMBNAIL_BYTES || raw.length > MAX_THUMBNAIL_BYTES) return null;
  const bytes = Uint8Array.from(raw, (value) =>
    typeof value === 'number' && value >= 0 ? value & 0xff : 0,
  );
  return looksLikeWebp(bytes) ? bytes : null;
}

interface ProbeOutboundMessage {
  __tag: typeof PROBE_MESSAGE_TAG;
  slideId: string;
  status: 'ok' | 'error';
  /** Present when status === 'ok'. */
  bytes?: number[];
  /** Present when status === 'error'. */
  reason?: string;
}

/**
 * Inline probe script. We string-escape on injection so the slide HTML
 * (which can contain `</script>` etc) doesn't break parsing.
 */
function probeScript(slideId: string): string {
  // language=javascript
  const source = `
    (function () {
      var SLIDE_ID = ${JSON.stringify(slideId)};
      var TARGET_W = ${TARGET_WIDTH};
      var TARGET_H = ${TARGET_HEIGHT};
      var QUALITY = ${QUALITY};
      var SETTLE_MS = ${SETTLE_MS};
      var TAG = ${JSON.stringify(PROBE_MESSAGE_TAG)};

      function report(payload) {
        try {
          parent.postMessage(Object.assign({ __tag: TAG, slideId: SLIDE_ID }, payload), '*');
        } catch (err) {
          // parent gone — nothing we can do
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
        // foreignObject needs XHTML-compatible markup: every void
        // element ("<meta>", "<link>", "<br>", "<img>" ...) MUST be
        // self-closed, and the root must declare the XHTML namespace.
        // Plain outerHTML breaks both rules and the SVG image load
        // silently fails — we use XMLSerializer (which handles void
        // tags and quoting) and force the xmlns onto the clone.
        var clone = document.documentElement.cloneNode(true);
        if (!clone.getAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        }
        // Inline computed dimensions so the foreignObject canvas
        // doesn't collapse to 0×0 if the deck's CSS targets <html>.
        clone.style.width = (document.documentElement.clientWidth || window.innerWidth) + 'px';
        clone.style.height = (document.documentElement.clientHeight || window.innerHeight) + 'px';
        return new XMLSerializer().serializeToString(clone);
      }

      function rasterize(svgUrl, width, height) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          // crossOrigin only matters for HTTP-loaded assets — for
          // data: URLs leaving it unset avoids tainting the canvas
          // on some WKWebView builds.
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
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, TARGET_W, TARGET_H);
              // Source rect uses the SVG's intrinsic size (width/height)
              // so non-16:9 decks letterbox cleanly into the target.
              ctx.drawImage(img, 0, 0, width, height, 0, 0, TARGET_W, TARGET_H);
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
                'image/webp',
                QUALITY,
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

      function capture(width, height) {
        var inner = cloneDocument();
        // foreignObject demands XHTML-namespaced children (handled by
        // cloneDocument above). The outer SVG sets its own width/height
        // so img.naturalWidth/Height matches the deck's logical canvas.
        var svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' +
          width +
          '" height="' +
          height +
          '" viewBox="0 0 ' + width + ' ' + height + '">' +
          '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">' +
          inner +
          '</foreignObject>' +
          '</svg>';
        var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        return rasterize(url, width, height);
      }

      function run() {
        waitForAssets()
          .catch(function () {
            // best-effort: never let an asset error stall capture
          })
          .then(function () {
            return new Promise(function (resolve) { setTimeout(resolve, SETTLE_MS); });
          })
          .then(function () {
            var w = document.documentElement.clientWidth || window.innerWidth;
            var h = document.documentElement.clientHeight || window.innerHeight;
            return capture(w, h);
          })
          .then(function (bytes) {
            report({ status: 'ok', bytes: Array.prototype.slice.call(bytes) });
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

      // Visible sanity-check: never let the probe stall forever.
      setTimeout(function () { fail('probe timeout'); }, ${TIMEOUT_MS});
    })();
  `;
  return source;
}

/**
 * Inject the capture probe into a slide HTML payload. Returns a fresh
 * srcdoc string suitable for `<iframe srcdoc>`.
 */
export function injectCaptureProbe(slideHtml: string, slideId: string): string {
  if (!slideIdIsSafe(slideId)) {
    throw new Error(`thumbnailCapture: unsafe slideId "${slideId}"`);
  }
  const probe = `<script>${probeScript(slideId)}</script>`;
  // Prefer injecting right before </body>; fall back to appending so
  // we always run after the deck's own scripts.
  const closingBody = /<\/body\s*>/i;
  if (closingBody.test(slideHtml)) {
    return slideHtml.replace(closingBody, `${probe}$&`);
  }
  return `${slideHtml}\n${probe}`;
}

interface CaptureContext {
  iframe: HTMLIFrameElement;
  signal: AbortSignal;
}

/**
 * Run a single capture pass on a pre-mounted iframe. Caller owns the
 * iframe lifecycle (mount / unmount); we just swap the srcdoc and
 * await the probe's postMessage.
 */
export function runSingleCapture(
  request: CaptureRequest,
  ctx: CaptureContext,
): Promise<CaptureResult> {
  return new Promise<CaptureResult>((resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }

    function teardown() {
      window.removeEventListener('message', onMessage);
      ctx.signal.removeEventListener('abort', onAbort);
      window.clearTimeout(timer);
    }

    function onMessage(event: MessageEvent) {
      // DSS-CAND-016: ignore messages that did not come from the capture
      // iframe itself. The probe and any author script share this window,
      // so this does NOT stop a malicious slide from forging its own
      // thumbnail (bounded below by validating the payload), but it does
      // reject messages from any other frame/window on the page.
      if (event.source !== ctx.iframe.contentWindow) return;
      const data = event.data as ProbeOutboundMessage | undefined;
      if (!data || data.__tag !== PROBE_MESSAGE_TAG) return;
      if (data.slideId !== request.slideId) return;
      teardown();
      if (data.status === 'ok') {
        const bytes = decodeThumbnailBytes(data.bytes);
        if (!bytes) {
          reject(new Error('capture produced an invalid or oversized image'));
          return;
        }
        resolve({ slideId: request.slideId, bytes });
      } else {
        reject(new Error(data.reason ?? 'capture failed'));
      }
    }

    function onAbort() {
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
    ctx.iframe.srcdoc = injectCaptureProbe(request.slideHtml, request.slideId);
  });
}

export interface CaptureQueueOptions {
  cache: ThumbnailCache;
  fingerprint: string;
  signal?: AbortSignal;
  /** Called whenever a slide finishes (cache hit or fresh capture). */
  onSlideReady?: (slideId: string, bytes: Uint8Array) => void;
  /** Called on per-slide failures; queue continues with the next slide. */
  onSlideFailed?: (failure: CaptureFailure) => void;
}

/**
 * Drive the capture pipeline for a list of slides. Cache hits are
 * surfaced immediately via `onSlideReady` and skipped; remaining slides
 * are captured serially against the supplied iframe.
 *
 * The function resolves once every slide has either been delivered or
 * failed. Aborting the signal stops the loop after the current capture.
 */
export async function runCaptureQueue(
  iframe: HTMLIFrameElement,
  requests: CaptureRequest[],
  options: CaptureQueueOptions,
): Promise<void> {
  const signal = options.signal ?? new AbortController().signal;

  for (const request of requests) {
    if (signal.aborted) return;

    try {
      const cached = await options.cache.read(options.fingerprint, request.slideId);
      if (cached) {
        options.onSlideReady?.(request.slideId, cached);
        continue;
      }
    } catch (err) {
      options.onSlideFailed?.({
        slideId: request.slideId,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (signal.aborted) return;

    try {
      const result = await runSingleCapture(request, { iframe, signal });
      await options.cache.write(options.fingerprint, result.slideId, result.bytes);
      options.onSlideReady?.(result.slideId, result.bytes);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      options.onSlideFailed?.({
        slideId: request.slideId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Test-only export — surfaces internals for vitest. */
export const __test = {
  TARGET_WIDTH,
  TARGET_HEIGHT,
  PROBE_MESSAGE_TAG,
  MAX_THUMBNAIL_BYTES,
  MIN_THUMBNAIL_BYTES,
  looksLikeWebp,
  decodeThumbnailBytes,
};
