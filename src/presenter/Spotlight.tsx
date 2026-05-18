import { clampSpotlightRadius, spotlightGradient, type Point } from './types';

/**
 * Renders the spotlight dimming overlay.
 *
 * The overlay is **always** mounted inside `.logical-stage` (via
 * `DeckStage` children on the presenter, directly inside `AudienceView`
 * children) so its size and the gradient radius live in deck logical
 * pixels. The parent's CSS `transform: scale(...)` then renders the
 * spotlight at the right physical size for whatever stage is shown.
 * That is what makes the presenter and audience windows see an
 * identical spotlight, even though their actual canvases differ in
 * size — see `Toolbar` / `DeckViewer` for the pointer plumbing, and
 * `presenter/types.ts → spotlightGradient` for the shared formula.
 */
interface SpotlightProps {
  active: boolean;
  /** Logical-stage coordinates of the spotlight focus, or `null` to centre. */
  point: Point | null;
  /** Spotlight radius in logical px (clamped per `clampSpotlightRadius`). */
  radius: number;
  /** Logical stage dimensions; used to centre the spotlight when no point. */
  width: number;
  height: number;
}

export function Spotlight({ active, point, radius, width, height }: SpotlightProps) {
  if (!active) {
    return null;
  }
  const safeRadius = clampSpotlightRadius(radius);
  const focus = point ?? { x: width / 2, y: height / 2 };

  return (
    <div
      className="spotlight-overlay"
      data-testid="spotlight-mask"
      data-spotlight-radius={safeRadius}
      style={{
        background: spotlightGradient(focus, safeRadius),
        // No CSS transition on `background`: WebKit (esp. WKWebView /
        // Tauri on macOS) doesn't GPU-accelerate radial-gradient tweens,
        // so a 60ms interpolation on a fullscreen overlay made the
        // spotlight crawl while every other tool stayed smooth. Pointer
        // movement is already streamed at frame rate from the toolbar
        // so a step transition reads as "smooth" without the CPU paint.
        willChange: 'background',
      }}
    />
  );
}
