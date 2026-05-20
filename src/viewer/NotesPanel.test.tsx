/**
 * `<NotesPanel />` pins the read / edit / override-reset flow extracted
 * from `DeckViewer.tsx` during Phase 4b. The host preset still owns
 * the localStorage round trip; this test only covers the rendering
 * contract and callback wiring.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesPanel } from '@slidestage/ui/viewer/NotesPanel';
import type { ManifestSlide } from '@slidestage/core/deck/types';

afterEach(() => {
  cleanup();
});

function makeSlide(overrides: Partial<ManifestSlide> = {}): ManifestSlide {
  return {
    index: 2,
    id: 'slide-2',
    label: 'Architecture',
    file: 'slides/02.html',
    thumbnail: null,
    notes: 'baseline notes',
    ...overrides,
  };
}

describe('<NotesPanel />', () => {
  it('renders the pre body when not in editing mode', () => {
    render(
      <NotesPanel
        slide={makeSlide()}
        notes="Hello"
        hasOverride={false}
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('speaker-notes')).toBeTruthy();
    // Body is a <pre> tag with the notes text.
    expect(document.querySelector('pre')?.textContent).toBe('Hello');
    expect(screen.queryByTestId('speaker-notes-editor')).toBeNull();
  });

  it('falls back to the empty-state translation when notes is blank', () => {
    render(
      <NotesPanel
        slide={makeSlide()}
        notes=""
        hasOverride={false}
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector('pre')?.textContent).toBe('viewer.notes.empty');
  });

  it('shows the reset button only when an override exists', () => {
    const { rerender } = render(
      <NotesPanel
        slide={makeSlide()}
        notes="baseline notes"
        hasOverride={false}
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('reset-notes')).toBeNull();
    rerender(
      <NotesPanel
        slide={makeSlide()}
        notes="overridden"
        hasOverride
        editing={false}
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('reset-notes')).toBeTruthy();
  });

  it('renders the textarea when editing and fires onChange', () => {
    const onChange = vi.fn();
    render(
      <NotesPanel
        slide={makeSlide()}
        notes="value"
        hasOverride
        editing
        onToggleEditing={vi.fn()}
        onResetOverride={vi.fn()}
        onChange={onChange}
      />,
    );
    const editor = screen.getByTestId('speaker-notes-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('value');
    fireEvent.change(editor, { target: { value: 'updated' } });
    expect(onChange).toHaveBeenCalledWith('updated');
  });

  it('fires toggle-editing / reset callbacks on click', () => {
    const toggle = vi.fn();
    const reset = vi.fn();
    render(
      <NotesPanel
        slide={makeSlide()}
        notes="value"
        hasOverride
        editing={false}
        onToggleEditing={toggle}
        onResetOverride={reset}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('toggle-notes-edit'));
    expect(toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('reset-notes'));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
