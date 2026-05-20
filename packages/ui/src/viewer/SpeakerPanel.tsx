import type { ManifestSlide } from '@slidestage/core/deck/types';
import { useUiTranslator } from '../i18n/translator';
import { DeckStage } from './DeckStage';
import { NotesPanel } from './NotesPanel';

export interface SpeakerPanelProps {
  slide: ManifestSlide;
  currentIndex: number;
  totalSlides: number;
  nextSlide: ManifestSlide | null;
  nextSlideUrl: string | null;
  nextSlideHtml?: string;
  iframeSandbox?: string;
  deckDimensions: { width: number; height: number };
  onClose: () => void;
  notes: string;
  hasOverride: boolean;
  editing: boolean;
  onToggleEditing: () => void;
  onResetOverride: () => void;
  onNotesChange: (next: string) => void;
}

/**
 * Right-side (or bottom) speaker panel used in the single-window
 * layout. Shows current/next slide previews + the embedded NotesPanel.
 * The presenter layout uses its own side rail + NotesPanel pair
 * instead.
 */
export function SpeakerPanel({
  slide,
  currentIndex,
  totalSlides,
  nextSlide,
  nextSlideUrl,
  nextSlideHtml,
  iframeSandbox,
  deckDimensions,
  onClose,
  notes,
  hasOverride,
  editing,
  onToggleEditing,
  onResetOverride,
  onNotesChange,
}: SpeakerPanelProps) {
  const { t, tFormat } = useUiTranslator();

  return (
    <aside
      className="speaker-panel"
      role="complementary"
      aria-label={t('viewer.aria.speakerPanel')}
      data-testid="speaker-panel"
    >
      <header>
        <h2>{t('viewer.speaker.title')}</h2>
        <button
          className="btn ghost"
          onClick={onClose}
          aria-label={t('viewer.aria.closeSpeaker')}
        >
          {t('viewer.action.closeSpeakerS')}
        </button>
      </header>
      <div className="speaker-grid">
        <div className="speaker-now">
          <div className="speaker-label muted">
            {tFormat('viewer.speaker.current', {
              n: currentIndex + 1,
              total: totalSlides,
            })}
          </div>
          <div className="speaker-current">
            <strong>
              {slide.label ||
                tFormat('viewer.title.current.live', {
                  n: slide.index,
                  label: slide.label,
                })}
            </strong>
          </div>
        </div>
        <div className="speaker-next">
          <div className="speaker-label muted">{t('viewer.speaker.next')}</div>
          {nextSlide && nextSlideUrl ? (
            <div className="speaker-next-preview">
              <DeckStage
                src={nextSlideUrl}
                srcdoc={nextSlideHtml}
                title={tFormat('viewer.title.next.live', {
                  n: nextSlide.index,
                  label: nextSlide.label,
                })}
                width={deckDimensions.width}
                height={deckDimensions.height}
                testId="next-deck-stage"
                sandbox={iframeSandbox}
              />
              <span className="speaker-next-label">
                <span className="muted">#{nextSlide.index}</span> {nextSlide.label || nextSlide.id}
              </span>
            </div>
          ) : (
            <div className="muted">{t('viewer.speaker.endOfDeck')}</div>
          )}
        </div>
      </div>
      <NotesPanel
        slide={slide}
        notes={notes}
        hasOverride={hasOverride}
        editing={editing}
        onToggleEditing={onToggleEditing}
        onResetOverride={onResetOverride}
        onChange={onNotesChange}
      />
    </aside>
  );
}
