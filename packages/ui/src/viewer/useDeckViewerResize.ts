import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/**
 * Snapshot of the container's geometry at pointer-down. The hook reads
 * the rect once when the drag begins so subsequent layout shifts (e.g.
 * the user resizing the window mid-drag) don't yank the divider around.
 */
export interface DeckViewerResizeOptions {
  /**
   * Reference to the container whose rect we measure against. For the
   * presenter "side rail" divider this is the `.presenter-view-body`;
   * for the notes-height divider it is the `.viewer` root element.
   */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * 'horizontal' = the divider drags left/right and we report a width
   * measured from `rect.right` (i.e. distance to the right edge).
   * 'vertical' = the divider drags up/down and we report a height
   * measured from `rect.bottom`.
   */
  axis: 'horizontal' | 'vertical';
  /**
   * Called with the next integer px size on every pointer move. The
   * caller is responsible for clamping / persistence.
   */
  setSize: (next: number) => void;
}

/**
 * Generic divider drag handler. Wraps the boilerplate of:
 *   1. capturing the pointer to the divider element,
 *   2. listening to window-level pointer move/up/cancel events,
 *   3. computing the new size from the container's static rect,
 *   4. releasing capture and tearing down listeners on up/cancel.
 *
 * Returns a `onPointerDown` handler ready to attach to the divider's
 * `<div role="separator">`. Designed to be called from inside a React
 * component; the returned handler is memoized against `containerRef`,
 * `axis`, and `setSize` so re-renders don't churn the listener
 * registration.
 */
export function useDeckViewerResize({
  containerRef,
  axis,
  setSize,
}: DeckViewerResizeOptions): (event: ReactPointerEvent<HTMLDivElement>) => void {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pointerId = event.pointerId;
      const handleEl = event.currentTarget;

      const onMove = (e: PointerEvent): void => {
        if (axis === 'horizontal') {
          setSize(Math.round(rect.right - e.clientX));
        } else {
          setSize(Math.round(rect.bottom - e.clientY));
        }
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          handleEl?.releasePointerCapture?.(pointerId);
        } catch {
          // ignore
        }
      };

      try {
        handleEl.setPointerCapture(pointerId);
      } catch {
        // ignore
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [axis, containerRef, setSize],
  );
}
