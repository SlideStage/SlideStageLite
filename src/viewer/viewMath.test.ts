/**
 * Pure viewer-math helpers extracted in Phase 4b. These functions used
 * to live inline at the top of `DeckViewer.tsx`; pin their behavior
 * here so future renderer rewrites (Pro pres mode, embedded viewer)
 * don't silently drift.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseUseSrcdoc,
  distanceToSegment,
  formatElapsed,
  strokeHitTest,
} from '@slidestage/ui/viewer/viewMath';
import type { Stroke } from '@slidestage/ui/presenter/types';

describe('distanceToSegment', () => {
  it('returns the literal distance when start == end', () => {
    const d = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(d).toBeCloseTo(5);
  });

  it('returns 0 for a point on the segment interior', () => {
    const d = distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(0);
  });

  it('clamps to the nearest endpoint when the projection escapes the segment', () => {
    // Point lies beyond the right endpoint; expect the distance to (10,0).
    const d = distanceToSegment({ x: 14, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(4);
  });
});

function strokeAtPoints(points: Array<{ x: number; y: number }>, width = 8): Stroke {
  return { tool: 'pen', color: '#000', width, points };
}

describe('strokeHitTest', () => {
  it('returns false for a single-point stroke (no segments)', () => {
    const stroke = strokeAtPoints([{ x: 0, y: 0 }]);
    expect(strokeHitTest(stroke, { x: 0, y: 0 })).toBe(false);
  });

  it('returns true when the point is within the eraser tolerance band', () => {
    const stroke = strokeAtPoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(strokeHitTest(stroke, { x: 50, y: 5 })).toBe(true);
  });

  it('respects a minimum tolerance of 18 px even for thin strokes', () => {
    const thin = strokeAtPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      2,
    );
    // 12 px above the segment is outside the literal stroke width but
    // within the eraser's minimum tolerance of 18.
    expect(strokeHitTest(thin, { x: 50, y: 12 })).toBe(true);
    // 20 px away is outside the minimum tolerance band.
    expect(strokeHitTest(thin, { x: 50, y: 20 })).toBe(false);
  });
});

describe('formatElapsed', () => {
  it('formats whole minutes as MM:00', () => {
    expect(formatElapsed(60_000)).toBe('01:00');
  });

  it('zero-pads single-digit seconds', () => {
    expect(formatElapsed(5_000)).toBe('00:05');
  });

  it('clamps negative durations to 00:00', () => {
    expect(formatElapsed(-1)).toBe('00:00');
  });
});

describe('chooseUseSrcdoc', () => {
  const baseDeck = { inlinedHtmlAvailable: true, prefersSrcdoc: false };

  it('returns true under Tauri whenever inlined HTML is available', () => {
    expect(
      chooseUseSrcdoc({ deck: baseDeck, isTauriHost: true, iframeSandbox: 'allow-scripts' }),
    ).toBe(true);
  });

  it('returns false when the deck never inlined srcdoc (oversized path)', () => {
    expect(
      chooseUseSrcdoc({
        deck: { inlinedHtmlAvailable: false, prefersSrcdoc: true },
        isTauriHost: true,
        iframeSandbox: undefined,
      }),
    ).toBe(false);
  });

  it('returns true on Web when the sandbox lacks allow-same-origin', () => {
    expect(
      chooseUseSrcdoc({
        deck: baseDeck,
        isTauriHost: false,
        iframeSandbox: 'allow-scripts',
      }),
    ).toBe(true);
  });

  it('returns false on Web when the sandbox carries allow-same-origin', () => {
    expect(
      chooseUseSrcdoc({
        deck: baseDeck,
        isTauriHost: false,
        iframeSandbox: 'allow-scripts allow-same-origin',
      }),
    ).toBe(false);
  });

  it('honours the deck-level `prefersSrcdoc` hint on Web', () => {
    expect(
      chooseUseSrcdoc({
        deck: { inlinedHtmlAvailable: true, prefersSrcdoc: true },
        isTauriHost: false,
        iframeSandbox: 'allow-scripts allow-same-origin',
      }),
    ).toBe(true);
  });
});
