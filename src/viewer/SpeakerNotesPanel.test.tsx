/**
 * Render contract for the package-owned `<SpeakerNotesPanel />`.
 *
 * Moved to `@slidestage/ui/viewer/SpeakerNotesPanel` in Phase 3.5. The
 * component is intentionally trivial: it shows the active slide's
 * `notes`, falls back to a localised "no notes" string when notes are
 * empty, and exposes a close button. These tests pin those three cases
 * plus the i18n provider override path.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeakerNotesPanel } from '@slidestage/ui/viewer/SpeakerNotesPanel';
import {
  UiTranslatorProvider,
  type UiTranslator,
} from '@slidestage/ui/i18n/translator';
import type { ManifestSlide } from '@slidestage/core/deck/types';

afterEach(() => {
  cleanup();
});

function makeSlide(overrides: Partial<ManifestSlide>): ManifestSlide {
  return {
    index: 1,
    id: 's-1',
    label: 'Slide 1',
    file: 'slides/01.html',
    thumbnail: null,
    notes: null,
    ...overrides,
  };
}

describe('<SpeakerNotesPanel />', () => {
  it('renders the slide notes when present (identity fallback chrome)', () => {
    const slide = makeSlide({ notes: 'Open with the laser pointer demo.' });
    render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(screen.getByText('Open with the laser pointer demo.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('speakerNotes.title');
  });

  it('falls back to the empty-notes key when notes are null', () => {
    const slide = makeSlide({ notes: null });
    render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(screen.getByText('speakerNotes.empty')).toBeTruthy();
  });

  it('falls back to the empty-notes key when notes are an empty string', () => {
    const slide = makeSlide({ notes: '' });
    render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(screen.getByText('speakerNotes.empty')).toBeTruthy();
  });

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<SpeakerNotesPanel slide={makeSlide({})} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'speakerNotes.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses injected translations under <UiTranslatorProvider>', () => {
    const inject: UiTranslator = {
      t: (key) => {
        switch (key) {
          case 'speakerNotes.title':
            return '演讲者备注';
          case 'speakerNotes.close':
            return '关闭';
          case 'speakerNotes.empty':
            return '（无备注）';
          case 'speakerNotes.aria':
            return '演讲者备注面板';
          default:
            return key;
        }
      },
      tFormat: (key) => key,
    };
    render(
      <UiTranslatorProvider value={inject}>
        <SpeakerNotesPanel slide={makeSlide({ notes: null })} onClose={vi.fn()} />
      </UiTranslatorProvider>,
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('演讲者备注');
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
    expect(screen.getByText('（无备注）')).toBeTruthy();
  });
});
