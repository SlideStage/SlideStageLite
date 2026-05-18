import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
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
import type { LoadedDeck } from '../deck/types';
import { isTauri } from '../desktop/env';
import { useI18n } from '../i18n/I18nProvider';
import { loadAnnotations, saveAnnotations } from '../persistence/annotationStore';
import { loadNotes, saveNotes, type StoredNotes } from '../persistence/notesStore';
import { AnnotationOverlay } from '../presenter/AnnotationOverlay';
import { Blackout } from '../presenter/Blackout';
import { LaserPointer } from '../presenter/LaserPointer';
import { Spotlight } from '../presenter/Spotlight';
import { Toolbar } from '../presenter/Toolbar';
import type { Point, Stroke } from '../presenter/types';
import { usePersistedNumber } from '../presenter/usePersistedNumber';
import { usePresenter, usePresenterShortcuts } from '../presenter/usePresenter';
import {
  makeAudiencePresentation,
  serializeAudienceDeck,
  usePresentationSync,
  type AudienceMessage,
  type AudiencePointer,
  type AudiencePresentationState,
} from '../presenter/usePresentationSync';
import { DeckStage } from './DeckStage';
import { Overview } from './Overview';

const SIDE_WIDTH_KEY = 'hcslides-lite:side-w';
const NOTES_HEIGHT_KEY = 'hcslides-lite:notes-h';
const VIEW_MODE_KEY = 'hcslides-lite:view-mode';
const SIDE_WIDTH_MIN = 240;
const SIDE_WIDTH_MAX = 640;
const NOTES_HEIGHT_MIN = 96;
const NOTES_HEIGHT_MAX = 480;

type ViewMode = 'presenter' | 'single';

function loadInitialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'presenter';
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    return stored === 'single' ? 'single' : 'presenter';
  } catch {
    return 'presenter';
  }
}

function persistViewMode(mode: ViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // ignore quota / disabled storage
  }
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function strokeHitTest(stroke: Stroke, point: Point): boolean {
  const tolerance = Math.max(stroke.width, 18);
  return stroke.points.some((start, index) => {
    const end = stroke.points[index + 1];
    return end ? distanceToSegment(point, start, end) <= tolerance : false;
  });
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

interface DeckViewerProps {
  deck: LoadedDeck;
  currentIndex: number;
  showOverview: boolean;
  showNotes: boolean;
  /**
   * `sandbox` attribute applied to every slide iframe. The parent computes
   * this from the trust decision (see `App.tsx`); when omitted, defaults to
   * the runtime baseline.
   */
  iframeSandbox?: string;
  onNavigate: (index: number) => void;
  onCloseOverview: () => void;
  onToggleOverview: () => void;
  onCloseNotes: () => void;
  onToggleNotes: () => void;
  onCloseDeck: () => void;
}

export function DeckViewer({
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
}: DeckViewerProps) {
  const { t, tFormat } = useI18n();
  const presenter = usePresenter();
  usePresenterShortcuts(presenter, currentIndex);
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const startedAtRef = useRef(performance.now());
  const [sideWidth, setSideWidth] = usePersistedNumber({
    key: SIDE_WIDTH_KEY,
    initial: 360,
    min: SIDE_WIDTH_MIN,
    max: SIDE_WIDTH_MAX,
  });
  const [notesHeight, setNotesHeight] = usePersistedNumber({
    key: NOTES_HEIGHT_KEY,
    initial: 170,
    min: NOTES_HEIGHT_MIN,
    max: NOTES_HEIGHT_MAX,
  });
  const [annotationsHydrated, setAnnotationsHydrated] = useState(false);
  const [notesOverrides, setNotesOverrides] = useState<StoredNotes>({});
  const [notesHydrated, setNotesHydrated] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const notesEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [audiencePointer, setAudiencePointer] = useState<AudiencePointer | null>(null);
  const [audienceConnected, setAudienceConnected] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>(loadInitialViewMode);
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    persistViewMode(mode);
  }, []);
  const slide = deck.manifest.slides[currentIndex];
  const nextSlide = deck.manifest.slides[currentIndex + 1];
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < deck.manifest.totalSlides - 1;
  const currentStrokes = presenter.state.strokesByIdx[currentIndex] ?? [];
  const preloadSrcs = [deck.slideUrls[currentIndex - 1], deck.slideUrls[currentIndex + 1]].filter(
    (url): url is string => Boolean(url),
  );
  const nextSlideUrl = nextSlide ? deck.slideUrls[currentIndex + 1] : null;
  // In the Tauri desktop build we render the active slide via `srcdoc`
  // (see DeckStage.tsx for why); the Web build sticks with `src=blob:`
  // and ignores `srcdoc` to avoid duplicating the HTML in the DOM.
  const useSrcdoc = isTauri();
  const currentSlideHtml = useSrcdoc ? deck.slideHtml[currentIndex] : undefined;
  const nextSlideHtml = useSrcdoc && nextSlide ? deck.slideHtml[currentIndex + 1] : undefined;
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
  const audiencePresentation = useMemo(
    () =>
      makeAudiencePresentation(
        currentIndex,
        { ...presenter.state, strokesByIdx: broadcastStrokes },
        audiencePointer,
      ),
    [audiencePointer, broadcastStrokes, currentIndex, presenter.state],
  );
  const audiencePresentationRef = useRef(audiencePresentation);
  audiencePresentationRef.current = audiencePresentation;

  const appendStroke = (stroke: Stroke) => {
    presenter.appendStroke(currentIndex, stroke);
  };

  const eraseAtPoint = (point: Point) => {
    presenter.replaceSlideStrokes(
      currentIndex,
      (presenter.state.strokesByIdx[currentIndex] ?? []).filter((stroke) => !strokeHitTest(stroke, point)),
    );
  };

  const resetTimer = useCallback(() => {
    startedAtRef.current = performance.now();
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    setAnnotationsHydrated(false);
    presenter.loadStrokes(loadAnnotations(deck.fingerprint));
    setAnnotationsHydrated(true);
  }, [deck.fingerprint, presenter.loadStrokes]);

  useEffect(() => {
    if (!annotationsHydrated) {
      return;
    }
    saveAnnotations(deck.fingerprint, presenter.state.strokesByIdx);
  }, [annotationsHydrated, deck.fingerprint, presenter.state.strokesByIdx]);

  useEffect(() => {
    setNotesHydrated(false);
    setNotesOverrides(loadNotes(deck.fingerprint));
    setNotesHydrated(true);
    setEditingNotes(false);
  }, [deck.fingerprint]);

  useEffect(() => {
    if (!notesHydrated) return;
    saveNotes(deck.fingerprint, notesOverrides);
  }, [notesHydrated, deck.fingerprint, notesOverrides]);

  const slideNotes = useMemo(() => {
    const stored = notesOverrides[currentIndex];
    if (typeof stored === 'string') return stored;
    return slide.notes ?? '';
  }, [notesOverrides, currentIndex, slide.notes]);

  const hasNotesOverride = Object.prototype.hasOwnProperty.call(notesOverrides, currentIndex);

  const handleNotesChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setNotesOverrides((prev) => ({ ...prev, [currentIndex]: value }));
    },
    [currentIndex],
  );

  const resetNotesOverride = useCallback(() => {
    setNotesOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, currentIndex)) return prev;
      const next: StoredNotes = { ...prev };
      delete next[currentIndex];
      return next;
    });
  }, [currentIndex]);

  useEffect(() => {
    if (!editingNotes) return;
    const handle = window.requestAnimationFrame(() => notesEditorRef.current?.focus());
    return () => window.cancelAnimationFrame(handle);
  }, [editingNotes, currentIndex]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const sendSnapshot = useCallback(
    (sync: { send: (msg: AudienceMessage) => void }, presentation: AudiencePresentationState) => {
      sync.send({
        type: 'snapshot',
        snapshot: { deck: serializeAudienceDeck(deck), presentation },
      });
    },
    [deck],
  );

  const audienceWindowRef = useRef<Window | null>(null);
  const audiencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleSyncMessage = useCallback(
    (msg: AudienceMessage) => {
      if (msg.type === 'hello' && msg.role === 'audience') {
        setAudienceConnected(true);
        sendSnapshot(syncRef.current, audiencePresentationRef.current);
        return;
      }
      if (msg.type === 'request-snapshot') {
        setAudienceConnected(true);
        sendSnapshot(syncRef.current, audiencePresentationRef.current);
        return;
      }
      if (msg.type === 'goodbye' && msg.role === 'audience') {
        setAudienceConnected(false);
      }
    },
    [sendSnapshot],
  );

  const sync = usePresentationSync({
    deckFingerprint: deck.fingerprint,
    role: 'presenter',
    onMessage: handleSyncMessage,
  });
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    sync.send({ type: 'presentation', presentation: audiencePresentation });
  }, [sync, audiencePresentation]);

  const openAudienceWindow = useCallback(async () => {
    if (isTauri()) {
      // Desktop build: spawn a Tauri WebviewWindow instead of window.open.
      // The Rust side enforces capability ACL on the new window's label
      // (`audience-*` is whitelisted in capabilities/default.json).
      try {
        const { openAudienceWindow: openAudienceTauri } = await import('../desktop/audienceWindow');
        await openAudienceTauri(deck.fingerprint);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to open Tauri audience window', err);
        return;
      }
      // The new window will fire `request-snapshot` over the sync
      // transport once it mounts; we still schedule a snapshot push in
      // case the listener races the window load.
      window.setTimeout(
        () => sendSnapshot(syncRef.current, audiencePresentationRef.current),
        400,
      );
      return;
    }

    const existing = audienceWindowRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      sendSnapshot(syncRef.current, audiencePresentationRef.current);
      return;
    }
    const url = `/?audience=1&deck=${encodeURIComponent(deck.fingerprint)}`;
    const popup = window.open(
      url,
      `hcslides-lite-audience-${deck.fingerprint}`,
      'popup,width=1280,height=720',
    );
    if (!popup) return;
    audienceWindowRef.current = popup;
    window.setTimeout(
      () => sendSnapshot(syncRef.current, audiencePresentationRef.current),
      250,
    );
  }, [deck.fingerprint, sendSnapshot]);

  useEffect(() => {
    if (audiencePollRef.current) clearInterval(audiencePollRef.current);
    audiencePollRef.current = setInterval(() => {
      const popup = audienceWindowRef.current;
      if (popup && popup.closed) {
        audienceWindowRef.current = null;
        setAudienceConnected(false);
      }
    }, 800);
    return () => {
      if (audiencePollRef.current) {
        clearInterval(audiencePollRef.current);
        audiencePollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      const popup = audienceWindowRef.current;
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          // ignore
        }
      }
      audienceWindowRef.current = null;
    };
  }, []);

  const startSideResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const pointerId = event.pointerId;
      const onMove = (e: PointerEvent) => {
        setSideWidth(Math.round(rect.right - e.clientX));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          (event.currentTarget as HTMLDivElement)?.releasePointerCapture?.(pointerId);
        } catch {
          // ignore
        }
      };
      try {
        (event.currentTarget as HTMLDivElement).setPointerCapture(pointerId);
      } catch {
        // ignore
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [setSideWidth],
  );

  const startNotesResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const pointerId = event.pointerId;
      const onMove = (e: PointerEvent) => {
        setNotesHeight(Math.round(rect.bottom - e.clientY));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          (event.currentTarget as HTMLDivElement)?.releasePointerCapture?.(pointerId);
        } catch {
          // ignore
        }
      };
      try {
        (event.currentTarget as HTMLDivElement).setPointerCapture(pointerId);
      } catch {
        // ignore
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [setNotesHeight],
  );

  useEffect(() => {
    const host = stageHostRef.current;
    const activeTool = presenter.state.tool === 'laser' || presenter.state.tool === 'spotlight' ? presenter.state.tool : null;
    if (!host || !activeTool) {
      setAudiencePointer(null);
      return undefined;
    }

    const onMove = (event: PointerEvent) => {
      const logicalStage = host.querySelector<HTMLElement>('.logical-stage');
      if (!logicalStage) {
        return;
      }
      const rect = logicalStage.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        setAudiencePointer(null);
        return;
      }
      setAudiencePointer({
        tool: activeTool,
        point: {
          x: ((event.clientX - rect.left) / rect.width) * deck.manifest.dimensions.width,
          y: ((event.clientY - rect.top) / rect.height) * deck.manifest.dimensions.height,
        },
      });
    };
    const onLeave = () => setAudiencePointer(null);

    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [deck.manifest.dimensions.height, deck.manifest.dimensions.width, presenter.state.tool]);

  const sectionStyle: CSSProperties = {
    ['--side-w' as string]: `${sideWidth}px`,
    ['--notes-h' as string]: `${notesHeight}px`,
  };

  const stageBlock = (
    <div className="presenter-host" ref={stageHostRef} data-testid="presenter-host">
      <DeckStage
        src={deck.slideUrls[currentIndex]}
        srcdoc={currentSlideHtml}
        title={tFormat('viewer.title.current.live', {
          n: slide.index,
          label: slide.label,
        })}
        width={deck.manifest.dimensions.width}
        height={deck.manifest.dimensions.height}
        preloadSrcs={preloadSrcs}
        sandbox={iframeSandbox}
      >
        <AnnotationOverlay
          tool={presenter.state.tool}
          color={presenter.state.penColor}
          strokes={currentStrokes}
          width={deck.manifest.dimensions.width}
          height={deck.manifest.dimensions.height}
          onCommitStroke={appendStroke}
          onErase={eraseAtPoint}
          onDraftChange={setDraftStroke}
        />
        <Spotlight
          active={presenter.state.tool === 'spotlight'}
          point={audiencePointer?.tool === 'spotlight' ? audiencePointer.point : null}
          radius={presenter.state.spotlightRadius}
          width={deck.manifest.dimensions.width}
          height={deck.manifest.dimensions.height}
        />
        <LaserPointer
          active={presenter.state.tool === 'laser'}
          point={audiencePointer?.tool === 'laser' ? audiencePointer.point : null}
        />
      </DeckStage>
      <Blackout
        color={
          presenter.state.tool === 'blackout'
            ? '#000'
            : presenter.state.tool === 'whiteout'
              ? '#fff'
              : null
        }
      />
      <Toolbar
        presenter={presenter}
        slideIdx={currentIndex}
        mode={viewMode === 'single' ? 'auto-hide' : 'right-dock'}
        hostRef={stageHostRef}
      />
    </div>
  );

  const overviewOverlay = showOverview ? (
    <Overview
      deck={deck}
      currentIndex={currentIndex}
      onSelect={(index) => {
        onNavigate(index);
        onCloseOverview();
      }}
      onClose={onCloseOverview}
    />
  ) : null;

  const notesPanel = (
    <div className="presenter-notes" data-testid="speaker-notes">
      <div className="presenter-notes-head">
        <strong>{t('viewer.notes.title')}</strong>
        <span className="muted small">
          {tFormat('viewer.notes.slideMeta', { n: slide.index, label: slide.label })}
          {hasNotesOverride ? ` ${t('viewer.notes.editedLocally')}` : ''}
        </span>
        <div className="presenter-notes-actions">
          {hasNotesOverride ? (
            <button
              type="button"
              className="btn ghost small"
              data-testid="reset-notes"
              onClick={resetNotesOverride}
            >
              {t('viewer.notes.reset')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost small"
            data-testid="toggle-notes-edit"
            onClick={() => setEditingNotes((value) => !value)}
          >
            {editingNotes ? t('viewer.notes.done') : t('viewer.notes.edit')}
          </button>
        </div>
      </div>
      {editingNotes ? (
        <textarea
          ref={notesEditorRef}
          className="presenter-notes-editor"
          data-testid="speaker-notes-editor"
          value={slideNotes}
          onChange={handleNotesChange}
          spellCheck={false}
          placeholder={t('viewer.notes.placeholder')}
        />
      ) : (
        <pre>{slideNotes || t('viewer.notes.empty')}</pre>
      )}
    </div>
  );

  if (viewMode === 'single') {
    return (
      <section
        ref={rootRef}
        className="viewer deck-viewer lite-deck-viewer"
        aria-label={t('viewer.aria.deckViewer')}
        data-testid="deck-viewer"
        data-view-mode="single"
      >
        <header className="viewer-header deck-viewer-toolbar">
          <button
            type="button"
            className="btn ghost"
            data-testid="close-deck"
            onClick={onCloseDeck}
            aria-label={t('viewer.aria.closeDeck')}
          >
            <ArrowLeft className="btn-icon" aria-hidden size={16} />
            {t('viewer.action.closeDeck')}
          </button>
          <h2 className="deck-title">{deck.manifest.title}</h2>
          <div
            className="deck-counter"
            role="status"
            aria-label={t('viewer.aria.slideCounter')}
          >
            {currentIndex + 1} / {deck.manifest.totalSlides}
          </div>
          <div className="deck-toolbar-spacer" />
          <button
            type="button"
            className="btn ghost icon-only"
            onClick={() => onNavigate(currentIndex - 1)}
            disabled={!canGoPrev}
            aria-label={t('viewer.aria.previous')}
          >
            <ChevronLeft className="btn-icon" aria-hidden size={18} />
          </button>
          <button
            type="button"
            className="btn ghost icon-only"
            onClick={() => onNavigate(currentIndex + 1)}
            disabled={!canGoNext}
            aria-label={t('viewer.aria.next')}
          >
            <ChevronRight className="btn-icon" aria-hidden size={18} />
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onToggleOverview}
            aria-pressed={showOverview}
            data-testid="overview-button"
          >
            <Grid3X3 className="btn-icon" aria-hidden size={16} />
            {t('viewer.action.overview')}
          </button>
          <button
            type="button"
            className="btn ghost"
            aria-pressed={showNotes}
            onClick={onToggleNotes}
            data-testid="speaker-button"
          >
            <StickyNote className="btn-icon" aria-hidden size={16} />
            {t('viewer.action.speaker')}
          </button>
          <button
            type="button"
            className="btn primary"
            data-testid="open-presenter-view"
            onClick={() => setViewMode('presenter')}
            title={t('viewer.action.presenterViewHint')}
          >
            <Presentation className="btn-icon" aria-hidden size={16} />
            {t('viewer.action.presenterView')}
          </button>
        </header>

        <div className={`deck-viewer-body${showNotes ? ' with-speaker' : ''}`} ref={bodyRef}>
          {stageBlock}
          {showNotes ? (
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
                  onClick={onCloseNotes}
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
                      total: deck.manifest.totalSlides,
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
                  <div className="speaker-label muted">
                    {t('viewer.speaker.next')}
                  </div>
                  {nextSlide && nextSlideUrl ? (
                    <div className="speaker-next-preview">
                      <DeckStage
                        src={nextSlideUrl}
                        srcdoc={nextSlideHtml}
                        title={tFormat('viewer.title.next.live', {
                          n: nextSlide.index,
                          label: nextSlide.label,
                        })}
                        width={deck.manifest.dimensions.width}
                        height={deck.manifest.dimensions.height}
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
              {notesPanel}
            </aside>
          ) : null}
        </div>

        {overviewOverlay}
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
      <header className="viewer-header presenter-view-toolbar">
        <button
          type="button"
          className="btn ghost"
          data-testid="open-single-view"
          onClick={() => setViewMode('single')}
          aria-label={t('viewer.aria.backToViewer')}
        >
          <ArrowLeft className="btn-icon" aria-hidden size={16} />
          {t('viewer.action.singleWindow')}
        </button>
        <h2 className="deck-title">{deck.manifest.title}</h2>
        <div
          className="deck-counter"
          role="status"
          aria-label={t('viewer.aria.slideCounter')}
        >
          {currentIndex + 1} / {deck.manifest.totalSlides}
        </div>
        <div className="deck-toolbar-spacer" />
        <button
          type="button"
          className="btn ghost icon-only"
          onClick={() => onNavigate(currentIndex - 1)}
          disabled={!canGoPrev}
          aria-label={t('viewer.aria.previous')}
        >
          <ChevronLeft className="btn-icon" aria-hidden size={18} />
        </button>
        <button
          type="button"
          className="btn ghost icon-only"
          onClick={() => onNavigate(currentIndex + 1)}
          disabled={!canGoNext}
          aria-label={t('viewer.aria.next')}
        >
          <ChevronRight className="btn-icon" aria-hidden size={18} />
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onToggleOverview}
          aria-pressed={showOverview}
          data-testid="overview-button"
        >
          <Grid3X3 className="btn-icon" aria-hidden size={16} />
          {t('viewer.action.overview')}
        </button>
        <button
          type="button"
          className={`btn ${audienceConnected ? 'ghost' : 'primary'}`}
          data-testid="open-audience"
          onClick={openAudienceWindow}
        >
          {audienceConnected ? (
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
      </header>

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

        <aside
          className="presenter-side"
          aria-label={t('viewer.aria.presenterSide')}
          data-testid="presenter-side"
        >
          <section className="presenter-side-card">
            <h3>{t('viewer.side.upNext')}</h3>
            {nextSlide && nextSlideUrl ? (
              <div className="presenter-next">
                <DeckStage
                  src={nextSlideUrl}
                  srcdoc={nextSlideHtml}
                  title={tFormat('viewer.title.next.live', {
                    n: nextSlide.index,
                    label: nextSlide.label,
                  })}
                  width={deck.manifest.dimensions.width}
                  height={deck.manifest.dimensions.height}
                  testId="next-deck-stage"
                  sandbox={iframeSandbox}
                />
                <div className="presenter-next-label">
                  #{nextSlide.index} {nextSlide.label}
                </div>
              </div>
            ) : (
              <div className="muted">{t('viewer.speaker.endOfDeckPlain')}</div>
            )}
          </section>

          <section className="presenter-side-card">
            <h3>{t('viewer.side.timer')}</h3>
            <div className="presenter-timer" data-testid="presenter-timer">
              {formatElapsed(elapsedMs)}
            </div>
            <button type="button" className="btn ghost small" onClick={resetTimer}>
              {t('viewer.side.timer.reset')}
            </button>
          </section>

          <section className="presenter-side-card">
            <h3>{t('viewer.side.audience')}</h3>
            <div className={`presenter-audience-status ${audienceConnected ? 'live' : 'idle'}`}>
              <span className="status-dot" aria-hidden />
              {audienceConnected ? t('viewer.audience.live') : t('viewer.audience.disconnected')}
            </div>
            <p className="muted small">
              {audienceConnected
                ? t('viewer.audience.liveHelp')
                : t('viewer.audience.idleHelp')}
            </p>
          </section>
        </aside>
      </div>

      <div
        className="presenter-notes-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('viewer.aria.resizeNotes')}
        data-testid="presenter-notes-resizer"
        onPointerDown={startNotesResize}
      />

      {notesPanel}

      {overviewOverlay}
    </section>
  );
}
