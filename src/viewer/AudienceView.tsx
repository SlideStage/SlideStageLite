import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BASE_SANDBOX_TOKEN,
  normalizeCapabilities,
  sandboxTokensFor,
} from '../deck/trustCapabilities';
import type { LoadedDeck } from '../deck/types';
import { isTauri } from '../desktop/env';
import { useI18n } from '../i18n/I18nProvider';
import { loadTrustGrant } from '../persistence/trustStore';
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
import { DeckStage } from './DeckStage';

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
  const deckFingerprint = useMemo(() => readDeckFingerprintFromUrl(), []);

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
  // The audience window shares localStorage with its opener (same origin),
  // so we can read the trust decision the user already granted in the
  // presenter window. If the deck does not need trust the lookup returns
  // null and we fall through to the minimal `allow-scripts` sandbox.
  const requiredCaps = normalizeCapabilities(deck.manifest.compat?.requires);
  const grant = requiredCaps.length > 0 ? loadTrustGrant(deck.fingerprint, requiredCaps) : null;
  const iframeSandbox = grant ? sandboxTokensFor(grant.capabilities) : BASE_SANDBOX_TOKEN;

  return (
    <main
      className="audience-view"
      aria-label={t('audience.aria')}
      data-testid="audience-view"
      data-tool={presentation.tool}
    >
      <DeckStage
        src={deck.slideUrls[presentation.currentIndex]}
        srcdoc={isTauri() ? deck.slideHtml[presentation.currentIndex] : undefined}
        title={tFormat('viewer.title.audience.live', {
          n: slide.index,
          label: slide.label,
        })}
        width={deck.manifest.dimensions.width}
        height={deck.manifest.dimensions.height}
        preloadSrcs={[
          deck.slideUrls[presentation.currentIndex - 1],
          deck.slideUrls[presentation.currentIndex + 1],
        ].filter((url): url is string => Boolean(url))}
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
