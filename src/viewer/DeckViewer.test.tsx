/**
 * High-level smoke contract for the package-owned `<DeckViewer />`.
 * The viewer composes a stack of sub-components (header / stage block
 * / side rail / notes panel) and orchestrates pointer tracking +
 * audience presentation. The host preset injects layout state,
 * persistence callbacks, and the presenter API.
 *
 * We don't try to exercise every nested behaviour here — the
 * sub-component tests cover those. This file pins:
 *   1. Presenter mode renders the header + side rail + notes panel.
 *   2. Single mode renders the header + speaker panel toggle.
 *   3. The audience `onPresentationChange` callback fires with a
 *      presentation snapshot derived from presenter state.
 *   4. Switching layout modes via the header buttons calls
 *      `layout.onModeChange`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeckViewer } from '@slidestage/ui/viewer/DeckViewer';
import type { PresenterApi } from '@slidestage/ui/presenter/usePresenter';
import type { PresenterState } from '@slidestage/ui/presenter/types';
import type { LoadedDeck, Manifest, ManifestSlide } from '@slidestage/core/deck/types';

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
    index: 1,
    id: 'one',
    label: 'First slide',
    file: 'slides/01.html',
    thumbnail: null,
    notes: null,
    ...overrides,
  };
}

function makeDeck(): LoadedDeck {
  const slides = [
    makeSlide({ index: 1, id: 'one', label: 'First' }),
    makeSlide({ index: 2, id: 'two', label: 'Second' }),
  ];
  const manifest: Manifest = {
    schema: 'slidestage@1.0',
    id: 'deck',
    version: '0.0.0',
    title: 'Sample Deck',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 2,
    slides,
  };
  return {
    fileName: 'deck.stage',
    fingerprint: 'fingerprint-abc',
    deckId: 'deckabc',
    manifest,
    slideUrls: ['/__stage/deckabc/slides/01.html', '/__stage/deckabc/slides/02.html'],
    slideHtml: ['<!doctype html><body></body>', '<!doctype html><body></body>'],
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    thumbnailUrls: [null, null],
    prefersSrcdoc: false,
    revoke: vi.fn(),
  };
}

function makePresenter(state: PresenterState): PresenterApi {
  return {
    state,
    setTool: vi.fn(),
    setColor: vi.fn(),
    loadStrokes: vi.fn(),
    appendStroke: vi.fn(),
    replaceSlideStrokes: vi.fn(),
    undo: vi.fn(),
    clearSlide: vi.fn(),
    setSpotlightRadius: vi.fn(),
    nudgeSpotlightRadius: vi.fn(),
    isDrawingTool: false,
    needsPointerCapture: false,
  };
}

interface RenderOptions {
  showOverview?: boolean;
  showNotes?: boolean;
  mode?: 'presenter' | 'single';
}

function renderViewer(opts: RenderOptions = {}) {
  const onNavigate = vi.fn();
  const onModeChange = vi.fn();
  const onSideWidthChange = vi.fn();
  const onNotesHeightChange = vi.fn();
  const onPresentationChange = vi.fn();
  const onOverridesChange = vi.fn();
  const onOpenWindow = vi.fn();
  const onCloseDeck = vi.fn();
  const onCloseOverview = vi.fn();
  const onToggleOverview = vi.fn();
  const onCloseNotes = vi.fn();
  const onToggleNotes = vi.fn();

  const presenter = makePresenter({
    tool: 'mouse',
    penColor: '#FF3B30',
    strokesByIdx: {},
    spotlightRadius: 180,
  });

  render(
    <DeckViewer
      deck={makeDeck()}
      currentIndex={0}
      showOverview={opts.showOverview ?? false}
      showNotes={opts.showNotes ?? false}
      onNavigate={onNavigate}
      onCloseOverview={onCloseOverview}
      onToggleOverview={onToggleOverview}
      onCloseNotes={onCloseNotes}
      onToggleNotes={onToggleNotes}
      onCloseDeck={onCloseDeck}
      layout={{
        mode: opts.mode ?? 'presenter',
        onModeChange,
        sideWidth: 360,
        onSideWidthChange,
        notesHeight: 170,
        onNotesHeightChange,
      }}
      presenter={presenter}
      notes={{ overrides: {}, onOverridesChange }}
      isTauriHost={false}
      audience={{
        connected: false,
        onPresentationChange,
        onOpenWindow,
      }}
    />,
  );

  return {
    presenter,
    onNavigate,
    onModeChange,
    onPresentationChange,
    onOpenWindow,
    onCloseDeck,
  };
}

describe('<DeckViewer /> presenter mode', () => {
  it('renders the presenter shell with header + stage host + side rail + notes', () => {
    renderViewer({ mode: 'presenter' });
    expect(screen.getByTestId('presenter-view')).toBeTruthy();
    expect(screen.getByTestId('presenter-host')).toBeTruthy();
    expect(screen.getByTestId('presenter-side')).toBeTruthy();
    expect(screen.getByTestId('speaker-notes')).toBeTruthy();
    // Header back button collapses to single mode.
    expect(screen.getByTestId('open-single-view')).toBeTruthy();
  });

  it('calls layout.onModeChange when single-view button is clicked', () => {
    const { onModeChange } = renderViewer({ mode: 'presenter' });
    fireEvent.click(screen.getByTestId('open-single-view'));
    expect(onModeChange).toHaveBeenCalledWith('single');
  });

  it('emits a presentation snapshot through audience.onPresentationChange', async () => {
    const { onPresentationChange } = renderViewer({ mode: 'presenter' });
    // The effect fires after mount with the initial snapshot.
    expect(onPresentationChange).toHaveBeenCalled();
    const snapshot = onPresentationChange.mock.calls.at(-1)?.[0];
    expect(snapshot).toMatchObject({
      currentIndex: 0,
      tool: 'mouse',
      spotlightRadius: 180,
      pointer: null,
    });
  });
});

describe('<DeckViewer /> single mode', () => {
  it('renders the single shell with close-deck button and presenter-mode switch', () => {
    renderViewer({ mode: 'single' });
    expect(screen.getByTestId('deck-viewer')).toBeTruthy();
    expect(screen.getByTestId('close-deck')).toBeTruthy();
    expect(screen.getByTestId('open-presenter-view')).toBeTruthy();
  });

  it('renders the speaker panel only when showNotes is true', () => {
    const { onModeChange } = renderViewer({ mode: 'single' });
    expect(screen.queryByTestId('speaker-panel')).toBeNull();
    cleanup();
    onModeChange.mockClear();
    renderViewer({ mode: 'single', showNotes: true });
    expect(screen.getByTestId('speaker-panel')).toBeTruthy();
  });

  it('calls onCloseDeck via the back button', () => {
    const { onCloseDeck } = renderViewer({ mode: 'single' });
    fireEvent.click(screen.getByTestId('close-deck'));
    expect(onCloseDeck).toHaveBeenCalledTimes(1);
  });
});
