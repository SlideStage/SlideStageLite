/**
 * `<PresenterSideRail />` is the right-rail used by the presenter
 * layout. It renders three cards (Up next preview, Timer, Audience
 * status). Tests pin: end-of-deck placeholder, formatted timer, and
 * audience live/idle label.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PresenterSideRail } from '@slidestage/ui/viewer/PresenterSideRail';
import type { ManifestSlide } from '@slidestage/core/deck/types';

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

afterEach(() => {
  cleanup();
});

function makeSlide(overrides: Partial<ManifestSlide> = {}): ManifestSlide {
  return {
    index: 3,
    id: 'next',
    label: 'Up next slide',
    file: 'slides/03.html',
    thumbnail: null,
    notes: null,
    ...overrides,
  };
}

describe('<PresenterSideRail />', () => {
  it('renders the end-of-deck placeholder when no next slide is available', () => {
    render(
      <PresenterSideRail
        upNext={{
          slide: null,
          src: null,
          deckDimensions: { width: 1920, height: 1080 },
        }}
        timer={{ elapsedMs: 0, onReset: vi.fn() }}
        audience={{ connected: false }}
      />,
    );
    expect(screen.getByText('viewer.speaker.endOfDeckPlain')).toBeTruthy();
  });

  it('renders the next-slide preview when both slide and src are present', () => {
    render(
      <PresenterSideRail
        upNext={{
          slide: makeSlide(),
          src: '/__stage/deck/slides/03.html',
          deckDimensions: { width: 1920, height: 1080 },
        }}
        timer={{ elapsedMs: 0, onReset: vi.fn() }}
        audience={{ connected: false }}
      />,
    );
    expect(screen.getByTestId('next-deck-stage')).toBeTruthy();
    expect(screen.getByText('Up next slide', { exact: false })).toBeTruthy();
  });

  it('formats the timer value as MM:SS and fires onReset', () => {
    const onReset = vi.fn();
    render(
      <PresenterSideRail
        upNext={{
          slide: null,
          src: null,
          deckDimensions: { width: 1920, height: 1080 },
        }}
        timer={{ elapsedMs: 65_000, onReset }}
        audience={{ connected: false }}
      />,
    );
    expect(screen.getByTestId('presenter-timer').textContent).toBe('01:05');
    fireEvent.click(screen.getByRole('button', { name: 'viewer.side.timer.reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('toggles audience status label between live and disconnected', () => {
    const { rerender } = render(
      <PresenterSideRail
        upNext={{
          slide: null,
          src: null,
          deckDimensions: { width: 1920, height: 1080 },
        }}
        timer={{ elapsedMs: 0, onReset: vi.fn() }}
        audience={{ connected: false }}
      />,
    );
    expect(screen.getByText('viewer.audience.disconnected')).toBeTruthy();

    rerender(
      <PresenterSideRail
        upNext={{
          slide: null,
          src: null,
          deckDimensions: { width: 1920, height: 1080 },
        }}
        timer={{ elapsedMs: 0, onReset: vi.fn() }}
        audience={{ connected: true }}
      />,
    );
    expect(screen.getByText('viewer.audience.live')).toBeTruthy();
  });
});
