/**
 * `useDeckViewerResize` is the divider drag handler that lives behind
 * the presenter-view side rail / speaker-notes height splitters. The
 * test pins down the pointer-down/move/up sequence and the snapshot
 * geometry so future refactors of the original `startSideResize` /
 * `startNotesResize` callbacks don't silently regress.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useDeckViewerResize } from '@slidestage/ui/viewer/useDeckViewerResize';

afterEach(() => {
  cleanup();
});

interface HarnessProps {
  axis: 'horizontal' | 'vertical';
  containerRect: DOMRect;
  setSize: (next: number) => void;
}

function Harness({ axis, containerRect, setSize }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Override getBoundingClientRect on the container so the hook reads a
  // deterministic geometry without depending on jsdom's missing layout.
  const attachContainer = (node: HTMLDivElement | null): void => {
    containerRef.current = node;
    if (node) {
      node.getBoundingClientRect = () => containerRect;
    }
  };
  const onPointerDown = useDeckViewerResize({ containerRef, axis, setSize });
  return (
    <div ref={attachContainer} data-testid="container">
      <div
        data-testid="divider"
        onPointerDown={onPointerDown}
      />
    </div>
  );
}

describe('useDeckViewerResize', () => {
  it('reports a horizontal width measured from container.right on pointer move', () => {
    const setSize = vi.fn();
    const rect = new DOMRect(0, 0, 800, 600);
    const { getByTestId } = render(
      <Harness axis="horizontal" containerRect={rect} setSize={setSize} />,
    );
    const divider = getByTestId('divider') as HTMLDivElement;
    // Stub pointer-capture so the hook doesn't throw in jsdom.
    divider.setPointerCapture = vi.fn();
    divider.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(divider, { pointerId: 7, clientX: 500, clientY: 0 });
    // After pointer-down the hook installs window-level listeners; verify
    // they convert clientX into right-edge distance.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 0 }));
    expect(setSize).toHaveBeenLastCalledWith(rect.right - 500);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 0 }));
    expect(setSize).toHaveBeenLastCalledWith(rect.right - 100);

    // Pointer-up tears down listeners; further moves should NOT report.
    window.dispatchEvent(new PointerEvent('pointerup'));
    setSize.mockClear();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 0 }));
    expect(setSize).not.toHaveBeenCalled();
  });

  it('reports a vertical height measured from container.bottom on pointer move', () => {
    const setSize = vi.fn();
    const rect = new DOMRect(0, 100, 800, 400);
    const { getByTestId } = render(
      <Harness axis="vertical" containerRect={rect} setSize={setSize} />,
    );
    const divider = getByTestId('divider') as HTMLDivElement;
    divider.setPointerCapture = vi.fn();
    divider.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(divider, { pointerId: 3, clientX: 0, clientY: 350 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 350 }));
    expect(setSize).toHaveBeenLastCalledWith(rect.bottom - 350);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 200 }));
    expect(setSize).toHaveBeenLastCalledWith(rect.bottom - 200);
    window.dispatchEvent(new PointerEvent('pointercancel'));
  });

  it('is a no-op when the container ref is null at pointer-down', () => {
    const setSize = vi.fn();
    function NullHarness() {
      const containerRef = useRef<HTMLDivElement | null>(null);
      const onPointerDown = useDeckViewerResize({
        containerRef,
        axis: 'horizontal',
        setSize,
      });
      return <div data-testid="divider" onPointerDown={onPointerDown} />;
    }
    const { getByTestId } = render(<NullHarness />);
    const divider = getByTestId('divider') as HTMLDivElement;
    divider.setPointerCapture = vi.fn();

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 100, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 0 }));
    expect(setSize).not.toHaveBeenCalled();
  });
});
