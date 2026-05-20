import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import {
  BASE_SANDBOX_TOKEN,
  normalizeCapabilities,
  sandboxAllowsSameOrigin,
  sandboxTokensFor,
} from '@slidestage/core/deck/trustCapabilities';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import { isTauri } from '../desktop/env';
import { useI18n } from '../i18n/I18nProvider';
import { loadTrustGrant } from '../persistence/trustStore';
import { AnnotationOverlay } from '@slidestage/ui/presenter/AnnotationOverlay';
import { Blackout } from '@slidestage/ui/presenter/Blackout';
import { LaserPointer } from '@slidestage/ui/presenter/LaserPointer';
import { Spotlight } from '@slidestage/ui/presenter/Spotlight';
import {
  deserializeAudienceDeck,
  usePresentationSync,
  type AudienceMessage,
  type AudiencePresentationState,
} from '@slidestage/ui/presenter/usePresentationSync';
import { DeckStage } from '@slidestage/ui/viewer/DeckStage';

const INITIAL_PRESENTATION: AudiencePresentationState = {
  currentIndex: 0,
  tool: 'mouse',
  strokesByIdx: {},
  spotlightRadius: 180,
  pointer: null,
};

function readDeckFingerprintFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('deck');
  return value && value.length > 0 ? value : null;
}

export function AudienceView() {
  const { t, tFormat } = useI18n();
  const [deck, setDeck] = useState<LoadedDeck | null>(null);
  const [presenterAlive, setPresenterAlive] = useState(false);
  const [presentation, setPresentation] = useState<AudiencePresentationState>(INITIAL_PRESENTATION);
  // Sandbox token the presenter is using. Tracked as separate state
  // because it can change between snapshots (e.g. user grants
  // additional trust while the audience window is open) and must
  // override the local trust-store derivation for auto-elevated
  // decks where the App layer granted caps that aren't declared in
  // `compat.requires`.
  const [presenterSandbox, setPresenterSandbox] = useState<string | null>(null);
  const deckFingerprint = useMemo(() => readDeckFingerprintFromUrl(), []);
  const [isFullscreen, setIsFullscreen] = useState(true);

  const tauriMode = isTauri();

  // Mirror the OS-level fullscreen state into React so the toggle button
  // shows the correct icon even when the user enters/exits fullscreen via
  // the green traffic-light or Cmd+Ctrl+F outside of our control.
  useEffect(() => {
    if (!tauriMode) return undefined;
    let cancelled = false;
    let unlistenResize: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const initial = await win.isFullscreen().catch(() => true);
        if (!cancelled) setIsFullscreen(initial);
        const handle = await win.onResized(async () => {
          try {
            const next = await win.isFullscreen();
            if (!cancelled) setIsFullscreen(next);
          } catch {
            // ignore
          }
        });
        if (cancelled) {
          handle();
        } else {
          unlistenResize = handle;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('audience: failed to bind fullscreen listener', err);
      }
    })();
    return () => {
      cancelled = true;
      try {
        unlistenResize?.();
      } catch {
        // ignore
      }
    };
  }, [tauriMode]);

  const toggleFullscreen = useCallback(async () => {
    if (!tauriMode) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const next = !isFullscreen;
      await win.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('audience: setFullscreen failed', err);
    }
  }, [isFullscreen, tauriMode]);

  const closeWindow = useCallback(async () => {
    if (!tauriMode) {
      window.close();
      return;
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('audience: close failed', err);
    }
  }, [tauriMode]);

  const handleMessage = useCallback((msg: AudienceMessage) => {
    switch (msg.type) {
      case 'hello':
        if (msg.role === 'presenter') setPresenterAlive(true);
        break;
      case 'goodbye':
        if (msg.role === 'presenter') setPresenterAlive(false);
        break;
      case 'snapshot':
        setDeck(deserializeAudienceDeck(msg.snapshot));
        setPresentation(msg.snapshot.presentation);
        if (typeof msg.snapshot.iframeSandbox === 'string') {
          setPresenterSandbox(msg.snapshot.iframeSandbox);
        }
        setPresenterAlive(true);
        break;
      case 'presentation':
        setPresentation(msg.presentation);
        setPresenterAlive(true);
        break;
      default:
        break;
    }
  }, []);

  // Per-deck channel keyed on the fingerprint embedded in the popup URL,
  // so opening two decks side-by-side does not cross-broadcast state.
  const sync = usePresentationSync({
    deckFingerprint,
    role: 'audience',
    onMessage: handleMessage,
  });

  // Re-request a snapshot every time the audience window is reloaded so it
  // catches up even when the presenter's initial hello already fired.
  const snapshotRequestedRef = useRef(false);
  useEffect(() => {
    if (!sync.available || snapshotRequestedRef.current) return;
    snapshotRequestedRef.current = true;
    sync.send({ type: 'request-snapshot' });
  }, [sync]);

  // If the tab becomes visible again (alt-tab back to the projector), ask
  // for a snapshot to be safe — broadcast deltas while hidden might have
  // dropped on some browsers.
  useEffect(() => {
    if (!sync.available) return undefined;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        sync.send({ type: 'request-snapshot' });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [sync]);

  if (!deck) {
    return (
      <main className="audience-waiting">
        <h1>{t('audience.waiting.title')}</h1>
        <p>{t('audience.waiting.body')}</p>
      </main>
    );
  }

  const slide = deck.manifest.slides[presentation.currentIndex];
  const currentStrokes = presentation.strokesByIdx[presentation.currentIndex] ?? [];
  const blackoutColor =
    presentation.tool === 'blackout' ? '#000' : presentation.tool === 'whiteout' ? '#fff' : null;
  // Prefer the sandbox the presenter is actually using (shipped over
  // the snapshot envelope). Falling back to the local trust-store
  // lookup means an older presenter build (or a slow snapshot) still
  // renders something — but it loses the auto-elevation grant for
  // decks without a declared `compat.requires`. New builds always
  // win the race because the snapshot lands as soon as the audience
  // calls `request-snapshot` on hello.
  let iframeSandbox: string;
  if (presenterSandbox) {
    iframeSandbox = presenterSandbox;
  } else {
    // The audience window shares localStorage with its opener (same
    // origin), so we can read the trust decision the user granted in
    // the presenter window. If the deck does not need trust the
    // lookup returns null and we fall through to the minimal
    // `allow-scripts` sandbox.
    const requiredCaps = normalizeCapabilities(deck.manifest.compat?.requires);
    const grant =
      requiredCaps.length > 0 ? loadTrustGrant(deck.fingerprint, requiredCaps) : null;
    iframeSandbox = grant ? sandboxTokensFor(grant.capabilities) : BASE_SANDBOX_TOKEN;
  }
  // Same decision as in DeckViewer: srcdoc when the iframe is opaque
  // (Tauri WKWebView, no transport, or no `allow-same-origin`), src+
  // virtual URL otherwise. Preloads are only meaningful when the SW
  // can actually intercept the next-slide fetch.
  // See DeckViewer for the matching guard; oversized decks have an
  // unrenderable srcdoc body so we must mount via `src` only.
  const audienceUseSrcdoc =
    deck.inlinedHtmlAvailable &&
    (tauriMode || deck.prefersSrcdoc || !sandboxAllowsSameOrigin(iframeSandbox));

  return (
    <main
      className="audience-view"
      aria-label={t('audience.aria')}
      data-testid="audience-view"
      data-tool={presentation.tool}
    >
      <DeckStage
        src={deck.slideUrls[presentation.currentIndex]}
        srcdoc={audienceUseSrcdoc ? deck.slideHtml[presentation.currentIndex] : undefined}
        title={tFormat('viewer.title.audience.live', {
          n: slide.index,
          label: slide.label,
        })}
        width={deck.manifest.dimensions.width}
        height={deck.manifest.dimensions.height}
        preloadSrcs={
          audienceUseSrcdoc
            ? []
            : [
                deck.slideUrls[presentation.currentIndex - 1],
                deck.slideUrls[presentation.currentIndex + 1],
              ].filter((url): url is string => Boolean(url))
        }
        sandbox={iframeSandbox}
      >
        <AnnotationOverlay
          tool="mouse"
          color="#FF3B30"
          strokes={currentStrokes}
          width={deck.manifest.dimensions.width}
          height={deck.manifest.dimensions.height}
          onCommitStroke={() => {}}
          onErase={() => {}}
        />
        <Spotlight
          active={presentation.tool === 'spotlight'}
          point={
            presentation.pointer?.tool === 'spotlight'
              ? presentation.pointer.point
              : null
          }
          radius={presentation.spotlightRadius}
          width={deck.manifest.dimensions.width}
          height={deck.manifest.dimensions.height}
        />
        <LaserPointer
          active={presentation.tool === 'laser'}
          point={
            presentation.pointer?.tool === 'laser' ? presentation.pointer.point : null
          }
        />
        <Blackout color={blackoutColor} />
      </DeckStage>
      {tauriMode ? (
        <div
          className="audience-controls"
          role="toolbar"
          aria-label={t('audience.aria')}
          data-testid="audience-controls"
        >
          <button
            type="button"
            className="btn ghost small"
            onClick={() => void toggleFullscreen()}
            aria-pressed={isFullscreen}
            data-testid="audience-toggle-fullscreen"
            title={isFullscreen ? t('audience.exitFullscreen') : t('audience.enterFullscreen')}
          >
            {isFullscreen ? (
              <Minimize2 className="btn-icon" aria-hidden size={14} />
            ) : (
              <Maximize2 className="btn-icon" aria-hidden size={14} />
            )}
            {isFullscreen ? t('audience.exitFullscreen') : t('audience.enterFullscreen')}
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => void closeWindow()}
            data-testid="audience-close"
            title={t('audience.closeWindow')}
          >
            <X className="btn-icon" aria-hidden size={14} />
          </button>
        </div>
      ) : null}
      <div
        className={`audience-status ${presenterAlive ? 'live' : 'idle'}`}
        data-testid="audience-presenter-status"
      >
        <span className="status-dot" aria-hidden />
        {presenterAlive ? t('audience.linked') : t('audience.waitingShort')}
      </div>
    </main>
  );
}
