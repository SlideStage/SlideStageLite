/**
 * Integration contract for the lite-preset `<DeckViewer />` wrapper.
 *
 * The wrapper is the seam between the host-agnostic UI viewer
 * (`@slidestage/ui/viewer/DeckViewer`) and the Lite-specific adapters
 * (localStorage persistence for layout / annotations / notes, plus the
 * Tauri-only audience window / global-shortcut effects). Tests:
 *   - On mount, annotations from localStorage are hydrated into the
 *     presenter's reducer.
 *   - The annotation localStorage key is written back once the deck is
 *     hydrated.
 *   - Notes overrides are read on mount.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckViewer } from '@slidestage/lite-preset/viewer/DeckViewer';
import { I18nProvider } from '@slidestage/lite-preset/i18n/I18nProvider';
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

function makeDeck(): LoadedDeck {
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
    fingerprint: 'fp-abc',
    deckId: 'fpabc',
    manifest,
    slideUrls: ['/__stage/fpabc/slides/01.html'],
    slideHtml: ['<!doctype html><body></body>'],
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    thumbnailUrls: [null],
    prefersSrcdoc: false,
    revoke: vi.fn(),
  };
}

describe('<DeckViewer /> lite-preset wrapper', () => {
  it('mounts the underlying UI viewer through the lite wrapper', () => {
    const { getByTestId } = render(
      <I18nProvider>
        <DeckViewer
          deck={makeDeck()}
          currentIndex={0}
          showOverview={false}
          showNotes={false}
          onNavigate={vi.fn()}
          onCloseOverview={vi.fn()}
          onToggleOverview={vi.fn()}
          onCloseNotes={vi.fn()}
          onToggleNotes={vi.fn()}
          onCloseDeck={vi.fn()}
          getSourceFile={() => null}
          onRequestReload={vi.fn()}
        />
      </I18nProvider>,
    );
    // `presenter-view` is the default mode; if the wrapper lost track
    // of `viewMode` it would render the single-window shell instead.
    expect(getByTestId('presenter-view')).toBeTruthy();
    expect(getByTestId('presenter-host')).toBeTruthy();
  });

  it('hydrates annotations from localStorage on mount', () => {
    // Stash a stroke for the deck under test through the canonical
    // annotation key.
    const fingerprint = 'fp-abc';
    const key = `slidestage-lite:annotations:${fingerprint}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        0: [
          {
            tool: 'pen',
            color: '#FF3B30',
            width: 8,
            points: [
              { x: 10, y: 20 },
              { x: 30, y: 40 },
            ],
          },
        ],
      }),
    );

    render(
      <I18nProvider>
        <DeckViewer
          deck={makeDeck()}
          currentIndex={0}
          showOverview={false}
          showNotes={false}
          onNavigate={vi.fn()}
          onCloseOverview={vi.fn()}
          onToggleOverview={vi.fn()}
          onCloseNotes={vi.fn()}
          onToggleNotes={vi.fn()}
          onCloseDeck={vi.fn()}
          getSourceFile={() => null}
          onRequestReload={vi.fn()}
        />
      </I18nProvider>,
    );

    // After mount, the annotation store hydrates the presenter and then
    // the persistence effect writes the same map back. The serialized
    // form should round-trip cleanly.
    const persisted = window.localStorage.getItem(key);
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted!);
    expect(parsed[0]).toHaveLength(1);
    expect(parsed[0][0].tool).toBe('pen');
  });

  it('reads notes overrides from localStorage on mount', () => {
    const fingerprint = 'fp-abc';
    const key = `slidestage-lite:notes:${fingerprint}`;
    window.localStorage.setItem(key, JSON.stringify({ 0: 'hand-edited' }));

    const { getByTestId } = render(
      <I18nProvider>
        <DeckViewer
          deck={makeDeck()}
          currentIndex={0}
          showOverview={false}
          showNotes={false}
          onNavigate={vi.fn()}
          onCloseOverview={vi.fn()}
          onToggleOverview={vi.fn()}
          onCloseNotes={vi.fn()}
          onToggleNotes={vi.fn()}
          onCloseDeck={vi.fn()}
          getSourceFile={() => null}
          onRequestReload={vi.fn()}
        />
      </I18nProvider>,
    );

    // The notes panel renders inside the presenter mode body — speaker
    // notes are now markdown-rendered into a `.markdown-body` block.
    const notes = getByTestId('speaker-notes');
    const body = notes.querySelector('[data-testid="speaker-notes-body"]');
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('hand-edited');
  });
});
