/**
 * React hook that wires the headless thumbnail capture pipeline to a
 * loaded deck.
 *
 * Behaviour matrix:
 *   - Web build (no Tauri host): returns deck.thumbnailUrls unchanged
 *     and reports status='noop'. Captures would have nowhere to live.
 *   - Tauri build: mounts a hidden iframe off-screen, walks every slide
 *     whose manifest thumbnail is null, and fills it in either from the
 *     side-car cache or from a fresh capture. Captures stream in: each
 *     slide flips from null → object URL as soon as it lands.
 *
 * The hook also cleans up: aborting the queue on unmount/deck change,
 * revoking every object URL we minted, and removing the iframe from the
 * DOM. Consumers can treat the returned `thumbnailUrls` as immediately
 * usable for `<img src=...>`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { LoadedDeck } from '@slidestage/core/deck/types';
import { isTauri } from './env';
import {
  runCaptureQueue,
  type CaptureFailure,
  type CaptureRequest,
} from './thumbnailCapture';
import {
  pickThumbnailCache,
  thumbnailBytesToObjectUrl,
  type ThumbnailCache,
} from './thumbnailCache';

export type ThumbnailCaptureStatus = 'noop' | 'idle' | 'capturing' | 'done';

export interface ThumbnailCaptureState {
  /** Per-slide src URL aligned with `deck.manifest.slides[i]`. */
  thumbnailUrls: Array<string | null>;
  status: ThumbnailCaptureStatus;
  capturedCount: number;
  failedCount: number;
  totalToCapture: number;
  failures: CaptureFailure[];
}

interface UseThumbnailCaptureOptions {
  /** Override the cache backend (test seam). Defaults to runtime pick. */
  cache?: ThumbnailCache;
  /** Skip the Tauri runtime gate (test seam). */
  force?: boolean;
}

declare global {
  interface Window {
    /**
     * Dev-only flag: when set BEFORE the deck loads, the capture pipeline
     * runs in the browser even outside Tauri. Used by the chromium e2e
     * test to exercise the foreignObject rasterizer end-to-end.
     * Production builds ignore this flag entirely.
     */
    __slidestageForceThumbnailCapture?: boolean;
  }
}

function devForceCapture(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return Boolean(window.__slidestageForceThumbnailCapture);
}

/**
 * Pull missing thumbnails into the React tree. Idempotent: re-renders
 * with the same deck don't re-run captures because cache hits short-
 * circuit immediately.
 */
export function useThumbnailCapture(
  deck: LoadedDeck,
  options: UseThumbnailCaptureOptions = {},
): ThumbnailCaptureState {
  const slides = deck.manifest.slides;
  const baseUrls = deck.thumbnailUrls;

  // Captured object URLs, keyed by slide.id. Kept separate from
  // baseUrls so we know which URLs to revoke on cleanup.
  const [captured, setCaptured] = useState<Map<string, string>>(() => new Map());
  const [failures, setFailures] = useState<CaptureFailure[]>([]);
  const [status, setStatus] = useState<ThumbnailCaptureStatus>('idle');

  const cache = options.cache ?? pickThumbnailCache();
  const allowCapture = options.force ?? (isTauri() || devForceCapture());

  // Track URLs minted by this hook instance so unmount can revoke them.
  // Using a ref (not state) because we don't want revocation to trigger
  // re-renders — it's strictly a side-effect.
  const mintedRef = useRef<string[]>([]);

  const pendingRequests = useMemo<CaptureRequest[]>(() => {
    return slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide, index }) => baseUrls[index] == null && !captured.has(slide.id))
      .map(({ slide, index }) => ({
        slideId: slide.id,
        slideHtml: deck.slideHtml[index],
        width: deck.manifest.dimensions.width,
        height: deck.manifest.dimensions.height,
      }));
    // We deliberately omit `captured` from deps — adding it would cause
    // the queue to restart every time a slide finishes. The pipeline
    // already skips slides that fall into `captured` via the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, slides, baseUrls]);

  useEffect(() => {
    if (!allowCapture) {
      setStatus('noop');
      return;
    }
    if (pendingRequests.length === 0) {
      setStatus('done');
      return;
    }

    setStatus('capturing');
    const controller = new AbortController();
    const iframe = createCaptureIframe();
    document.body.appendChild(iframe);

    runCaptureQueue(iframe, pendingRequests, {
      cache,
      fingerprint: deck.fingerprint,
      signal: controller.signal,
      onSlideReady: (slideId, bytes) => {
        const url = thumbnailBytesToObjectUrl(bytes);
        mintedRef.current.push(url);
        setCaptured((prev) => {
          if (prev.has(slideId)) {
            URL.revokeObjectURL(url);
            return prev;
          }
          const next = new Map(prev);
          next.set(slideId, url);
          return next;
        });
      },
      onSlideFailed: (failure) => {
        setFailures((prev) => [...prev, failure]);
      },
    })
      .catch((err) => {
        if ((err as DOMException)?.name === 'AbortError') return;
        // Bubble up as a sentinel failure so the UI can surface it.
        setFailures((prev) => [
          ...prev,
          { slideId: '__queue__', reason: err instanceof Error ? err.message : String(err) },
        ]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setStatus('done');
        }
        try {
          iframe.remove();
        } catch {
          // ignore — DOM may already be torn down
        }
      });

    return () => {
      controller.abort();
      try {
        iframe.remove();
      } catch {
        // ignore
      }
    };
  }, [allowCapture, cache, deck.fingerprint, pendingRequests]);

  // Tear down minted URLs when the deck swaps or the host unmounts.
  useEffect(() => {
    return () => {
      for (const url of mintedRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      mintedRef.current = [];
    };
  }, [deck.fingerprint]);

  const thumbnailUrls = useMemo(() => {
    return slides.map((slide, index) => baseUrls[index] ?? captured.get(slide.id) ?? null);
  }, [slides, baseUrls, captured]);

  return {
    thumbnailUrls,
    status,
    capturedCount: captured.size,
    failedCount: failures.length,
    totalToCapture: pendingRequests.length + captured.size,
    failures,
  };
}

function createCaptureIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('title', 'thumbnail-capture-worker');
  // Same sandbox baseline as the playback iframes — capture probe runs
  // entirely within the iframe and only posts results back over the
  // standard `window.postMessage` channel.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = '1920px';
  iframe.style.height = '1080px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.contain = 'strict';
  return iframe;
}
