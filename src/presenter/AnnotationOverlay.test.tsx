/**
 * Pointer contract for `<AnnotationOverlay />`'s eraser.
 *
 * Erasing must require an actual press (a non-zero `buttons` bitmask on
 * pointer events): merely hovering the slide with the eraser selected
 * must not wipe annotations. The press-drag path and the pointerdown
 * click path both keep erasing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AnnotationOverlay } from '@slidestage/ui/presenter/AnnotationOverlay';

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  // jsdom's SVGSVGElement has no live viewBox/getBoundingClientRect
  // geometry; give the overlay a deterministic 1920×1080 canvas.
  Object.defineProperty(SVGElement.prototype, 'viewBox', {
    configurable: true,
    get() {
      return { baseVal: { width: 1920, height: 1080 } };
    },
  });
  SVGElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 960,
    bottom: 540,
    width: 960,
    height: 540,
    toJSON: () => ({}),
  })) as unknown as typeof SVGElement.prototype.getBoundingClientRect;
});

function renderEraserOverlay(onErase: (point: { x: number; y: number }) => void) {
  render(
    <AnnotationOverlay
      tool="eraser"
      color="#FF3B30"
      strokes={[]}
      width={1920}
      height={1080}
      onCommitStroke={() => {}}
      onErase={onErase}
    />,
  );
  return screen.getByTestId('annotation-overlay');
}

describe('AnnotationOverlay eraser', () => {
  it('does not erase while hovering with no button pressed', () => {
    const onErase = vi.fn();
    const overlay = renderEraserOverlay(onErase);

    fireEvent.pointerMove(overlay, { clientX: 100, clientY: 100, buttons: 0 });
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 150, buttons: 0 });

    expect(onErase).not.toHaveBeenCalled();
  });

  it('erases while dragging with the primary button held', () => {
    const onErase = vi.fn();
    const overlay = renderEraserOverlay(onErase);

    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 110, buttons: 1 });

    expect(onErase).toHaveBeenCalledTimes(2);
    // Points map through the viewBox scale (960px box → 1920 logical px).
    expect(onErase.mock.calls[1][0]).toEqual({ x: 240, y: 220 });
  });
});
