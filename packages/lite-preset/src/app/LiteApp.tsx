import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ShieldCheck, Sparkles, UploadCloud, Wand2 } from 'lucide-react';
import { loadDeck } from '@slidestage/core/deck/loadDeck';
import {
  BASE_SANDBOX_TOKEN,
  normalizeCapabilities,
  sandboxTokensFor,
} from '@slidestage/core/deck/trustCapabilities';
import {
  DeckLoadError,
  type DeckAssetTransport,
  type LoadedDeck,
  type TrustCapability,
} from '@slidestage/core/deck/types';
import {
  cleanupDecks as cleanupStageDecks,
  getStageServiceWorkerClient,
} from '../browser/stageServiceWorker';
import { isTauri } from '../desktop/env';
import { useI18n } from '../i18n/I18nProvider';
import { loadTrustGrant, saveTrustGrant } from '../persistence/trustStore';
import { AudienceView } from '../viewer/AudienceView';
import { DeckViewer } from '../viewer/DeckViewer';
import { ConverterPanel } from './ConverterPanel';
import { Footer } from './Footer';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TrustPrompt } from './TrustPrompt';

interface PendingTrust {
  deck: LoadedDeck;
  capabilities: TrustCapability[];
}

/**
 * Lite's React app shell. Mounted by `litePreset()` which is the
 * SlideStage plugin handed to `createSlideStage()` from the host
 * bootstrap (`src/main.tsx`).
 *
 * Side-effecty bootstrap (legacy localStorage migration, service
 * worker registration, desktop file-open subscription) used to live
 * here as module-load side effects but moved into `litePreset.mount()`
 * during Phase 4 so the same component is import-safe in tests and
 * Storybook-style isolation.
 */
export function LiteApp() {
  const isAudienceWindow = new URLSearchParams(window.location.search).get('audience') === '1';
  const { t, tFormat } = useI18n();
  const [deck, setDeck] = useState<LoadedDeck | null>(null);
  const [iframeSandbox, setIframeSandbox] = useState<string>(BASE_SANDBOX_TOKEN);
  const [pendingTrust, setPendingTrust] = useState<PendingTrust | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOverview, setShowOverview] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showConverter, setShowConverter] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Sticky banner shown when a deck was auto-elevated to
  // `same-origin-storage` because it exceeded the inline budget.
  // null when not auto-elevated; a {bytes} formatted message otherwise.
  const [autoElevatedNotice, setAutoElevatedNotice] = useState<string | null>(null);
  const deckRef = useRef<LoadedDeck | null>(null);
  const pendingTrustRef = useRef<PendingTrust | null>(null);
  // Lazily-resolved SW client. We cache the resolution so every
  // `openDeckFile` only awaits the registration once.
  const transportPromiseRef = useRef<Promise<DeckAssetTransport | null> | null>(null);

  useEffect(() => {
    deckRef.current = deck;
    return () => {
      deckRef.current?.revoke();
    };
  }, [deck]);

  useEffect(() => {
    pendingTrustRef.current = pendingTrust;
  }, [pendingTrust]);

  useEffect(() => {
    return () => {
      pendingTrustRef.current?.deck.revoke();
      pendingTrustRef.current = null;
    };
  }, []);

  const enterDeck = (
    loaded: LoadedDeck,
    granted: ReadonlyArray<TrustCapability>,
    options: { autoElevatedFor?: 'size' } = {},
  ) => {
    deckRef.current?.revoke();
    setIframeSandbox(sandboxTokensFor(granted));
    setDeck(loaded);
    setCurrentIndex(0);
    setShowOverview(false);
    setShowNotes(false);
    setPendingTrust(null);
    if (options.autoElevatedFor === 'size') {
      const mb = (loaded.totalAssetBytes / (1024 * 1024)).toFixed(0);
      setAutoElevatedNotice(tFormat('viewer.notice.autoElevatedSize', { mb }));
    } else {
      setAutoElevatedNotice(null);
    }
  };

  const getTransport = (): Promise<DeckAssetTransport | null> => {
    if (!transportPromiseRef.current) {
      transportPromiseRef.current = getStageServiceWorkerClient().catch(() => null);
    }
    return transportPromiseRef.current;
  };

  const openDeckFile = async (file: File) => {
    setStatus('loading');
    setError(null);

    try {
      const transport = await getTransport();
      // Tauri WKWebView stalls ~30s per unreachable external CDN
      // stylesheet before paint, so we drop them entirely there. On
      // the Web we keep external <link rel="stylesheet"> tags but
      // defer them to media="print" + onload swap (handled in
      // rewriteHtml) so the deck paints immediately and CDN
      // typography (Google Fonts, etc.) still upgrades the look as
      // soon as the request lands.
      const nextDeck = await loadDeck(file, {
        transport,
        stripExternalLinks: isTauri(),
        // Web: skip data-URL inlining for oversized decks (their
        // base64 cost crashes the renderer). Tauri has no SW, so we
        // must always inline there. See loadDeck.ts → inlineMode for
        // the full reasoning. The default budget (16 MiB raw) gives
        // typical web-font decks plenty of headroom while still
        // tripping on the known-bad CJK-mirror cases.
        inlineMode: isTauri() ? 'always' : 'auto',
      });
      // Drop any previously-cached deck bundles from the worker so a
      // long session does not accumulate stale assets in CacheStorage.
      if (transport) {
        void cleanupStageDecks([nextDeck.deckId]);
      }
      const requiredCaps = normalizeCapabilities(nextDeck.manifest.compat?.requires);

      // Oversized-deck auto-elevation. When the loader skipped the
      // inline pass we MUST mount the iframe with `allow-same-origin`
      // so the transport route is used — there is no usable srcdoc to
      // fall back to. We silently grant `same-origin-storage` to
      // cover that, but layer a visible banner on top so the user
      // understands the security posture changed.
      //
      // If the deck already declares `compat.requires`, that always
      // wins: we go through the normal trust-prompt path so the user
      // sees and approves every requested capability. The auto-grant
      // only kicks in when there is no explicit declaration to
      // honour.
      if (!nextDeck.inlinedHtmlAvailable && requiredCaps.length === 0) {
        const autoGrant: TrustCapability[] = ['same-origin-storage'];
        // Persist so re-opens of the same deck don't re-trigger the
        // banner. The user's explicit cancellation of a future prompt
        // (if compat.requires changes later) still takes precedence
        // because that is handled through the normal trust-prompt
        // pipeline downstream.
        saveTrustGrant(nextDeck.fingerprint, autoGrant);
        enterDeck(nextDeck, autoGrant, { autoElevatedFor: 'size' });
        return;
      }

      if (requiredCaps.length === 0) {
        enterDeck(nextDeck, []);
        return;
      }

      const remembered = loadTrustGrant(nextDeck.fingerprint, requiredCaps);
      if (remembered) {
        enterDeck(nextDeck, remembered.capabilities);
        return;
      }

      pendingTrustRef.current?.deck.revoke();
      setPendingTrust({ deck: nextDeck, capabilities: requiredCaps });
    } catch (loadError) {
      const message =
        loadError instanceof DeckLoadError
          ? loadError.code === 'E_TOO_LARGE_FOR_INLINE'
            ? t('errors.tooLargeForInline')
            : `${loadError.code}: ${loadError.message}`
          : t('errors.loadDeckFallback');
      setError(message);
      setDeck(null);
    } finally {
      setStatus('idle');
    }
  };

  const handleTrustGrant = () => {
    const pending = pendingTrust;
    if (!pending) return;
    saveTrustGrant(pending.deck.fingerprint, pending.capabilities);
    enterDeck(pending.deck, pending.capabilities);
  };

  const handleTrustCancel = () => {
    const pending = pendingTrust;
    setPendingTrust(null);
    setError(t('errors.trustDenied'));
    if (!pending) return;
    try {
      pending.deck.revoke();
    } catch {
      // ignore
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await openDeckFile(file);
    } finally {
      event.target.value = '';
    }
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await openDeckFile(file);
  };

  const handleSampleDeck = async () => {
    setStatus('loading');
    setError(null);

    try {
      const response = await fetch('/fixtures/valid-basic.stage');
      if (!response.ok) {
        throw new Error(t('errors.sampleMissing'));
      }
      const blob = await response.blob();
      await openDeckFile(new File([blob], 'valid-basic.stage', { type: blob.type }));
    } catch (sampleError) {
      setStatus('idle');
      setError(
        sampleError instanceof Error ? sampleError.message : t('errors.sampleFallback'),
      );
    }
  };

  const navigate = (index: number) => {
    if (!deck) {
      return;
    }
    setCurrentIndex(Math.min(Math.max(index, 0), deck.manifest.totalSlides - 1));
  };

  useEffect(() => {
    if (isAudienceWindow) return undefined;
    if (!isTauri()) return undefined;
    let cancelled = false;
    let handle: { unsubscribe(): void } | null = null;
    (async () => {
      const { attachDesktopFileOpen } = await import('../desktop/fileOpen');
      handle = await attachDesktopFileOpen(async (file) => {
        if (cancelled) return;
        await openDeckFile(file);
      });
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('desktop file-open setup failed', err);
    });
    return () => {
      cancelled = true;
      handle?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudienceWindow]);

  useEffect(() => {
    if (!deck) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case 'O':
        case 'o':
          event.preventDefault();
          setShowOverview((value) => !value);
          break;
        case 'S':
        case 's':
          event.preventDefault();
          setShowNotes((value) => !value);
          break;
        case 'Escape':
          if (showOverview || showNotes) {
            event.preventDefault();
            setShowOverview(false);
            setShowNotes(false);
          }
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          setCurrentIndex((index) => Math.min(index + 1, deck.manifest.totalSlides - 1));
          break;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          setCurrentIndex((index) => Math.max(index - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          setCurrentIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setCurrentIndex(deck.manifest.totalSlides - 1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deck, showNotes, showOverview]);

  if (isAudienceWindow) {
    return <AudienceView />;
  }

  if (deck) {
    return (
      <main className="app-shell deck-open">
        {autoElevatedNotice ? (
          <aside
            className="auto-elevated-notice"
            role="status"
            aria-live="polite"
            data-testid="auto-elevated-notice"
          >
            <span className="auto-elevated-notice-icon" aria-hidden>
              <ShieldCheck size={16} />
            </span>
            <span className="auto-elevated-notice-text">{autoElevatedNotice}</span>
            <button
              type="button"
              className="auto-elevated-notice-dismiss"
              onClick={() => setAutoElevatedNotice(null)}
            >
              {t('viewer.notice.dismiss')}
            </button>
          </aside>
        ) : null}
        <DeckViewer
          deck={deck}
          currentIndex={currentIndex}
          showOverview={showOverview}
          showNotes={showNotes}
          iframeSandbox={iframeSandbox}
          onNavigate={navigate}
          onCloseOverview={() => setShowOverview(false)}
          onToggleOverview={() => setShowOverview((value) => !value)}
          onCloseNotes={() => setShowNotes(false)}
          onToggleNotes={() => setShowNotes((value) => !value)}
          onCloseDeck={() => {
            setDeck(null);
            setIframeSandbox(BASE_SANDBOX_TOKEN);
            setAutoElevatedNotice(null);
          }}
        />
        {pendingTrust ? (
          <TrustPrompt
            manifest={pendingTrust.deck.manifest}
            capabilities={pendingTrust.capabilities}
            onGrant={handleTrustGrant}
            onCancel={handleTrustCancel}
          />
        ) : null}
      </main>
    );
  }

  return (
    <div className="app-shell deck-closed">
      <header className="app-header" data-testid="app-header">
        <span className="app-brand" aria-label={t('app.brand.aria')}>
          <span className="app-brand-mark" aria-hidden>
            <img
              src="/brand/slidestage-favicon.svg"
              alt=""
              width={32}
              height={32}
            />
          </span>
          <span>
            <span className="app-brand-name">{t('app.brand.name')}</span>
            <span className="app-brand-tag">{t('app.brand.tag')}</span>
          </span>
        </span>
        <div className="app-header-spacer" />
        <LanguageSwitcher />
        <div className="app-header-meta" aria-live="polite">
          <span className="dot" aria-hidden />
          <span>{t('app.header.meta')}</span>
        </div>
      </header>

      <main className="app-main">
        <div className="landing" data-testid="landing">
          <section
            className="landing-dropzone-section"
            aria-labelledby="open-deck-label"
          >
            <label
              className={`landing-dropzone${isDragOver ? ' is-drag-over' : ''}`}
              data-testid="open-deck-button"
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <span className="landing-dropzone-icon" aria-hidden>
                <UploadCloud size={28} strokeWidth={1.8} />
              </span>
              <span
                id="open-deck-label"
                className="landing-dropzone-headline"
              >
                {isDragOver
                  ? t('landing.dropzone.dragging')
                  : t('landing.dropzone.idle')}
              </span>
              <span className="landing-dropzone-help">
                {t('landing.dropzone.help')}
              </span>
              <input
                type="file"
                accept=".stage,application/zip"
                aria-label={t('landing.cta.open')}
                onChange={handleFileChange}
              />
            </label>

            <div className="landing-secondary-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={handleSampleDeck}
                data-testid="open-sample-button"
              >
                <Sparkles className="btn-icon" aria-hidden size={14} />
                {t('landing.cta.sample')}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowConverter((value) => !value)}
                aria-expanded={showConverter}
                aria-controls="converter-panel"
                data-testid="converter-toggle"
              >
                <Wand2 className="btn-icon" aria-hidden size={14} />
                {showConverter
                  ? t('landing.cta.convert.hide')
                  : t('landing.cta.convert.show')}
              </button>
            </div>

            {status === 'loading' ? (
              <p
                className="alert info landing-status"
                role="status"
                data-testid="status-loading"
              >
                {t('landing.status.loading')}
              </p>
            ) : null}

            {error ? (
              <p
                className="alert error landing-status"
                role="alert"
                data-testid="status-error"
              >
                {error}
              </p>
            ) : null}
          </section>

          {showConverter ? (
            <div id="converter-panel">
              <ConverterPanel
                onConvertedReady={async (file) => {
                  await openDeckFile(file);
                  setShowConverter(false);
                }}
                onClose={() => setShowConverter(false)}
              />
            </div>
          ) : null}
        </div>
      </main>

      <Footer />

      {pendingTrust ? (
        <TrustPrompt
          manifest={pendingTrust.deck.manifest}
          capabilities={pendingTrust.capabilities}
          onGrant={handleTrustGrant}
          onCancel={handleTrustCancel}
        />
      ) : null}
    </div>
  );
}
