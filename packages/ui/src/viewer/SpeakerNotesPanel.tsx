import type { ManifestSlide } from '@slidestage/core/deck/types';
import { useUiTranslator } from '../i18n/translator';

interface SpeakerNotesPanelProps {
  slide: ManifestSlide;
  onClose: () => void;
}

export function SpeakerNotesPanel({ slide, onClose }: SpeakerNotesPanelProps) {
  const { t } = useUiTranslator();
  return (
    <aside className="notes-card" aria-label={t('speakerNotes.aria')}>
      <div className="panel-heading">
        <h3>{t('speakerNotes.title')}</h3>
        <button type="button" className="btn ghost small" onClick={onClose}>
          {t('speakerNotes.close')}
        </button>
      </div>
      <p>{slide.notes || t('speakerNotes.empty')}</p>
    </aside>
  );
}
