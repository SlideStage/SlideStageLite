/**
 * Pure helpers used by the viewer/presenter UI. Zero React, zero global
 * lookups: every function takes its inputs explicitly so callers can
 * swap deck shape or sandbox tokens without monkey-patching.
 *
 * Lives in `@slidestage/ui` so Pro presets can reuse the exact same
 * eraser hit-test / srcdoc decision as Lite.
 */
import { sandboxAllowsSameOrigin } from '@slidestage/core/deck/trustCapabilities';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import type { Point, Stroke } from '../presenter/types';

/**
 * Shortest distance from `point` to the line segment `start..end`.
 * Used by the eraser hit-test below.
 */
export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * True if `point` falls within the eraser tolerance of any segment of
 * `stroke`. Tolerance scales with the stroke width but never below 18
 * logical px so thin annotation strokes are still grabbable.
 */
export function strokeHitTest(stroke: Stroke, point: Point): boolean {
  const tolerance = Math.max(stroke.width, 18);
  return stroke.points.some((start, index) => {
    const end = stroke.points[index + 1];
    return end ? distanceToSegment(point, start, end) <= tolerance : false;
  });
}

/**
 * Format a wall-clock duration as `MM:SS` (zero-padded). Negative or
 * sub-second inputs collapse to `00:00`.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export interface ChooseUseSrcdocOptions {
  deck: Pick<LoadedDeck, 'inlinedHtmlAvailable' | 'prefersSrcdoc'>;
  isTauriHost: boolean;
  iframeSandbox: string | undefined;
}

/**
 * Decide whether the active slide iframe should be mounted via
 * `srcdoc={slideHtml[i]}` (true) or `src={slideUrls[i]}` (false).
 *
 * Mirrors the rationale documented inline at the original
 * `DeckViewer.tsx` callsite — see Phase 4b plan for the full table.
 */
export function chooseUseSrcdoc({
  deck,
  isTauriHost,
  iframeSandbox,
}: ChooseUseSrcdocOptions): boolean {
  return (
    deck.inlinedHtmlAvailable &&
    (isTauriHost || deck.prefersSrcdoc || !sandboxAllowsSameOrigin(iframeSandbox))
  );
}
