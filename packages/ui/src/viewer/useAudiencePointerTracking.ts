import { useEffect, useState, type RefObject } from 'react';
import type { Tool } from '../presenter/types';
import type { AudiencePointer } from '../presenter/usePresentationSync';

export interface UseAudiencePointerTrackingOptions {
  /**
   * Container that wraps the active `.logical-stage`. Pointer events
   * are subscribed on this host so the hook can ignore events that
   * fire outside the deck (sidebar / toolbars / etc).
   */
  hostRef: RefObject<HTMLElement | null>;
  /**
   * Current presenter tool. Pointer tracking only activates for the
   * two follow-the-presenter tools (`laser`, `spotlight`); every other
   * tool collapses the result to `null`.
   */
  presenterTool: Tool;
  /**
   * Logical deck dimensions (1920×1080 by default). The hook returns
   * normalized coordinates in this space so audience renderers can
   * apply their own scale transform.
   */
  deckDimensions: { width: number; height: number };
}

/**
 * Track the presenter's pointer position relative to the active slide
 * stage and return it as an {@link AudiencePointer} suitable for
 * broadcasting over the presentation sync transport.
 *
 * Returns `null` whenever the current tool isn't a follow tool or the
 * pointer is outside the logical-stage bounds.
 */
export function useAudiencePointerTracking({
  hostRef,
  presenterTool,
  deckDimensions,
}: UseAudiencePointerTrackingOptions): AudiencePointer | null {
  const [audiencePointer, setAudiencePointer] = useState<AudiencePointer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const activeTool =
      presenterTool === 'laser' || presenterTool === 'spotlight' ? presenterTool : null;
    if (!host || !activeTool) {
      setAudiencePointer(null);
      return undefined;
    }

    const onMove = (event: PointerEvent): void => {
      const logicalStage = host.querySelector<HTMLElement>('.logical-stage');
      if (!logicalStage) {
        return;
      }
      const rect = logicalStage.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        setAudiencePointer(null);
        return;
      }
      setAudiencePointer({
        tool: activeTool,
        point: {
          x: ((event.clientX - rect.left) / rect.width) * deckDimensions.width,
          y: ((event.clientY - rect.top) / rect.height) * deckDimensions.height,
        },
      });
    };
    const onLeave = (): void => setAudiencePointer(null);

    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [deckDimensions.height, deckDimensions.width, hostRef, presenterTool]);

  return audiencePointer;
}
