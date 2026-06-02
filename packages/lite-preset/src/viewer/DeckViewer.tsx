import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import { usePersistedNumber } from '@slidestage/ui/presenter/usePersistedNumber';
import { usePresenter, usePresenterShortcuts } from '@slidestage/ui/presenter/usePresenter';
import {
  serializeAudienceDeck,
  usePresentationSync,
  type AudienceMessage,
  type AudiencePresentationState,
} from '@slidestage/ui/presenter/usePresentationSync';
import {
  DeckViewer as UiDeckViewer,
  type DeckViewerLayoutMode,
} from '@slidestage/ui/viewer/DeckViewer';
import { isTauri } from '../desktop/env';
import { MonitorPicker } from '../desktop/MonitorPicker';
import { listMonitors, type MonitorInfo } from '../desktop/monitors';
import { useThumbnailCapture } from '../desktop/useThumbnailCapture';
import { loadAnnotations, saveAnnotations } from '../persistence/annotationStore';
import { loadNotes, saveNotes, type StoredNotes } from '../persistence/notesStore';

const SIDE_WIDTH_KEY = 'slidestage-lite:side-w';
const NOTES_HEIGHT_KEY = 'slidestage-lite:notes-h';
const VIEW_MODE_KEY = 'slidestage-lite:view-mode';
const SIDE_WIDTH_MIN = 240;
const SIDE_WIDTH_MAX = 640;
const NOTES_HEIGHT_MIN = 96;
const NOTES_HEIGHT_MAX = 480;

function loadInitialViewMode(): DeckViewerLayoutMode {
  if (typeof window === 'undefined') return 'presenter';
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    return stored === 'single' ? 'single' : 'presenter';
  } catch {
    return 'presenter';
  }
}

function persistViewMode(mode: DeckViewerLayoutMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // ignore quota / disabled storage
  }
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

/**
 * Lite-specific DeckViewer wrapper.
 *
 * Owns the lite-flavored adapters that aren't part of the
 * `@slidestage/ui` contract: localStorage-backed layout state,
 * annotation/notes persistence, thumbnail capture (Tauri only), the
 * presentation sync transport (BroadcastChannel / Tauri event), and
 * the audience window spawn logic (Web popup + Tauri WebviewWindow +
 * MonitorPicker UI).
 *
 * Keyboard shortcuts are intentionally window-scoped only — see
 * `LiteApp.tsx` (`window.addEventListener('keydown')`) and the
 * `DeckStage` focus-reclaim helper. We do NOT register OS-level global
 * shortcuts; that would steal keys from other apps when SlideStage Lite
 * isn't focused, and it adds a Mac App Store entitlement we'd rather
 * not request.
 */
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
  const presenter = usePresenter();
  usePresenterShortcuts(presenter, currentIndex);

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
  const [viewMode, setViewModeState] = useState<DeckViewerLayoutMode>(loadInitialViewMode);
  const handleModeChange = useCallback((next: DeckViewerLayoutMode) => {
    setViewModeState(next);
    persistViewMode(next);
  }, []);

  const [annotationsHydrated, setAnnotationsHydrated] = useState(false);
  const [notesOverrides, setNotesOverrides] = useState<StoredNotes>({});
  const [notesHydrated, setNotesHydrated] = useState(false);
  const [audienceConnected, setAudienceConnected] = useState(false);
  const [audiencePresentation, setAudiencePresentation] =
    useState<AudiencePresentationState | null>(null);
  const [monitorPickerOpen, setMonitorPickerOpen] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<MonitorInfo[]>([]);

  // First-play thumbnail capture: on desktop we lazily render every
  // slide off-screen and cache the resulting WebP under the user's app
  // data dir. The hook is a no-op on the Web build.
  const thumbnails = useThumbnailCapture(deck);

  // Hydrate annotations from localStorage on deck change.
  useEffect(() => {
    setAnnotationsHydrated(false);
    presenter.loadStrokes(loadAnnotations(deck.fingerprint));
    setAnnotationsHydrated(true);
  }, [deck.fingerprint, presenter.loadStrokes]);

  useEffect(() => {
    if (!annotationsHydrated) return;
    saveAnnotations(deck.fingerprint, presenter.state.strokesByIdx);
  }, [annotationsHydrated, deck.fingerprint, presenter.state.strokesByIdx]);

  useEffect(() => {
    setNotesHydrated(false);
    setNotesOverrides(loadNotes(deck.fingerprint));
    setNotesHydrated(true);
  }, [deck.fingerprint]);

  useEffect(() => {
    if (!notesHydrated) return;
    saveNotes(deck.fingerprint, notesOverrides);
  }, [notesHydrated, deck.fingerprint, notesOverrides]);

  const handleOverridesChange = useCallback(
    (
      next:
        | Record<number, string>
        | ((prev: Readonly<Record<number, string>>) => Record<number, string>),
    ) => {
      setNotesOverrides((prev) =>
        typeof next === 'function'
          ? (next as (p: Readonly<Record<number, string>>) => StoredNotes)(prev)
          : next,
      );
    },
    [],
  );

  // ---------- Audience sync transport ----------

  const audiencePresentationRef = useRef<AudiencePresentationState | null>(null);
  audiencePresentationRef.current = audiencePresentation;

  const sendSnapshot = useCallback(
    (
      syncApi: { send: (msg: AudienceMessage) => void },
      presentation: AudiencePresentationState | null,
    ) => {
      if (!presentation) return;
      // DSS-CAND-012: the snapshot intentionally carries NO sandbox token.
      // The audience window derives its own iframe sandbox from the local
      // trust store (shared localStorage) so a forged snapshot on the
      // same-origin sync channel can't elevate the audience iframe.
      syncApi.send({
        type: 'snapshot',
        snapshot: {
          deck: serializeAudienceDeck(deck),
          presentation,
        },
      });
    },
    [deck],
  );

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

  // Mirror live presentation changes from the UI onto the transport.
  useEffect(() => {
    if (!audiencePresentation) return;
    sync.send({ type: 'presentation', presentation: audiencePresentation });
  }, [sync, audiencePresentation]);

  // ---------- Audience window spawn ----------

  const audienceWindowRef = useRef<Window | null>(null);
  const audiencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const monitorPickerOverlay = useMemo(() => {
    if (!monitorPickerOpen || availableMonitors.length === 0) return null;
    return (
      <MonitorPicker
        monitors={availableMonitors}
        onPick={handleMonitorPicked}
        onCancel={handleMonitorCancel}
      />
    );
  }, [availableMonitors, handleMonitorCancel, handleMonitorPicked, monitorPickerOpen]);

  return (
    <UiDeckViewer
      deck={deck}
      currentIndex={currentIndex}
      showOverview={showOverview}
      showNotes={showNotes}
      iframeSandbox={iframeSandbox}
      onNavigate={onNavigate}
      onCloseOverview={onCloseOverview}
      onToggleOverview={onToggleOverview}
      onCloseNotes={onCloseNotes}
      onToggleNotes={onToggleNotes}
      onCloseDeck={onCloseDeck}
      layout={{
        mode: viewMode,
        onModeChange: handleModeChange,
        sideWidth,
        onSideWidthChange: setSideWidth,
        notesHeight,
        onNotesHeightChange: setNotesHeight,
      }}
      presenter={presenter}
      notes={{
        overrides: notesOverrides,
        onOverridesChange: handleOverridesChange,
      }}
      thumbnailUrls={thumbnails.thumbnailUrls}
      isTauriHost={isTauri()}
      audience={{
        connected: audienceConnected,
        onPresentationChange: setAudiencePresentation,
        onOpenWindow: openAudienceWindow,
      }}
      slots={{ overlay: monitorPickerOverlay }}
    />
  );
}
