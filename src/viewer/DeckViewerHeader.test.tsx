/**
 * `<DeckViewerHeader />` is the shared toolbar across the presenter
 * and single-window layouts. The tests pin:
 *   - that each variant renders the right back / mode-switch button,
 *   - that prev/next disable correctly at the deck edges,
 *   - that callbacks fire on click,
 *   - that the audience button toggles label between "Open"/"Live".
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckViewerHeader } from '@slidestage/ui/viewer/DeckViewerHeader';

afterEach(() => {
  cleanup();
});

describe('<DeckViewerHeader /> single variant', () => {
  function renderSingle(overrides: Partial<Parameters<typeof DeckViewerHeader>[0]> = {}) {
    const props = {
      variant: 'single' as const,
      title: 'Deck title',
      currentIndex: 1,
      totalSlides: 5,
      canGoPrev: true,
      canGoNext: true,
      onNavigatePrev: vi.fn(),
      onNavigateNext: vi.fn(),
      onCloseDeck: vi.fn(),
      onSwitchToPresenter: vi.fn(),
      showOverview: false,
      onToggleOverview: vi.fn(),
      showNotes: false,
      onToggleNotes: vi.fn(),
      ...overrides,
    };
    render(<DeckViewerHeader {...props} />);
    return props;
  }

  it('renders the close-deck back button and presenter-mode switch', () => {
    renderSingle();
    expect(screen.getByTestId('close-deck')).toBeTruthy();
    expect(screen.getByTestId('open-presenter-view')).toBeTruthy();
    expect(screen.getByTestId('speaker-button')).toBeTruthy();
  });

  it('fires close-deck → onCloseDeck', () => {
    const props = renderSingle();
    fireEvent.click(screen.getByTestId('close-deck'));
    expect(props.onCloseDeck).toHaveBeenCalledTimes(1);
  });

  it('disables prev/next at the deck edges', () => {
    cleanup();
    renderSingle({ currentIndex: 0, canGoPrev: false });
    const prev = screen.getByLabelText('viewer.aria.previous') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    cleanup();
    renderSingle({ currentIndex: 4, canGoNext: false });
    const next = screen.getByLabelText('viewer.aria.next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('reflects current/total in the counter region', () => {
    renderSingle({ currentIndex: 2, totalSlides: 5 });
    expect(screen.getByRole('status').textContent?.replace(/\s+/g, '')).toBe('3/5');
  });
});

describe('<DeckViewerHeader /> presenter variant', () => {
  function renderPresenter(
    overrides: Partial<Parameters<typeof DeckViewerHeader>[0]> = {},
  ) {
    const props = {
      variant: 'presenter' as const,
      title: 'Deck',
      currentIndex: 1,
      totalSlides: 3,
      canGoPrev: true,
      canGoNext: true,
      onNavigatePrev: vi.fn(),
      onNavigateNext: vi.fn(),
      onSwitchToSingle: vi.fn(),
      showOverview: false,
      onToggleOverview: vi.fn(),
      audienceConnected: false,
      onOpenAudienceWindow: vi.fn(),
      ...overrides,
    };
    render(<DeckViewerHeader {...props} />);
    return props;
  }

  it('renders the single-window switch and the audience button', () => {
    renderPresenter();
    expect(screen.getByTestId('open-single-view')).toBeTruthy();
    expect(screen.getByTestId('open-audience')).toBeTruthy();
    // The single-only buttons must not appear.
    expect(screen.queryByTestId('speaker-button')).toBeNull();
    expect(screen.queryByTestId('open-presenter-view')).toBeNull();
  });

  it('toggles the audience button text on connection state', () => {
    renderPresenter({ audienceConnected: false });
    expect(screen.getByTestId('open-audience').textContent).toContain(
      'viewer.action.openAudience',
    );
    cleanup();
    renderPresenter({ audienceConnected: true });
    expect(screen.getByTestId('open-audience').textContent).toContain(
      'viewer.action.audienceLive',
    );
  });

  it('fires open-audience callback on click', () => {
    const props = renderPresenter();
    fireEvent.click(screen.getByTestId('open-audience'));
    expect(props.onOpenAudienceWindow).toHaveBeenCalledTimes(1);
  });
});
