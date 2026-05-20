/**
 * `<SpeakerPanel />` is the single-window speaker drawer that hosts
 * current + next slide preview and an embedded `<NotesPanel />`. The
 * test pins: end-of-deck branch, close button, and the slide-meta
 * label propagation into the embedded NotesPanel.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SpeakerPanel } from '@slidestage/ui/viewer/SpeakerPanel';
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
    index: 1,
    id: 'now',
    label: 'Current slide',
    file: 'slides/01.html',
    thumbnail: null,
    notes: 'baseline',
    ...overrides,
  };
}

describe('<SpeakerPanel />', () => {
  it('renders end-of-deck branch when no next slide is available', () => {
    render(
      <SpeakerPanel
        slide={makeSlide()}
        currentIndex={0}
        totalSlides={1}
        nextSlide={null}
        nextSlideUrl={null}
        deckDimensions={{ width: 1920, height: 1080 }}
        onClose={vi.fn()}
        notes="baseline"
        hasOverride={false}
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onNotesChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('speaker-panel')).toBeTruthy();
    expect(screen.getByText('viewer.speaker.endOfDeck')).toBeTruthy();
  });

  it('renders next-slide preview iframe when both slide and url are present', () => {
    render(
      <SpeakerPanel
        slide={makeSlide()}
        currentIndex={0}
        totalSlides={2}
        nextSlide={makeSlide({ index: 2, id: 'next', label: 'Next' })}
        nextSlideUrl="/__stage/deck/slides/02.html"
        deckDimensions={{ width: 1920, height: 1080 }}
        onClose={vi.fn()}
        notes="baseline"
        hasOverride={false}
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onNotesChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('next-deck-stage')).toBeTruthy();
  });

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SpeakerPanel
        slide={makeSlide()}
        currentIndex={0}
        totalSlides={1}
        nextSlide={null}
        nextSlideUrl={null}
        deckDimensions={{ width: 1920, height: 1080 }}
        onClose={onClose}
        notes=""
        hasOverride={false}
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onNotesChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'viewer.aria.closeSpeaker' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('embeds the notes panel and forwards onNotesChange', () => {
    const onNotesChange = vi.fn();
    render(
      <SpeakerPanel
        slide={makeSlide()}
        currentIndex={0}
        totalSlides={1}
        nextSlide={null}
        nextSlideUrl={null}
        deckDimensions={{ width: 1920, height: 1080 }}
        onClose={vi.fn()}
        notes="value"
        hasOverride={false}
        editing
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onNotesChange={onNotesChange}
      />,
    );
    const editor = screen.getByTestId('speaker-notes-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'updated' } });
    expect(onNotesChange).toHaveBeenCalledWith('updated');
  });
});
