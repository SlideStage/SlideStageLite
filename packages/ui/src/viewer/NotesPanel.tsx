import { useEffect, useRef, type ChangeEvent } from 'react';
import type { ManifestSlide } from '@slidestage/core/deck/types';
import { useUiTranslator } from '../i18n/translator';
import { MarkdownView } from '../markdown/MarkdownView';

export interface NotesPanelProps {
  slide: ManifestSlide;
  /**
   * The text to display / edit. Owner passes the resolved value:
   * stored override (if any), falling back to `slide.notes`.
   */
  notes: string;
  /**
   * True when the displayed `notes` is a local override rather than the
   * baked-in slide notes. Drives the Reset button + the "edited locally"
   * meta line.
   */
  hasOverride: boolean;
  /** True when the textarea is shown (vs the read-only `<pre>` view). */
  editing: boolean;
  onToggleEditing: () => void;
  onResetOverride: () => void;
  onChange: (next: string) => void;
}

/**
 * Shared speaker-notes block. Renders title + slide meta line + Reset /
 * Edit-Done buttons + body (read-only `<pre>` or `<textarea>` based on
 * `editing`). When the panel enters editing mode it focuses the
 * textarea on the next animation frame so callers don't have to wire up
 * focus management themselves.
 */
export function NotesPanel({
  slide,
  notes,
  hasOverride,
  editing,
  onToggleEditing,
  onResetOverride,
  onChange,
}: NotesPanelProps) {
  const { t, tFormat } = useUiTranslator();
  const notesEditorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const handle = window.requestAnimationFrame(() => notesEditorRef.current?.focus());
    return () => window.cancelAnimationFrame(handle);
  }, [editing, slide.index]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value);
  };

  return (
    <div className="presenter-notes" data-testid="speaker-notes">
      <div className="presenter-notes-head">
        <strong>{t('viewer.notes.title')}</strong>
        <span className="muted small">
          {tFormat('viewer.notes.slideMeta', { n: slide.index, label: slide.label })}
          {hasOverride ? ` ${t('viewer.notes.editedLocally')}` : ''}
        </span>
        <div className="presenter-notes-actions">
          {hasOverride ? (
            <button
              type="button"
              className="btn ghost small"
              data-testid="reset-notes"
              onClick={onResetOverride}
            >
              {t('viewer.notes.reset')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost small"
            data-testid="toggle-notes-edit"
            onClick={onToggleEditing}
          >
            {editing ? t('viewer.notes.done') : t('viewer.notes.edit')}
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          ref={notesEditorRef}
          className="presenter-notes-editor"
          data-testid="speaker-notes-editor"
          value={notes}
          onChange={handleChange}
          spellCheck={false}
          placeholder={t('viewer.notes.placeholder')}
        />
      ) : notes.trim() !== '' ? (
        <MarkdownView
          source={notes}
          className="presenter-notes-body"
          testId="speaker-notes-body"
        />
      ) : (
        <p className="presenter-notes-empty muted">{t('viewer.notes.empty')}</p>
      )}
    </div>
  );
}
