export const PEN_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#0A84FF', '#34C759'] as const;
export type PenColor = (typeof PEN_COLORS)[number];

export const PEN_WIDTH = 8;
export const HIGHLIGHTER_WIDTH = 30;
export const SPOTLIGHT_DEFAULT_RADIUS = 180;
export const SPOTLIGHT_MIN_RADIUS = 80;
export const SPOTLIGHT_MAX_RADIUS = 480;
export const SPOTLIGHT_STEP = 16;
export const SPOTLIGHT_STORAGE_KEY = 'hcslides-lite:spotlight-radius';

export type Tool =
  | 'mouse'
  | 'laser'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'spotlight'
  | 'blackout'
  | 'whiteout';

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: Point[];
  cid?: string;
}

export interface PresenterState {
  tool: Tool;
  penColor: PenColor;
  strokesByIdx: Record<number, Stroke[]>;
  spotlightRadius: number;
}

export function toHighlighterColor(color: PenColor): string {
  if (color === '#FFCC00') {
    return 'rgba(255, 204, 0, 0.45)';
  }
  return `${color}73`;
}

export function clampSpotlightRadius(radius: number): number {
  const clamped = Math.max(SPOTLIGHT_MIN_RADIUS, Math.min(SPOTLIGHT_MAX_RADIUS, radius));
  return Math.round(clamped / SPOTLIGHT_STEP) * SPOTLIGHT_STEP;
}

/**
 * Shared CSS background for the spotlight overlay.
 *
 * The same formula is consumed by `Spotlight` (presenter) and
 * `AudienceView` (audience window). Both render the overlay as a child
 * of `.logical-stage`, so `point` and `radius` are interpreted in deck
 * logical pixels (e.g. 1920×1080) and the parent's CSS scale transform
 * adapts the visual size for whatever stage the consumer rendered into.
 * Keeping the formula in one place is what guarantees the presenter and
 * audience screens look identical during a spotlight focus.
 */
export function spotlightGradient(point: Point, radius: number): string {
  return `radial-gradient(circle ${radius}px at ${point.x}px ${point.y}px, transparent 0%, transparent 70%, rgba(0,0,0,0.85) 100%)`;
}
