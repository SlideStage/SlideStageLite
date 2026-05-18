import type { Point } from './types';

/**
 * Renders the red laser dot.
 *
 * Like `Spotlight`, the dot is mounted inside `.logical-stage` so its
 * 18×18 px size lives in deck logical coordinates. The parent's scale
 * transform then makes the dot land at the same physical position and
 * size on the presenter canvas and on the audience window. The dot is
 * driven by `point` (logical px) supplied by the parent — the same
 * coordinate stream the broadcast loop sends to `AudienceView`, so the
 * two windows stay perfectly in sync.
 */
interface LaserPointerProps {
  active: boolean;
  /** Logical-stage coordinates, or `null` to hide the dot. */
  point: Point | null;
}

export function LaserPointer({ active, point }: LaserPointerProps) {
  if (!active || !point) {
    return null;
  }
  return (
    <div
      className="laser-pointer"
      style={{ left: point.x, top: point.y }}
      data-testid="laser-pointer"
    />
  );
}
