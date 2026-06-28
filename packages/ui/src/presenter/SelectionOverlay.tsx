import type { SelectionRect } from './slideRuntime';

/**
 * Paints the presenter's mirrored text selection on the audience window.
 *
 * Like `AnnotationOverlay` / `Spotlight`, the SVG is mounted inside
 * `.logical-stage` and uses a `0 0 width height` viewBox so each rect is
 * expressed in deck logical pixels. The parent's CSS `transform: scale(...)`
 * then renders the highlight at the right physical size and position on
 * whatever canvas the audience window happens to be.
 *
 * The rects come from `Range.getClientRects()` in the presenter slide
 * iframe (forwarded by the runtime agent), whose viewport equals the deck
 * dimensions — so they line up 1:1 with the audience slide underneath.
 * It is a non-interactive, presentational overlay only.
 */
interface SelectionOverlayProps {
  /** Selection rects in logical px, or `null`/empty to render nothing. */
  rects: readonly SelectionRect[] | null;
  /** Logical stage dimensions (deck width/height) for the viewBox. */
  width: number;
  height: number;
}

export function SelectionOverlay({ rects, width, height }: SelectionOverlayProps) {
  if (!rects || rects.length === 0) {
    return null;
  }
  return (
    <svg
      className="selection-overlay"
      data-testid="selection-overlay"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {rects.map((rect, index) => (
        <rect
          key={index}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
        />
      ))}
    </svg>
  );
}
