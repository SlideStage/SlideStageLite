/**
 * Render contract for the package-owned `<Overview />`.
 *
 * Overview moved from `src/viewer/` to `@slidestage/ui/viewer/Overview` in
 * Phase 3.5. After the move it consumes `useUiTranslator()` from
 * `@slidestage/ui/i18n/translator` instead of Lite's `useI18n()`. These
 * tests pin three things:
 *   1. Without a provider it still renders every slide and falls back to
 *      raw i18n keys (so isolated-tests / Storybook never blow up).
 *   2. With a provider its visible labels come from the injected
 *      translator — proves Lite-preset's `<I18nProvider>` chain works.
 *   3. Clicks on a card and the close button fire the right callbacks.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '@slidestage/ui/viewer/Overview';
import {
  UiTranslatorProvider,
  type UiTranslator,
} from '@slidestage/ui/i18n/translator';
import type { LoadedDeck, Manifest, ManifestSlide } from '@slidestage/core/deck/types';

afterEach(() => {
  cleanup();
});

function makeSlide(overrides: Partial<ManifestSlide>): ManifestSlide {
  return {
    index: 1,
    id: 'slide-1',
    label: 'Slide 1',
    file: 'slides/01.html',
    thumbnail: null,
    notes: null,
    ...overrides,
  };
}

function makeManifest(slides: ManifestSlide[]): Manifest {
  return {
    schema: 'slidestage@1.0',
    id: 'test-deck',
    version: '0.0.0',
    title: 'Test',
    subtitle: null,
    author: null,
    description: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    architecture: 'split-html' as Manifest['architecture'],
    dimensions: { width: 1920, height: 1080 },
    totalSlides: slides.length,
    slides,
  };
}

function makeDeck(slides: ManifestSlide[], thumbnailUrls?: Array<string | null>): LoadedDeck {
  return {
    fileName: 'test.stage',
    fingerprint: 'sha256-deadbeef',
    deckId: 'deckA',
    manifest: makeManifest(slides),
    slideUrls: slides.map((s) => `/__stage/deckA/${s.file}`),
    slideHtml: slides.map(() => '<!doctype html><body></body>'),
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    thumbnailUrls: thumbnailUrls ?? slides.map(() => null),
    prefersSrcdoc: false,
    revoke: vi.fn(),
  };
}

describe('<Overview /> (identity fallback)', () => {
  it('renders every slide label and uses raw i18n keys for chrome text', () => {
    const deck = makeDeck([
      makeSlide({ index: 1, id: 's-1', label: 'Opening' }),
      makeSlide({ index: 2, id: 's-2', label: 'Architecture' }),
    ]);
    render(
      <Overview deck={deck} currentIndex={0} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Opening')).toBeTruthy();
    expect(screen.getByText('Architecture')).toBeTruthy();
    // identity translator: chrome text is the raw key
    expect(screen.getByRole('button', { name: 'overview.close' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('overview.title');
  });

  it('highlights the active card via the `active` className', () => {
    const deck = makeDeck([
      makeSlide({ index: 1, id: 's-1', label: 'One' }),
      makeSlide({ index: 2, id: 's-2', label: 'Two' }),
    ]);
    const { container } = render(
      <Overview deck={deck} currentIndex={1} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const cards = container.querySelectorAll('.overview-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.className).toBe('overview-card');
    expect(cards[1]?.className).toBe('overview-card active');
  });

  it('renders a thumbnail <img> when the deck supplies one and falls back to the slide index otherwise', () => {
    const deck = makeDeck(
      [
        makeSlide({ index: 1, id: 's-1', label: 'With thumb' }),
        makeSlide({ index: 2, id: 's-2', label: 'No thumb' }),
      ],
      ['blob:thumb-1', null],
    );
    render(
      <Overview deck={deck} currentIndex={0} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const img = document.querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob:thumb-1');
    expect(screen.getByText('2', { selector: '.thumbnail-fallback' })).toBeTruthy();
  });
});

describe('<Overview /> interactions', () => {
  it('calls onSelect with the clicked card index', () => {
    const onSelect = vi.fn();
    const deck = makeDeck([
      makeSlide({ index: 1, id: 's-1', label: 'One' }),
      makeSlide({ index: 2, id: 's-2', label: 'Two' }),
    ]);
    render(
      <Overview deck={deck} currentIndex={0} onSelect={onSelect} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Two'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('calls onClose when the close button fires', () => {
    const onClose = vi.fn();
    const deck = makeDeck([makeSlide({ id: 's-1', label: 'Only' })]);
    render(
      <Overview deck={deck} currentIndex={0} onSelect={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'overview.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<Overview /> with a UiTranslatorProvider', () => {
  it('shows the injected translations instead of the raw keys', () => {
    const inject: UiTranslator = {
      t: (key) => {
        switch (key) {
          case 'overview.title':
            return '幻灯片概览';
          case 'overview.close':
            return '关闭';
          case 'overview.aria':
            return '幻灯片概览面板';
          default:
            return key;
        }
      },
      tFormat: (key) => key,
    };
    const deck = makeDeck([makeSlide({ id: 's-1', label: 'Hello' })]);
    render(
      <UiTranslatorProvider value={inject}>
        <Overview deck={deck} currentIndex={0} onSelect={vi.fn()} onClose={vi.fn()} />
      </UiTranslatorProvider>,
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('幻灯片概览');
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });
});
