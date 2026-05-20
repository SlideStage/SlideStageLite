/**
 * Smoke contract for `useAudiencePointerTracking`. The hook converts
 * presenter pointer position into deck-logical coordinates so the
 * audience window can mirror the laser / spotlight. We pin two things:
 *   1. When the tool is `laser` or `spotlight`, a pointermove on the
 *      host element produces the right normalized coordinates.
 *   2. When the tool flips back to a non-tracking tool, the hook
 *      clears the pointer state.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAudiencePointerTracking } from '@slidestage/ui/viewer/useAudiencePointerTracking';
import type { Tool } from '@slidestage/ui/presenter/types';
import type { AudiencePointer } from '@slidestage/ui/presenter/usePresentationSync';

afterEach(() => {
  cleanup();
});

interface HarnessProps {
  initialTool: Tool;
  logicalStageRect: DOMRect;
  deckDimensions: { width: number; height: number };
  onPointer: (next: AudiencePointer | null) => void;
}

function Harness({ initialTool, logicalStageRect, deckDimensions, onPointer }: HarnessProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<Tool>(initialTool);

  const attach = (node: HTMLDivElement | null): void => {
    hostRef.current = node;
    if (node) {
      // Stash the setter on the node so the test can flip the tool from
      // outside without re-rendering the harness via a prop.
      (node as unknown as { __setTool: (t: Tool) => void }).__setTool = setTool;
      // Inject a `.logical-stage` child the hook queries for the rect.
      const child = document.createElement('div');
      child.className = 'logical-stage';
      child.getBoundingClientRect = () => logicalStageRect;
      node.appendChild(child);
    }
  };

  const pointer = useAudiencePointerTracking({
    hostRef,
    presenterTool: tool,
    deckDimensions,
  });

  onPointer(pointer);
  return <div ref={attach} data-testid="host" />;
}

describe('useAudiencePointerTracking', () => {
  it('normalises pointer coordinates into deck-logical space for laser tool', () => {
    let lastPointer: AudiencePointer | null = null;
    const rect = new DOMRect(100, 50, 800, 600);
    const { getByTestId } = render(
      <Harness
        initialTool="laser"
        logicalStageRect={rect}
        deckDimensions={{ width: 1920, height: 1080 }}
        onPointer={(next) => {
          lastPointer = next;
        }}
      />,
    );
    const host = getByTestId('host') as HTMLDivElement;

    act(() => {
      // Center of the rect → expect (1920/2, 1080/2).
      host.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
    });

    expect(lastPointer).not.toBeNull();
    expect(lastPointer!.tool).toBe('laser');
    expect(lastPointer!.point.x).toBeCloseTo(960);
    expect(lastPointer!.point.y).toBeCloseTo(540);
  });

  it('clears the pointer when the pointer leaves the host', () => {
    let lastPointer: AudiencePointer | null = null;
    const rect = new DOMRect(0, 0, 800, 600);
    const { getByTestId } = render(
      <Harness
        initialTool="spotlight"
        logicalStageRect={rect}
        deckDimensions={{ width: 1920, height: 1080 }}
        onPointer={(next) => {
          lastPointer = next;
        }}
      />,
    );
    const host = getByTestId('host') as HTMLDivElement;
    act(() => {
      host.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 100, clientY: 100 }),
      );
    });
    expect(lastPointer).not.toBeNull();

    act(() => {
      host.dispatchEvent(new PointerEvent('pointerleave'));
    });
    expect(lastPointer).toBeNull();
  });

  it('returns null when the tool is not laser or spotlight', () => {
    let lastPointer: AudiencePointer | null = null;
    const rect = new DOMRect(0, 0, 800, 600);
    render(
      <Harness
        initialTool="pen"
        logicalStageRect={rect}
        deckDimensions={{ width: 1920, height: 1080 }}
        onPointer={(next) => {
          lastPointer = next;
        }}
      />,
    );
    expect(lastPointer).toBeNull();
  });
});
