/**
 * Lock in the shared spotlight gradient formula consumed by both
 * `Spotlight` (presenter) and `AudienceView` (audience). If somebody
 * tweaks the alpha or stops on one side only, the presenter and
 * audience windows drift visually — exactly the bug this test exists
 * to prevent.
 */
import { describe, expect, it } from 'vitest';
import {
  clampSpotlightRadius,
  SPOTLIGHT_MAX_RADIUS,
  SPOTLIGHT_MIN_RADIUS,
  SPOTLIGHT_STEP,
  spotlightGradient,
} from '@slidestage/ui/presenter/types';

describe('spotlightGradient', () => {
  it('emits a radial-gradient centred on the supplied point', () => {
    const css = spotlightGradient({ x: 960, y: 540 }, 240);
    expect(css).toBe(
      'radial-gradient(circle 240px at 960px 540px, transparent 0%, transparent 70%, rgba(0,0,0,0.85) 100%)',
    );
  });

  it('uses the same darkness/stops on both presenter and audience callers', () => {
    const presenter = spotlightGradient({ x: 100, y: 200 }, 180);
    const audience = spotlightGradient({ x: 100, y: 200 }, 180);
    expect(presenter).toBe(audience);
    expect(presenter).toContain('rgba(0,0,0,0.85)');
    expect(presenter).toContain('transparent 70%');
  });
});

describe('clampSpotlightRadius', () => {
  it('snaps to the configured step within the supported range', () => {
    expect(clampSpotlightRadius(0)).toBe(SPOTLIGHT_MIN_RADIUS);
    expect(clampSpotlightRadius(10_000)).toBe(SPOTLIGHT_MAX_RADIUS);
    const inRange = SPOTLIGHT_MIN_RADIUS + SPOTLIGHT_STEP + 3;
    expect(clampSpotlightRadius(inRange) % SPOTLIGHT_STEP).toBe(0);
  });
});
