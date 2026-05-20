import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Grid3X3,
  Presentation,
  Radio,
  StickyNote,
} from 'lucide-react';
import { useUiTranslator } from '../i18n/translator';

export type DeckViewerHeaderVariant = 'presenter' | 'single';

export interface DeckViewerHeaderProps {
  variant: DeckViewerHeaderVariant;
  title: string;
  currentIndex: number;
  totalSlides: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  /**
   * When variant === 'single', the back button calls this to close the
   * deck entirely (returning to the landing page). Required for
   * variant === 'single', ignored otherwise.
   */
  onCloseDeck?: () => void;
  /**
   * When variant === 'presenter', the back button calls this to swap
   * back to single-window mode. Required for variant === 'presenter',
   * ignored otherwise.
   */
  onSwitchToSingle?: () => void;
  showOverview: boolean;
  onToggleOverview: () => void;
  /** Only used by variant === 'single'. */
  showNotes?: boolean;
  /** Only used by variant === 'single'. */
  onToggleNotes?: () => void;
  /** Only used by variant === 'single'. */
  onSwitchToPresenter?: () => void;
  /** Only used by variant === 'presenter'. */
  audienceConnected?: boolean;
  /** Only used by variant === 'presenter'. */
  onOpenAudienceWindow?: () => void;
}

/**
 * Shared header / toolbar for both the single-window and presenter
 * layouts of the deck viewer. Renders translation keys via
 * `useUiTranslator()` so it is reusable by any preset that mounts a
 * `<UiTranslatorProvider>`.
 */
export function DeckViewerHeader(props: DeckViewerHeaderProps) {
  const { t } = useUiTranslator();
  const isPresenter = props.variant === 'presenter';

  return (
    <header
      className={`viewer-header ${isPresenter ? 'presenter-view-toolbar' : 'deck-viewer-toolbar'}`}
    >
      {isPresenter ? (
        <button
          type="button"
          className="btn ghost"
          data-testid="open-single-view"
          onClick={props.onSwitchToSingle}
          aria-label={t('viewer.aria.backToViewer')}
        >
          <ArrowLeft className="btn-icon" aria-hidden size={16} />
          {t('viewer.action.singleWindow')}
        </button>
      ) : (
        <button
          type="button"
          className="btn ghost"
          data-testid="close-deck"
          onClick={props.onCloseDeck}
          aria-label={t('viewer.aria.closeDeck')}
        >
          <ArrowLeft className="btn-icon" aria-hidden size={16} />
          {t('viewer.action.closeDeck')}
        </button>
      )}
      <h2 className="deck-title">{props.title}</h2>
      <div
        className="deck-counter"
        role="status"
        aria-label={t('viewer.aria.slideCounter')}
      >
        {props.currentIndex + 1} / {props.totalSlides}
      </div>
      <div className="deck-toolbar-spacer" />
      <button
        type="button"
        className="btn ghost icon-only"
        onClick={props.onNavigatePrev}
        disabled={!props.canGoPrev}
        aria-label={t('viewer.aria.previous')}
      >
        <ChevronLeft className="btn-icon" aria-hidden size={18} />
      </button>
      <button
        type="button"
        className="btn ghost icon-only"
        onClick={props.onNavigateNext}
        disabled={!props.canGoNext}
        aria-label={t('viewer.aria.next')}
      >
        <ChevronRight className="btn-icon" aria-hidden size={18} />
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={props.onToggleOverview}
        aria-pressed={props.showOverview}
        data-testid="overview-button"
      >
        <Grid3X3 className="btn-icon" aria-hidden size={16} />
        {t('viewer.action.overview')}
      </button>
      {isPresenter ? (
        <button
          type="button"
          className={`btn ${props.audienceConnected ? 'ghost' : 'primary'}`}
          data-testid="open-audience"
          onClick={props.onOpenAudienceWindow}
        >
          {props.audienceConnected ? (
            <>
              <Radio className="btn-icon" aria-hidden size={16} />
              {t('viewer.action.audienceLive')}
            </>
          ) : (
            <>
              <ExternalLink className="btn-icon" aria-hidden size={16} />
              {t('viewer.action.openAudience')}
            </>
          )}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn ghost"
            aria-pressed={props.showNotes}
            onClick={props.onToggleNotes}
            data-testid="speaker-button"
          >
            <StickyNote className="btn-icon" aria-hidden size={16} />
            {t('viewer.action.speaker')}
          </button>
          <button
            type="button"
            className="btn primary"
            data-testid="open-presenter-view"
            onClick={props.onSwitchToPresenter}
            title={t('viewer.action.presenterViewHint')}
          >
            <Presentation className="btn-icon" aria-hidden size={16} />
            {t('viewer.action.presenterView')}
          </button>
        </>
      )}
    </header>
  );
}
