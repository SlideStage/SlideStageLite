/**
 * Spotlight overlay regression tests.
 *
 * The spotlight is the only annotation tool that paints a fullscreen
 * radial-gradient every frame. On WKWebView (Tauri/macOS) a CSS
 * transition on `background` is *not* GPU-accelerated and forced the
 * spotlight to crawl at ~10 fps while the laser pointer (transform-based)
 * stayed smooth. These tests lock in the rendering contract so future
 * refactors don't quietly bring back the lag:
 *
 *   1. Renders `null` when inactive.
 *   2. When active, the overlay carries a radial-gradient background
 *      centred on the supplied point with the canonical alpha stops.
 *   3. **No** CSS transition is applied to `background` — that knob
 *      reintroduces the WKWebView spotlight lag.
 *   4. Falls back to the stage centre when no point is supplied.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Spotlight } from '@slidestage/ui/presenter/Spotlight';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function queryOverlay(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="spotlight-mask"]');
}

describe('Spotlight', () => {
  it('renders nothing while inactive', () => {
    act(() => {
      root.render(
        <Spotlight active={false} point={{ x: 100, y: 100 }} radius={180} width={1920} height={1080} />,
      );
    });
    expect(queryOverlay()).toBeNull();
  });

  it('paints a radial-gradient centred on the supplied point', () => {
    act(() => {
      root.render(
        <Spotlight active={true} point={{ x: 320, y: 240 }} radius={180} width={1920} height={1080} />,
      );
    });
    const overlay = queryOverlay();
    expect(overlay).not.toBeNull();
    expect(overlay!.style.background).toContain('radial-gradient');
    expect(overlay!.style.background).toContain('320px 240px');
    expect(overlay!.style.background).toContain('rgba(0, 0, 0, 0.85)');
  });

  it('does not animate the background via a CSS transition', () => {
    // Why: a CSS `transition: background` on a fullscreen radial-gradient
    // tanks WKWebView (Tauri/macOS) performance — every pointer move
    // triggers a 60ms CPU repaint of the entire overlay. Step transitions
    // already look smooth because the pointer stream is frame-rate.
    act(() => {
      root.render(
        <Spotlight active={true} point={{ x: 100, y: 100 }} radius={180} width={1920} height={1080} />,
      );
    });
    const overlay = queryOverlay()!;
    expect(overlay.style.transition).toBe('');
    expect(overlay.style.willChange).toBe('background');
  });

  it('centres the spotlight when no point is supplied', () => {
    act(() => {
      root.render(
        <Spotlight active={true} point={null} radius={180} width={1920} height={1080} />,
      );
    });
    const overlay = queryOverlay()!;
    expect(overlay.style.background).toContain('960px 540px');
  });
});
