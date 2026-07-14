/**
 * React hook that drives the client-side "Export PDF" flow for a loaded
 * deck.
 *
 * Pipeline (lazy — nothing runs until `exportPdf()` is called):
 *   1. Mount a hidden, sandboxed iframe.
 *   2. Rasterize every slide to a full-resolution PNG, serially, via the
 *      foreignObject capture probe (`slidePdfCapture.ts`).
 *   3. Assemble the PNGs into a one-slide-per-page PDF (`buildSlidesPdf`).
 *   4. Save it (browser download or Tauri "Save as").
 *
 * Availability: the capture probe relies on the loader having inlined the
 * deck's assets as `data:` URLs. Oversized decks streamed through the
 * service worker (`inlinedHtmlAvailable === false`) can't be captured this
 * way, so the hook reports `available: false` and the UI disables the
 * button with an explanatory tooltip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LoadedDeck } from '@slidestage/core/deck/types';
import { buildSlidesPdf, type SlidePdfPage } from './buildSlidesPdf';
import { savePdf } from './downloadPdf';
import { createPdfCaptureIframe, runSinglePdfCapture } from './slidePdfCapture';

export type DeckPdfExportPhase =
  | 'idle'
  | 'capturing'
  | 'assembling'
  | 'saving'
  | 'done'
  | 'error';

export interface DeckPdfExportApi {
  /** True when this deck can be exported (assets are inlined). */
  available: boolean;
  /** Coarse state machine for the export run. */
  phase: DeckPdfExportPhase;
  /** Convenience: true while a run is in flight. */
  busy: boolean;
  /** Slides captured so far in the current run. */
  current: number;
  /** Total slides to capture in the current run. */
  total: number;
  /** Last error message, surfaced while `phase === 'error'`. */
  error: string | null;
  /** Kick off an export run. No-op when unavailable or already busy. */
  exportPdf: () => void;
  /** Clear the error state (dismisses the visible failure notice). */
  dismissError: () => void;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function useDeckPdfExport(deck: LoadedDeck): DeckPdfExportApi {
  const [phase, setPhase] = useState<DeckPdfExportPhase>('idle');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const available = useMemo(() => {
    return (
      typeof document !== 'undefined' &&
      deck.inlinedHtmlAvailable &&
      deck.manifest.slides.length > 0
    );
  }, [deck.inlinedHtmlAvailable, deck.manifest.slides.length]);

  // Abort any in-flight run + reset visible state when the deck changes or
  // the host unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
    };
  }, [deck.fingerprint]);

  const exportPdf = useCallback(() => {
    if (!available || busyRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;

    const slides = deck.manifest.slides;
    const { width, height } = deck.manifest.dimensions;

    setPhase('capturing');
    setError(null);
    setCurrent(0);
    setTotal(slides.length);

    const iframe = createPdfCaptureIframe(width, height);
    document.body.appendChild(iframe);

    void (async () => {
      try {
        const pages: SlidePdfPage[] = [];
        for (let index = 0; index < slides.length; index += 1) {
          if (controller.signal.aborted) {
            throw new DOMException('aborted', 'AbortError');
          }
          const result = await runSinglePdfCapture(
            {
              // Use the array index as the correlation id so we never trip
              // the probe's slide-id safety check on odd manifest ids.
              slideId: `pdf-slide-${index}`,
              slideHtml: deck.slideHtml[index],
              width,
              height,
            },
            { iframe, signal: controller.signal },
          );
          pages.push({ png: result.bytes });
          setCurrent(index + 1);
        }

        if (controller.signal.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        setPhase('assembling');
        const pdfBytes = await buildSlidesPdf(pages, {
          pageWidth: width,
          pageHeight: height,
          title: deck.manifest.title,
        });

        if (controller.signal.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        setPhase('saving');
        await savePdf(pdfBytes, deck.manifest.title || deck.fileName);

        setPhase('done');
      } catch (err) {
        if (isAbortError(err)) {
          setPhase('idle');
          setCurrent(0);
          setTotal(0);
          return;
        }
        // eslint-disable-next-line no-console
        console.error('PDF export failed', err);
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      } finally {
        busyRef.current = false;
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        try {
          iframe.remove();
        } catch {
          // ignore — DOM may already be torn down
        }
      }
    })();
  }, [available, deck]);

  const dismissError = useCallback(() => {
    setError(null);
    setPhase((current) => (current === 'error' ? 'idle' : current));
  }, []);

  const busy = phase === 'capturing' || phase === 'assembling' || phase === 'saving';

  return { available, phase, busy, current, total, error, exportPdf, dismissError };
}
