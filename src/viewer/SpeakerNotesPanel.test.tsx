/**
 * Render contract for the package-owned `<SpeakerNotesPanel />`.
 *
 * Moved to `@slidestage/ui/viewer/SpeakerNotesPanel` in Phase 3.5. The
 * component shows the active slide's `notes` rendered through
 * `<MarkdownView />`, falls back to a localised "no notes" string when
 * notes are empty, and exposes a close button. These tests pin those
 * three cases plus the i18n provider override path, and additionally
 * lock in the markdown-rendering + sanitization contract.
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
  it('renders the slide notes when present (plain paragraph stays a paragraph)', () => {
    const slide = makeSlide({ notes: 'Open with the laser pointer demo.' });
    const { container } = render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(screen.getByText('Open with the laser pointer demo.')).toBeTruthy();
    const body = container.querySelector('.markdown-body');
    expect(body).not.toBeNull();
    expect(body?.querySelector('p')?.textContent).toBe('Open with the laser pointer demo.');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('speakerNotes.title');
  });

  it('renders markdown structure in the notes body', () => {
    const slide = makeSlide({
      notes: '# Intro\n\n- **Beat 1**\n- *Beat 2*\n- `code`',
    });
    const { container } = render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    const body = container.querySelector('.markdown-body');
    expect(body).not.toBeNull();
    expect(body?.querySelector('h1')?.textContent).toBe('Intro');
    expect(body?.querySelectorAll('li').length).toBe(3);
    expect(body?.querySelector('strong')?.textContent).toBe('Beat 1');
    expect(body?.querySelector('em')?.textContent).toBe('Beat 2');
    expect(body?.querySelector('code')?.textContent).toBe('code');
  });

  it('does not inject raw script tags found in the notes', () => {
    const slide = makeSlide({ notes: '<script>boom()</script>' });
    const { container } = render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('boom()');
  });

  it('falls back to the empty-notes key when notes are null', () => {
    const slide = makeSlide({ notes: null });
    const { container } = render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(screen.getByText('speakerNotes.empty')).toBeTruthy();
    expect(container.querySelector('.markdown-body')).toBeNull();
  });

  it('falls back to the empty-notes key when notes are an empty string', () => {
    const slide = makeSlide({ notes: '' });
    const { container } = render(<SpeakerNotesPanel slide={slide} onClose={vi.fn()} />);
    expect(screen.getByText('speakerNotes.empty')).toBeTruthy();
    expect(container.querySelector('.markdown-body')).toBeNull();
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
