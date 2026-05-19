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
import { sandboxAllowsSameOrigin } from '../deck/trustCapabilities';
import type { LoadedDeck } from '../deck/types';
import { isTauri } from '../desktop/env';
import { MonitorPicker } from '../desktop/MonitorPicker';
import { listMonitors, type MonitorInfo } from '../desktop/monitors';
import { useThumbnailCapture } from '../desktop/useThumbnailCapture';
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

const SIDE_WIDTH_KEY = 'slidestage-lite:side-w';
const NOTES_HEIGHT_KEY = 'slidestage-lite:notes-h';
const VIEW_MODE_KEY = 'slidestage-lite:view-mode';
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
  // First-play thumbnail capture: on desktop we lazily render every
  // slide off-screen and cache the resulting WebP under the user's app
  // data dir. The hook is a no-op on the Web build.
  const thumbnails = useThumbnailCapture(deck);
  const effectiveDeck = useMemo<LoadedDeck>(
    () => ({ ...deck, thumbnailUrls: thumbnails.thumbnailUrls }),
    [deck, thumbnails.thumbnailUrls],
  );
  const slide = deck.manifest.slides[currentIndex];
  const nextSlide = deck.manifest.slides[currentIndex + 1];
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < deck.manifest.totalSlides - 1;
  const currentStrokes = presenter.state.strokesByIdx[currentIndex] ?? [];
  // Preload sibling slide URLs only when the active iframe is rendered
  // via `src` (trust-elevated → Service Worker intercepts). For the
  // common srcdoc path the next slide's HTML is already inlined into
  // the DOM, so the browser has nothing extra to warm up — and the
  // preload iframe would otherwise spin up a wasted request that
  // Vite's SPA fallback would happily answer with `index.html`.
  const nextSlideUrl = nextSlide ? deck.slideUrls[currentIndex + 1] : null;
  // Render the active slide via `srcdoc` whenever:
  //   - we're inside Tauri's WKWebView (refuses to navigate iframes to
  //     `blob:tauri://...` URLs under the custom scheme), OR
  //   - the loader could not publish to a Service Worker (file://, old
  //     browser, registration failed). In that case `deck.slideUrls`
  //     point at `blob:` URLs and the iframe must consume the
  //     self-contained HTML directly so it never has to fetch
  //     subresources from a partitioned blob.
  //
  // Whenever a Service Worker hosts the assets, the Web build keeps
  // using `src=virtualURL` so the slide HTML stays out of the React
  // DOM and assets are deduplicated through CacheStorage.
  //
  // Caveat: Chrome only routes a navigation through the SW when the
  // target client has a non-opaque origin. A sandboxed iframe without
  // `allow-same-origin` is opaque, so the SW never sees the fetch and
  // Vite happily serves the SPA fallback. Falling back to srcdoc here
  // keeps the slide rendering in that case (the inlined data: URLs
  // don't need a real origin to resolve).
  //
  // BUT when `deck.inlinedHtmlAvailable === false` the srcdoc copy
  // is a placeholder (the loader skipped the inline pass because the
  // deck exceeds the inline budget). Insisting on srcdoc there would
  // paint a blank "srcdoc disabled" slide — the App layer is
  // responsible for arranging an `allow-same-origin` sandbox via
  // auto-elevation before we get here. We honour that contract by
  // forcing `useSrcdoc = false` for oversized decks; if the sandbox
  // somehow still lacks `allow-same-origin` the iframe will load a
  // 404 from the SW and the viewer's error overlay will surface it,
  // which is a clearer failure than a placeholder body.
  const useSrcdoc =
    deck.inlinedHtmlAvailable &&
    (isTauri() || deck.prefersSrcdoc || !sandboxAllowsSameOrigin(iframeSandbox));
  const currentSlideHtml = useSrcdoc ? deck.slideHtml[currentIndex] : undefined;
  const nextSlideHtml = useSrcdoc && nextSlide ? deck.slideHtml[currentIndex + 1] : undefined;
  const preloadSrcs = useSrcdoc
    ? []
    : [deck.slideUrls[currentIndex - 1], deck.slideUrls[currentIndex + 1]].filter(
        (url): url is string => Boolean(url),
      );
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
        snapshot: {
          deck: serializeAudienceDeck(deck),
          presentation,
          // Ship the resolved sandbox token string so the audience
          // window mirrors the presenter exactly. Without this the
          // audience falls back to deriving caps from
          // `manifest.compat.requires` + the trust-store record, which
          // misses any caps the App layer auto-granted (e.g. the
          // `same-origin-storage` we add to oversized decks to push
          // them through the SW transport instead of the inline
          // srcdoc path). When that happens the audience iframe is
          // opaque-origin, the SW can't intercept its requests, and
          // the popup ends up empty.
          iframeSandbox,
        },
      });
    },
    [deck, iframeSandbox],
  );

  const audienceWindowRef = useRef<Window | null>(null);
  const audiencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [monitorPickerOpen, setMonitorPickerOpen] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<MonitorInfo[]>([]);

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

  // Desktop helper: actually spawn the Tauri WebviewWindow once the user
  // has either picked a display (multi-monitor systems) or single-display
  // bypass kicked in. The Rust side enforces capability ACL on the new
  // window's label (`audience-*` is whitelisted in
  // capabilities/default.json).
  const launchAudienceTauri = useCallback(
    async (monitor: MonitorInfo | null, fullscreen: boolean) => {
      try {
        const { openAudienceWindow: openAudienceTauri } = await import(
          '../desktop/audienceWindow'
        );
        await openAudienceTauri(deck.fingerprint, { monitor, fullscreen });
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
    },
    [deck.fingerprint, sendSnapshot],
  );

  const openAudienceWindow = useCallback(async () => {
    if (isTauri()) {
      let monitors: MonitorInfo[] = [];
      try {
        monitors = await listMonitors();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('listMonitors failed, falling back to OS-default placement', err);
      }
      setAvailableMonitors(monitors);
      // Single-display systems skip the picker; fullscreen straight away.
      if (monitors.length <= 1) {
        await launchAudienceTauri(monitors[0] ?? null, true);
        return;
      }
      setMonitorPickerOpen(true);
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
      `slidestage-lite-audience-${deck.fingerprint}`,
      'popup,width=1280,height=720',
    );
    if (!popup) return;
    audienceWindowRef.current = popup;
    window.setTimeout(
      () => sendSnapshot(syncRef.current, audiencePresentationRef.current),
      250,
    );
  }, [deck.fingerprint, launchAudienceTauri, sendSnapshot]);

  const handleMonitorPicked = useCallback(
    (monitor: MonitorInfo, fullscreen: boolean) => {
      setMonitorPickerOpen(false);
      void launchAudienceTauri(monitor, fullscreen);
    },
    [launchAudienceTauri],
  );

  const handleMonitorCancel = useCallback(() => {
    setMonitorPickerOpen(false);
  }, []);

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

  // Keep refs in sync for the global-shortcut handler so it always reads
  // the latest navigation / presenter state without re-registering on
  // every keystroke or slide change.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const totalSlidesRef = useRef(deck.manifest.totalSlides);
  totalSlidesRef.current = deck.manifest.totalSlides;
  const presenterRef = useRef(presenter);
  presenterRef.current = presenter;

  // While the audience window is live in the Tauri build, register a
  // global-shortcut belt-and-braces layer so presentation keys keep
  // working even if a slide iframe steals focus on the audience side.
  // We deliberately scope this to (a) Tauri only, (b) only while the
  // audience is connected, so we never claim system shortcuts during a
  // plain Web session or while the user is just browsing decks.
  useEffect(() => {
    if (!isTauri() || !audienceConnected) return undefined;
    let cancelled = false;
    let handle: { unregister(): Promise<void> } | null = null;
    (async () => {
      try {
        const { registerPresentationShortcuts } = await import(
          '../desktop/globalShortcuts'
        );
        const registered = await registerPresentationShortcuts((action) => {
          const total = totalSlidesRef.current;
          const idx = currentIndexRef.current;
          switch (action) {
            case 'next-slide':
              onNavigateRef.current(Math.min(idx + 1, total - 1));
              break;
            case 'prev-slide':
              onNavigateRef.current(Math.max(idx - 1, 0));
              break;
            case 'first-slide':
              onNavigateRef.current(0);
              break;
            case 'last-slide':
              onNavigateRef.current(total - 1);
              break;
            case 'toggle-blackout': {
              const api = presenterRef.current;
              api.setTool(api.state.tool === 'blackout' ? 'mouse' : 'blackout');
              break;
            }
            case 'exit-fullscreen':
              // Best-effort: tell the audience window to leave fullscreen.
              void (async () => {
                try {
                  const { setAudienceFullscreen } = await import('../desktop/audienceWindow');
                  await setAudienceFullscreen(deck.fingerprint, false);
                } catch {
                  // ignore
                }
              })();
              break;
            default:
              break;
          }
        });
        if (cancelled) {
          await registered.unregister();
        } else {
          handle = registered;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('global shortcuts setup failed', err);
      }
    })();
    return () => {
      cancelled = true;
      void handle?.unregister();
    };
  }, [audienceConnected, deck.fingerprint]);

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
      deck={effectiveDeck}
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

      {monitorPickerOpen && availableMonitors.length > 0 ? (
        <MonitorPicker
          monitors={availableMonitors}
          onPick={handleMonitorPicked}
          onCancel={handleMonitorCancel}
        />
      ) : null}
    </section>
  );
}
