import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import {
  BASE_SANDBOX_TOKEN,
  normalizeCapabilities,
  sandboxTokensFor,
} from '@slidestage/core/deck/trustCapabilities';
import type { LoadedDeck, TrustCapability } from '@slidestage/core/deck/types';
import { useUiTranslator } from '../i18n/translator';
import { AnnotationOverlay } from '../presenter/AnnotationOverlay';
import { Blackout } from '../presenter/Blackout';
import { LaserPointer } from '../presenter/LaserPointer';
import { Spotlight } from '../presenter/Spotlight';
import {
  deserializeAudienceDeck,
  usePresentationSync,
  type AudienceMessage,
  type AudiencePresentationState,
} from '../presenter/usePresentationSync';
import { useSlideBridge } from '../presenter/useSlideBridge';
import { DeckStage } from './DeckStage';
import { chooseUseSrcdoc } from './viewMath';

const INITIAL_PRESENTATION: AudiencePresentationState = {
  currentIndex: 0,
  tool: 'mouse',
  strokesByIdx: {},
  spotlightRadius: 180,
  pointer: null,
};

/**
 * Adapter the wrapper passes in to recover the trust grant for a given
 * deck fingerprint. The audience window can't ask the user (it has no
 * UI for that); it can only consult whatever the presenter window
 * already persisted.
 */
export interface AudienceTrustAdapter {
  loadGrant: (
    fingerprint: string,
    capabilities: ReadonlyArray<TrustCapability>,
  ) => { capabilities: ReadonlyArray<TrustCapability> } | null;
}

/**
 * Adapter the wrapper passes in to drive the host window from inside
 * the audience iframe (Tauri only). When omitted, the audience window
 * renders without the fullscreen toggle / close button.
 */
export interface AudienceWindowAdapter {
  isFullscreen(): Promise<boolean>;
  setFullscreen(next: boolean): Promise<void>;
  close(): Promise<void>;
  /**
   * Subscribe to resize events. Returns an unsubscribe function.
   * Optional — when omitted, the fullscreen state is read once at
   * mount and never refreshed.
   */
  onResize?(cb: () => void): () => void;
}

export interface AudienceViewProps {
  /**
   * Deck fingerprint embedded in the audience URL. The wrapper parses
   * this from `?deck=…` and forwards it here; the UI uses it to scope
   * the sync channel and look up the trust grant.
   */
  deckFingerprint: string | null;
  trustAdapter?: AudienceTrustAdapter;
  audienceWindowAdapter?: AudienceWindowAdapter;
}

/**
 * Reusable audience view. Subscribes to the presentation sync channel
 * keyed on `deckFingerprint`, mirrors the presenter's slide, strokes,
 * spotlight, laser, blackout/whiteout state, and renders the same
 * stage block as the presenter (minus the toolbar).
 *
 * Trust + window controls are injected as optional adapters so the UI
 * stays free of Lite-specific storage / Tauri imports.
 */
export function AudienceView({
  deckFingerprint,
  trustAdapter,
  audienceWindowAdapter,
}: AudienceViewProps) {
  const { t, tFormat } = useUiTranslator();
  const [deck, setDeck] = useState<LoadedDeck | null>(null);
  const [presenterAlive, setPresenterAlive] = useState(false);
  const [presentation, setPresentation] = useState<AudiencePresentationState>(
    INITIAL_PRESENTATION,
  );
  const [isFullscreen, setIsFullscreen] = useState(true);
  const audienceRootRef = useRef<HTMLElement | null>(null);

  // Mirror the OS-level fullscreen state into React so the toggle
  // button shows the correct icon even when the user enters/exits
  // fullscreen via the green traffic-light or Cmd+Ctrl+F outside of
  // our control.
  useEffect(() => {
    if (!audienceWindowAdapter) return undefined;
    let cancelled = false;
    let unlistenResize: (() => void) | null = null;
    (async () => {
      try {
        const initial = await audienceWindowAdapter.isFullscreen().catch(() => true);
        if (!cancelled) setIsFullscreen(initial);
        if (!audienceWindowAdapter.onResize) return;
        const handle = audienceWindowAdapter.onResize(async () => {
          try {
            const next = await audienceWindowAdapter.isFullscreen();
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
  }, [audienceWindowAdapter]);

  const toggleFullscreen = useCallback(async () => {
    if (!audienceWindowAdapter) return;
    try {
      const next = !isFullscreen;
      await audienceWindowAdapter.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('audience: setFullscreen failed', err);
    }
  }, [audienceWindowAdapter, isFullscreen]);

  const closeWindow = useCallback(async () => {
    if (!audienceWindowAdapter) {
      if (typeof window !== 'undefined') {
        window.close();
      }
      return;
    }
    try {
      await audienceWindowAdapter.close();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('audience: close failed', err);
    }
  }, [audienceWindowAdapter]);

  // Bridge to the audience slide iframe: drives it to the presenter's
  // in-slide step (Strategy A) and replays forwarded interactions for
  // step-less slides (Strategy A+).
  const bridge = useSlideBridge({
    role: 'audience',
    hostRef: audienceRootRef,
    currentIndex: presentation.currentIndex,
    reacquireKey: deck?.fingerprint ?? null,
    targetRuntime: presentation.runtime ?? null,
  });
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

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
        setPresenterAlive(true);
        break;
      case 'presentation':
        setPresentation(msg.presentation);
        setPresenterAlive(true);
        break;
      case 'input-event':
        bridgeRef.current.replayInputEvent(msg.event);
        setPresenterAlive(true);
        break;
      default:
        break;
    }
  }, []);

  // Per-deck channel keyed on the fingerprint embedded in the popup
  // URL, so opening two decks side-by-side does not cross-broadcast
  // state.
  const sync = usePresentationSync({
    deckFingerprint,
    role: 'audience',
    onMessage: handleMessage,
  });

  // Re-request a snapshot every time the audience window is reloaded
  // so it catches up even when the presenter's initial hello already
  // fired.
  const snapshotRequestedRef = useRef(false);
  useEffect(() => {
    if (!sync.available || snapshotRequestedRef.current) return;
    snapshotRequestedRef.current = true;
    sync.send({ type: 'request-snapshot' });
  }, [sync]);

  // If the tab becomes visible again (alt-tab back to the projector),
  // ask for a snapshot to be safe — broadcast deltas while hidden
  // might have dropped on some browsers.
  useEffect(() => {
    if (!sync.available) return undefined;
    if (typeof document === 'undefined') return undefined;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        sync.send({ type: 'request-snapshot' });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [sync]);

  const iframeSandbox = useMemo<string>(() => {
    // DSS-CAND-012: derive the sandbox ENTIRELY from local trust state.
    // The sync channel is same-origin and unauthenticated, so a forged
    // snapshot must never be able to widen this iframe's privileges. We
    // replicate LiteApp's presenter-side decision using only the deck
    // metadata (which travels in the snapshot) and the on-device trust
    // store (shared localStorage), never a presenter-supplied token.
    if (!deck || !trustAdapter) return BASE_SANDBOX_TOKEN;
    const requiredCaps = normalizeCapabilities(deck.manifest.compat?.requires);
    if (requiredCaps.length > 0) {
      const grant = trustAdapter.loadGrant(deck.fingerprint, requiredCaps);
      return grant ? sandboxTokensFor(grant.capabilities) : BASE_SANDBOX_TOKEN;
    }
    // Oversized decks have no usable srcdoc, so the presenter only
    // renders them after the user consents to `same-origin-storage`
    // (LiteApp.openDeckFile size-elevation path). Mirror that grant here
    // so the audience iframe can also reach the Service Worker route.
    if (!deck.inlinedHtmlAvailable) {
      const sizeCaps: TrustCapability[] = ['same-origin-storage'];
      const grant = trustAdapter.loadGrant(deck.fingerprint, sizeCaps);
      return grant ? sandboxTokensFor(grant.capabilities) : BASE_SANDBOX_TOKEN;
    }
    return BASE_SANDBOX_TOKEN;
  }, [deck, trustAdapter]);

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
  const tauriMode = Boolean(audienceWindowAdapter);
  // Same decision as in DeckViewer: srcdoc when the iframe is opaque
  // (Tauri WKWebView, no transport, or no `allow-same-origin`), src+
  // virtual URL otherwise. Preloads are only meaningful when the SW
  // can actually intercept the next-slide fetch.
  // See DeckViewer for the matching guard; oversized decks have an
  // unrenderable srcdoc body so we must mount via `src` only.
  const audienceUseSrcdoc = chooseUseSrcdoc({
    deck,
    isTauriHost: tauriMode,
    iframeSandbox,
  });

  return (
    <main
      ref={audienceRootRef}
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
            presentation.pointer?.tool === 'spotlight' ? presentation.pointer.point : null
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
            title={
              isFullscreen ? t('audience.exitFullscreen') : t('audience.enterFullscreen')
            }
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
