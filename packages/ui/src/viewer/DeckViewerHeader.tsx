import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileDown,
  Grid3X3,
  Pencil,
  Presentation,
  Radio,
  StickyNote,
  Undo2,
} from 'lucide-react';
import { useUiTranslator } from '../i18n/translator';

export type DeckViewerHeaderVariant = 'presenter' | 'single';

/**
 * Client-side "Export PDF" integration. The host preset owns the capture
 * + assembly + download machinery (it touches pdf-lib and Tauri); the
 * header only renders the button and reflects progress/availability.
 */
export interface DeckViewerExport {
  /** False when the deck can't be rasterized (e.g. streamed, not inlined). */
  available: boolean;
  /** True while an export run is in flight. */
  busy: boolean;
  /** Coarse phase used to pick the button label. */
  phase: 'idle' | 'capturing' | 'assembling' | 'saving' | 'done' | 'error';
  /** Slides captured so far (for the progress label). */
  current: number;
  /** Total slides to capture (for the progress label). */
  total: number;
  /** Last error message, surfaced as the button tooltip on failure. */
  error?: string | null;
  onExport: () => void;
}

/**
 * In-place slide text editing integration. The host preset owns patch
 * persistence, deck reload, and copy export; the header only renders the
 * toggle and (when edits exist) the export / discard actions.
 */
export interface DeckViewerEditing {
  /** True while edit mode is active. */
  active: boolean;
  onToggle: () => void;
  /** True when local edits exist for this deck. */
  hasEdits: boolean;
  /** Number of stored edits (label / tooltip context). */
  editCount: number;
  /** Export an edited `.stage` copy of the deck. */
  onExportCopy: () => void;
  /** True while the copy export is running. */
  exportBusy: boolean;
  /** Last export error, surfaced as the button tooltip. */
  exportError?: string | null;
  /** Drop every stored edit for this deck. */
  onDiscard: () => void;
  /** True when the per-deck edit budget is exhausted (new edits are dropped). */
  storageFull: boolean;
}

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
  /**
   * Optional "Export PDF" integration. When omitted, no export button is
   * rendered. Shared by both header variants.
   */
  exportPdf?: DeckViewerExport;
  /**
   * Optional slide text editing integration. When omitted, no edit
   * controls are rendered. Shared by both header variants.
   */
  editing?: DeckViewerEditing;
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
  const { t, tFormat } = useUiTranslator();
  const isPresenter = props.variant === 'presenter';

  const exportButton = props.exportPdf ? (
    <ExportPdfButton {...props.exportPdf} t={t} tFormat={tFormat} />
  ) : null;

  const editingControls = props.editing ? (
    <EditingControls {...props.editing} t={t} tFormat={tFormat} />
  ) : null;

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
      {editingControls}
      {exportButton}
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

interface EditingControlsProps extends DeckViewerEditing {
  t: (key: string) => string;
  tFormat: (key: string, vars?: Readonly<Record<string, string | number>>) => string;
}

function EditingControls({
  active,
  onToggle,
  hasEdits,
  editCount,
  onExportCopy,
  exportBusy,
  exportError,
  onDiscard,
  storageFull,
  t,
  tFormat,
}: EditingControlsProps) {
  const toggleTitle = storageFull
    ? t('viewer.editing.storageFull')
    : t('viewer.editing.toggleHint');

  return (
    <>
      <button
        type="button"
        className="btn ghost"
        data-testid="edit-toggle"
        onClick={onToggle}
        aria-pressed={active}
        aria-label={t('viewer.aria.editToggle')}
        title={toggleTitle}
      >
        <Pencil className="btn-icon" aria-hidden size={16} />
        {active ? t('viewer.action.editDone') : t('viewer.action.edit')}
      </button>
      {hasEdits ? (
        <>
          <button
            type="button"
            className="btn ghost"
            data-testid="export-edited"
            onClick={onExportCopy}
            disabled={exportBusy}
            aria-label={t('viewer.aria.exportEdited')}
            title={exportError ?? tFormat('viewer.action.editExportHint', { n: editCount })}
          >
            <FileDown className="btn-icon" aria-hidden size={16} />
            {exportBusy
              ? t('viewer.action.editExportBusy')
              : t('viewer.action.editExport')}
          </button>
          <button
            type="button"
            className="btn ghost icon-only"
            data-testid="discard-edits"
            onClick={onDiscard}
            aria-label={t('viewer.action.editDiscard')}
            title={t('viewer.action.editDiscard')}
          >
            <Undo2 className="btn-icon" aria-hidden size={18} />
          </button>
        </>
      ) : null}
    </>
  );
}

interface ExportPdfButtonProps extends DeckViewerExport {
  t: (key: string) => string;
  tFormat: (key: string, vars?: Readonly<Record<string, string | number>>) => string;
}

function ExportPdfButton({
  available,
  busy,
  phase,
  current,
  total,
  error,
  onExport,
  t,
  tFormat,
}: ExportPdfButtonProps) {
  let label: string;
  if (phase === 'capturing') {
    label = tFormat('viewer.action.exportPdfBusy', { current, total });
  } else if (phase === 'assembling' || phase === 'saving') {
    label = t('viewer.action.exportPdfBuilding');
  } else {
    label = t('viewer.action.exportPdf');
  }

  let title: string | undefined;
  if (!available) {
    title = t('viewer.action.exportPdfUnavailable');
  } else if (phase === 'error' && error) {
    title = error;
  }

  return (
    <button
      type="button"
      className="btn ghost"
      data-testid="export-pdf"
      onClick={onExport}
      disabled={!available || busy}
      title={title}
      aria-label={t('viewer.aria.exportPdf')}
    >
      <Download className="btn-icon" aria-hidden size={16} />
      {label}
    </button>
  );
}
