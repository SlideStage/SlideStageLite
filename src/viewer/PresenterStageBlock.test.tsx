/**
 * Smoke contract for `<PresenterStageBlock />`. We don't try to exercise
 * the AnnotationOverlay drawing path (covered by its own tests); we
 * just check the block mounts with a deck + presenter + audience
 * pointer prop set and that the floating toolbar / blackout overlay
 * render in the expected mode.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PresenterStageBlock } from '@slidestage/ui/viewer/PresenterStageBlock';
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
    label: 'First',
    file: 'slides/01.html',
    thumbnail: null,
    notes: null,
    ...overrides,
  };
}

function makeDeck(overrides: Partial<LoadedDeck> = {}): LoadedDeck {
  const slides = [makeSlide()];
  const manifest: Manifest = {
    schema: 'slidestage@1.0',
    id: 'deck',
    version: '0.0.0',
    title: 'Test',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    architecture: 'multi-file',
    dimensions: { width: 1920, height: 1080 },
    totalSlides: 1,
    slides,
  };
  return {
    fileName: 'deck.stage',
    fingerprint: 'fingerprint',
    deckId: 'deck',
    manifest,
    slideUrls: ['/__stage/deck/slides/01.html'],
    slideHtml: ['<!doctype html><body></body>'],
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    thumbnailUrls: [null],
    prefersSrcdoc: false,
    revoke: vi.fn(),
    ...overrides,
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

describe('<PresenterStageBlock />', () => {
  it('renders the presenter-host, deck-stage, and right-dock toolbar', () => {
    const hostRef = createRef<HTMLDivElement>();
    render(
      <PresenterStageBlock
        hostRef={hostRef}
        deck={makeDeck()}
        currentIndex={0}
        useSrcdoc={false}
        preloadSrcs={[]}
        presenter={makePresenter({
          tool: 'mouse',
          penColor: '#FF3B30',
          strokesByIdx: {},
          spotlightRadius: 180,
        })}
        audiencePointer={null}
        onAppendStroke={vi.fn()}
        onErase={vi.fn()}
        onDraftStrokeChange={vi.fn()}
        toolbarMode="right-dock"
      />,
    );
    expect(screen.getByTestId('presenter-host')).toBeTruthy();
    expect(screen.getByTestId('deck-stage')).toBeTruthy();
    const toolbar = screen.getByTestId('presenter-toolbar');
    expect(toolbar.getAttribute('data-mode')).toBe('right-dock');
  });

  it('passes the auto-hide toolbar mode through to the Toolbar', () => {
    const hostRef = createRef<HTMLDivElement>();
    render(
      <PresenterStageBlock
        hostRef={hostRef}
        deck={makeDeck()}
        currentIndex={0}
        useSrcdoc
        preloadSrcs={[]}
        presenter={makePresenter({
          tool: 'mouse',
          penColor: '#FF3B30',
          strokesByIdx: {},
          spotlightRadius: 180,
        })}
        audiencePointer={null}
        onAppendStroke={vi.fn()}
        onErase={vi.fn()}
        onDraftStrokeChange={vi.fn()}
        toolbarMode="auto-hide"
      />,
    );
    const toolbar = screen.getByTestId('presenter-toolbar');
    expect(toolbar.getAttribute('data-mode')).toBe('auto-hide');
  });
});
