import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import { useUiTranslator } from '../i18n/translator';
import type { Point, Stroke } from '../presenter/types';
import type { PresenterApi } from '../presenter/usePresenter';
import type { AudiencePresentationState } from '../presenter/usePresentationSync';
import { DeckViewerHeader } from './DeckViewerHeader';
import { NotesPanel } from './NotesPanel';
import { Overview } from './Overview';
import { PresenterSideRail } from './PresenterSideRail';
import { PresenterStageBlock } from './PresenterStageBlock';
import { SpeakerPanel } from './SpeakerPanel';
import { useAudiencePointerTracking } from './useAudiencePointerTracking';
import { useDeckViewerResize } from './useDeckViewerResize';
import { chooseUseSrcdoc, strokeHitTest } from './viewMath';

export type DeckViewerLayoutMode = 'presenter' | 'single';

export interface DeckViewerLayout {
  mode: DeckViewerLayoutMode;
  onModeChange: (next: DeckViewerLayoutMode) => void;
  sideWidth: number;
  onSideWidthChange: (next: number) => void;
  notesHeight: number;
  onNotesHeightChange: (next: number) => void;
}

export interface DeckViewerNotesOverrides {
  /** Sparse map of slide index → user-typed override. */
  overrides: Readonly<Record<number, string>>;
  onOverridesChange: (
    next:
      | Record<number, string>
      | ((prev: Readonly<Record<number, string>>) => Record<number, string>),
  ) => void;
}

export interface DeckViewerAudienceProps {
  connected: boolean;
  /**
   * Fires every time the audience-presentation snapshot changes so the
   * surrounding preset can mirror it over the sync transport. The UI
   * component is intentionally transport-agnostic.
   */
  onPresentationChange: (next: AudiencePresentationState) => void;
  /**
   * Called when the user clicks "Open audience window". The wrapper
   * decides whether to spawn a Tauri WebviewWindow, a Web popup, or
   * surface a monitor picker.
   */
  onOpenWindow: () => void | Promise<void>;
}

export interface DeckViewerProps {
  deck: LoadedDeck;
  currentIndex: number;
  showOverview: boolean;
  showNotes: boolean;
  iframeSandbox?: string;

  onNavigate: (index: number) => void;
  onCloseOverview: () => void;
  onToggleOverview: () => void;
  onCloseNotes: () => void;
  onToggleNotes: () => void;
  onCloseDeck: () => void;

  /** Layout state owned by the host preset (e.g. persisted to localStorage). */
  layout: DeckViewerLayout;

  /** Presenter API created by the host preset via `usePresenter()`. */
  presenter: PresenterApi;

  /** Speaker-notes overrides + setter owned by the host preset. */
  notes: DeckViewerNotesOverrides;

  /**
   * Optional thumbnail URLs (desktop captures them, the web build
   * leaves them undefined). When provided, the Overview overlay uses
   * them instead of the deck's own `thumbnailUrls` so the wrapper can
   * blend desktop-captured WebPs over the deck's bundled thumbnails.
   */
  thumbnailUrls?: ReadonlyArray<string | null>;

  /**
   * True when running inside a Tauri WebView. Used to bias the
   * src-vs-srcdoc decision (Tauri can't navigate to `blob:tauri://...`).
   */
  isTauriHost: boolean;

  /**
   * Audience window integration. Pass `undefined` to disable the
   * audience entry point entirely.
   */
  audience?: DeckViewerAudienceProps;

  /**
   * Optional slot rendered as a sibling of the layout body. Lite-preset
   * uses this to mount the Tauri MonitorPicker only when needed without
   * leaking the desktop concept into the UI layer.
   */
  slots?: {
    overlay?: ReactNode;
  };
}

/**
 * Reusable, host-agnostic deck viewer. Computes derived rendering
 * state (audience pointer tracking, srcdoc decision, broadcastable
 * presentation snapshot) but delegates persistence + transport +
 * desktop window concerns to the surrounding preset via props.
 */
export function DeckViewer(props: DeckViewerProps) {
  const {
    deck,
    currentIndex,
    showOverview,
    showNotes,
    iframeSandbox,
    onNavigate,
    onCloseOverview,
    onToggleOverview,
    onCloseNotes,
    onToggleNotes,
    onCloseDeck,
    layout,
    presenter,
    notes,
    thumbnailUrls,
    isTauriHost,
    audience,
    slots,
  } = props;

  const { t } = useUiTranslator();
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const startedAtRef = useRef<number>(performance.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);

  // Reset the editing flag whenever the deck identity changes so the
  // wrapper doesn't have to remember to do it.
  useEffect(() => {
    setEditingNotes(false);
  }, [deck.fingerprint]);

  // Wall-clock timer for the side rail's "Timer" card.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const resetTimer = useCallback(() => {
    startedAtRef.current = performance.now();
    setElapsedMs(0);
  }, []);

  const slide = deck.manifest.slides[currentIndex];
  const nextSlide = deck.manifest.slides[currentIndex + 1] ?? null;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < deck.manifest.totalSlides - 1;
  const nextSlideUrl = nextSlide ? deck.slideUrls[currentIndex + 1] : null;
  const useSrcdoc = chooseUseSrcdoc({ deck, isTauriHost, iframeSandbox });
  const nextSlideHtml = useSrcdoc && nextSlide ? deck.slideHtml[currentIndex + 1] : undefined;
  const preloadSrcs = useSrcdoc
    ? []
    : [deck.slideUrls[currentIndex - 1], deck.slideUrls[currentIndex + 1]].filter(
        (url): url is string => Boolean(url),
      );

  const audiencePointer = useAudiencePointerTracking({
    hostRef: stageHostRef,
    presenterTool: presenter.state.tool,
    deckDimensions: deck.manifest.dimensions,
  });

  // Build the "broadcastable" stroke map: the persisted presenter
  // strokes plus the in-flight draft stroke (if any) so the audience
  // mirrors the line the presenter is still drawing in real time.
  const broadcastStrokes = useMemo(() => {
    if (!draftStroke || draftStroke.points.length === 0) {
      return presenter.state.strokesByIdx;
    }
    const existing = presenter.state.strokesByIdx[currentIndex] ?? [];
    return {
      ...presenter.state.strokesByIdx,
      [currentIndex]: [...existing, draftStroke],
    };
  }, [currentIndex, draftStroke, presenter.state.strokesByIdx]);

  const audiencePresentation = useMemo<AudiencePresentationState>(
    () => ({
      currentIndex,
      tool: presenter.state.tool,
      strokesByIdx: broadcastStrokes,
      spotlightRadius: presenter.state.spotlightRadius,
      pointer: audiencePointer,
    }),
    [
      audiencePointer,
      broadcastStrokes,
      currentIndex,
      presenter.state.spotlightRadius,
      presenter.state.tool,
    ],
  );

  // Push audience-presentation updates to the wrapper. The handler is
  // captured via a ref so re-renders of an unstable callback don't
  // retrigger the effect — we only want to fire when the snapshot
  // actually changes.
  const onPresentationChangeRef = useRef(audience?.onPresentationChange);
  onPresentationChangeRef.current = audience?.onPresentationChange;
  useEffect(() => {
    onPresentationChangeRef.current?.(audiencePresentation);
  }, [audiencePresentation]);

  const effectiveDeck = useMemo<LoadedDeck>(() => {
    if (!thumbnailUrls) return deck;
    return { ...deck, thumbnailUrls: [...thumbnailUrls] };
  }, [deck, thumbnailUrls]);

  const appendStroke = useCallback(
    (stroke: Stroke) => {
      presenter.appendStroke(currentIndex, stroke);
    },
    [currentIndex, presenter],
  );

  const eraseAtPoint = useCallback(
    (point: Point) => {
      presenter.replaceSlideStrokes(
        currentIndex,
        (presenter.state.strokesByIdx[currentIndex] ?? []).filter(
          (stroke) => !strokeHitTest(stroke, point),
        ),
      );
    },
    [currentIndex, presenter],
  );

  const slideNotes = useMemo(() => {
    const stored = notes.overrides[currentIndex];
    if (typeof stored === 'string') return stored;
    return slide.notes ?? '';
  }, [notes.overrides, currentIndex, slide.notes]);

  const hasNotesOverride = Object.prototype.hasOwnProperty.call(notes.overrides, currentIndex);

  const handleNotesChange = useCallback(
    (next: string) => {
      notes.onOverridesChange((prev) => ({ ...prev, [currentIndex]: next }));
    },
    [currentIndex, notes],
  );

  const toggleEditingNotes = useCallback(() => {
    setEditingNotes((value) => !value);
  }, []);

  const resetNotesOverride = useCallback(() => {
    notes.onOverridesChange((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, currentIndex)) return { ...prev };
      const next: Record<number, string> = { ...prev };
      delete next[currentIndex];
      return next;
    });
  }, [currentIndex, notes]);

  const startSideResize = useDeckViewerResize({
    containerRef: bodyRef,
    axis: 'horizontal',
    setSize: layout.onSideWidthChange,
  });

  const startNotesResize = useDeckViewerResize({
    containerRef: rootRef,
    axis: 'vertical',
    setSize: layout.onNotesHeightChange,
  });

  const sectionStyle = {
    ['--side-w' as string]: `${layout.sideWidth}px`,
    ['--notes-h' as string]: `${layout.notesHeight}px`,
  } as CSSProperties;

  const stageBlock = (
    <PresenterStageBlock
      hostRef={stageHostRef}
      deck={deck}
      currentIndex={currentIndex}
      iframeSandbox={iframeSandbox}
      useSrcdoc={useSrcdoc}
      preloadSrcs={preloadSrcs}
      presenter={presenter}
      audiencePointer={audiencePointer}
      onAppendStroke={appendStroke}
      onErase={eraseAtPoint}
      onDraftStrokeChange={setDraftStroke}
      toolbarMode={layout.mode === 'single' ? 'auto-hide' : 'right-dock'}
    />
  );

  const overviewOverlay = showOverview ? (
    <Overview
      deck={effectiveDeck}
      currentIndex={currentIndex}
      onSelect={(index) => {
        onNavigate(index);
        onCloseOverview();
      }}
      onClose={onCloseOverview}
    />
  ) : null;

  if (layout.mode === 'single') {
    return (
      <section
        ref={rootRef}
        className="viewer deck-viewer lite-deck-viewer"
        aria-label={t('viewer.aria.deckViewer')}
        data-testid="deck-viewer"
        data-view-mode="single"
      >
        <DeckViewerHeader
          variant="single"
          title={deck.manifest.title}
          currentIndex={currentIndex}
          totalSlides={deck.manifest.totalSlides}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onNavigatePrev={() => onNavigate(currentIndex - 1)}
          onNavigateNext={() => onNavigate(currentIndex + 1)}
          onCloseDeck={onCloseDeck}
          showOverview={showOverview}
          onToggleOverview={onToggleOverview}
          showNotes={showNotes}
          onToggleNotes={onToggleNotes}
          onSwitchToPresenter={() => layout.onModeChange('presenter')}
        />

        <div className={`deck-viewer-body${showNotes ? ' with-speaker' : ''}`} ref={bodyRef}>
          {stageBlock}
          {showNotes ? (
            <SpeakerPanel
              slide={slide}
              currentIndex={currentIndex}
              totalSlides={deck.manifest.totalSlides}
              nextSlide={nextSlide}
              nextSlideUrl={nextSlideUrl}
              nextSlideHtml={nextSlideHtml}
              iframeSandbox={iframeSandbox}
              deckDimensions={deck.manifest.dimensions}
              onClose={onCloseNotes}
              notes={slideNotes}
              hasOverride={hasNotesOverride}
              editing={editingNotes}
              onToggleEditing={toggleEditingNotes}
              onResetOverride={resetNotesOverride}
              onNotesChange={handleNotesChange}
            />
          ) : null}
        </div>

        {overviewOverlay}
        {slots?.overlay}
      </section>
    );
  }

  return (
    <section
      ref={rootRef}
      className="viewer presenter-view lite-presenter-view"
      aria-label={t('viewer.aria.deckViewer')}
      data-testid="presenter-view"
      data-view-mode="presenter"
      style={sectionStyle}
    >
      <DeckViewerHeader
        variant="presenter"
        title={deck.manifest.title}
        currentIndex={currentIndex}
        totalSlides={deck.manifest.totalSlides}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        onNavigatePrev={() => onNavigate(currentIndex - 1)}
        onNavigateNext={() => onNavigate(currentIndex + 1)}
        onSwitchToSingle={() => layout.onModeChange('single')}
        showOverview={showOverview}
        onToggleOverview={onToggleOverview}
        audienceConnected={audience?.connected ?? false}
        onOpenAudienceWindow={audience ? () => void audience.onOpenWindow() : undefined}
      />

      <div className="presenter-view-body" ref={bodyRef}>
        {stageBlock}

        <div
          className="presenter-side-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('viewer.aria.resizeSide')}
          data-testid="presenter-side-resizer"
          onPointerDown={startSideResize}
        />

        <PresenterSideRail
          upNext={{
            slide: nextSlide,
            src: nextSlideUrl,
            srcdoc: nextSlideHtml,
            iframeSandbox,
            deckDimensions: deck.manifest.dimensions,
          }}
          timer={{ elapsedMs, onReset: resetTimer }}
          audience={{ connected: audience?.connected ?? false }}
        />
      </div>

      <div
        className="presenter-notes-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('viewer.aria.resizeNotes')}
        data-testid="presenter-notes-resizer"
        onPointerDown={startNotesResize}
      />

      <NotesPanel
        slide={slide}
        notes={slideNotes}
        hasOverride={hasNotesOverride}
        editing={editingNotes}
        onToggleEditing={toggleEditingNotes}
        onResetOverride={resetNotesOverride}
        onChange={handleNotesChange}
      />

      {overviewOverlay}
      {slots?.overlay}
    </section>
  );
}
