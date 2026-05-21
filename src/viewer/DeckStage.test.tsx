import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeckStage } from '@slidestage/ui/viewer/DeckStage';

// jsdom does not ship ResizeObserver; `useStageLayout` needs one and
// crashes otherwise. A minimal noop polyfill is enough for these tests.
beforeAll(() => {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class FakeResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
  }
});

// `globals: false` in vitest config disables testing-library's auto-cleanup,
// so we tear down between tests manually otherwise multiple `data-testid`
// nodes collide across the `it` blocks.
afterEach(() => {
  cleanup();
});

/**
 * DeckStage now pulls keyboard focus back to its outer container after
 * each iframe load. Without that the WKWebView host in Tauri parks
 * focus inside the slide iframe and the App-level keydown handler never
 * sees Arrow / PageUp / Space — so this test pins down that behavior
 * stays in place across refactors.
 */
describe('DeckStage focus recovery', () => {
  it('renders an outer container that can receive focus (tabIndex=-1)', () => {
    const { getByTestId } = render(
      <DeckStage
        src="blob:nope"
        title="Slide 1"
        width={1280}
        height={720}
      />,
    );
    const card = getByTestId('deck-stage');
    expect(card.getAttribute('tabIndex')).toBe('-1');
  });

  it('focuses the container when the active iframe finishes loading', () => {
    const { getByTestId, container } = render(
      <DeckStage
        src="blob:nope"
        title="Slide 1"
        width={1280}
        height={720}
      />,
    );
    const card = getByTestId('deck-stage');
    // jsdom does not auto-fire load on iframes; simulate the event the
    // way React would deliver it.
    const activeIframe = container.querySelector('iframe[data-active="true"]') as HTMLIFrameElement;
    expect(activeIframe).toBeTruthy();
    const focusSpy = vi.spyOn(card, 'focus');
    activeIframe.dispatchEvent(new Event('load'));
    expect(focusSpy).toHaveBeenCalled();
  });

  it('reclaims focus when the host window regains focus', async () => {
    const { getByTestId } = render(
      <DeckStage
        src="blob:nope"
        title="Slide 1"
        width={1280}
        height={720}
      />,
    );
    const card = getByTestId('deck-stage');
    // Patch requestAnimationFrame so the test runs synchronously rather
    // than waiting on a real frame.
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      const focusSpy = vi.spyOn(card, 'focus');
      window.dispatchEvent(new Event('focus'));
      expect(focusSpy).toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });

  it('removes the window-focus listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <DeckStage
        src="blob:nope"
        title="Slide 1"
        width={1280}
        height={720}
      />,
    );
    unmount();
    const calls = removeSpy.mock.calls.filter(
      ([type]) => type === 'focus',
    );
    expect(calls.length).toBeGreaterThan(0);
    removeSpy.mockRestore();
  });
});
