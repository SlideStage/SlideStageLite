import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowRight,
  FolderOpen,
  KeyRound,
  PanelsTopLeft,
  Presentation,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { loadDeck } from '../deck/loadDeck';
import {
  BASE_SANDBOX_TOKEN,
  normalizeCapabilities,
  sandboxTokensFor,
} from '../deck/trustCapabilities';
import { DeckLoadError, type LoadedDeck, type TrustCapability } from '../deck/types';
import { isTauri } from '../desktop/env';
import { useI18n } from '../i18n/I18nProvider';
import { loadTrustGrant, saveTrustGrant } from '../persistence/trustStore';
import { AudienceView } from '../viewer/AudienceView';
import { DeckViewer } from '../viewer/DeckViewer';
import { ConverterPanel } from './ConverterPanel';
import { Footer } from './Footer';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TrustPrompt } from './TrustPrompt';

interface Benefit {
  icon: typeof Sparkles;
  /** i18n message key suffix below `landing.benefit.<id>.title`. */
  id:
    | 'local'
    | 'trust'
    | 'presenter'
    | 'converter'
    | 'privacy'
    | 'twin';
}

const benefits: Benefit[] = [
  { icon: FolderOpen, id: 'local' },
  { icon: ShieldCheck, id: 'trust' },
  { icon: Presentation, id: 'presenter' },
  { icon: Wand2, id: 'converter' },
  { icon: KeyRound, id: 'privacy' },
  { icon: Sparkles, id: 'twin' },
];

interface PendingTrust {
  deck: LoadedDeck;
  capabilities: TrustCapability[];
}

export function App() {
  const isAudienceWindow = new URLSearchParams(window.location.search).get('audience') === '1';
  const { t } = useI18n();
  const [deck, setDeck] = useState<LoadedDeck | null>(null);
  const [iframeSandbox, setIframeSandbox] = useState<string>(BASE_SANDBOX_TOKEN);
  const [pendingTrust, setPendingTrust] = useState<PendingTrust | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOverview, setShowOverview] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showConverter, setShowConverter] = useState(false);
  const deckRef = useRef<LoadedDeck | null>(null);
  const pendingTrustRef = useRef<PendingTrust | null>(null);
  const localizedBenefits = useMemo(
    () =>
      benefits.map(({ icon, id }) => ({
        icon,
        id,
        title: t(`landing.benefit.${id}.title`),
        description: t(`landing.benefit.${id}.desc`),
      })),
    [t],
  );

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

  const enterDeck = (loaded: LoadedDeck, granted: ReadonlyArray<TrustCapability>) => {
    deckRef.current?.revoke();
    setIframeSandbox(sandboxTokensFor(granted));
    setDeck(loaded);
    setCurrentIndex(0);
    setShowOverview(false);
    setShowNotes(false);
    setPendingTrust(null);
  };

  const openDeckFile = async (file: File) => {
    setStatus('loading');
    setError(null);

    try {
      const nextDeck = await loadDeck(file);
      const requiredCaps = normalizeCapabilities(nextDeck.manifest.compat?.requires);

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
          ? `${loadError.code}: ${loadError.message}`
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

  const handleSampleDeck = async () => {
    setStatus('loading');
    setError(null);

    try {
      const response = await fetch('/fixtures/valid-basic.hcslides');
      if (!response.ok) {
        throw new Error(t('errors.sampleMissing'));
      }
      const blob = await response.blob();
      await openDeckFile(new File([blob], 'valid-basic.hcslides', { type: blob.type }));
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
            <PanelsTopLeft />
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
          <section className="landing-hero" aria-labelledby="hero-title">
            <span className="landing-eyebrow">
              <span className="landing-eyebrow-dot" aria-hidden />
              {t('landing.eyebrow')}
            </span>
            <h1 id="hero-title" className="landing-headline">
              {t('landing.headline.before')}{' '}
              <em>{t('landing.headline.token')}</em>{' '}
              {t('landing.headline.after')}
            </h1>
            <p className="landing-subhead">{t('landing.subhead')}</p>

            <div className="landing-actions">
              <label
                className="btn cta lg file-button"
                data-testid="open-deck-button"
              >
                <span>{t('landing.cta.open')}</span>
                <ArrowRight className="btn-icon" aria-hidden size={18} />
                <input
                  type="file"
                  accept=".hcslides,application/zip"
                  onChange={handleFileChange}
                />
              </label>
              <button
                type="button"
                className="btn ghost lg"
                onClick={() => setShowConverter((value) => !value)}
                aria-expanded={showConverter}
                aria-controls="converter-panel"
                data-testid="converter-toggle"
              >
                <Wand2 className="btn-icon" aria-hidden size={16} />
                {showConverter
                  ? t('landing.cta.convert.hide')
                  : t('landing.cta.convert.show')}
              </button>
              <button
                type="button"
                className="btn ghost lg"
                onClick={handleSampleDeck}
                data-testid="open-sample-button"
              >
                <Sparkles className="btn-icon" aria-hidden size={16} />
                {t('landing.cta.sample')}
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

          <section
            className="landing-benefits"
            aria-labelledby="benefits-title"
          >
            <h2 id="benefits-title" className="visually-hidden">
              {t('landing.sectionTitle')}
            </h2>
            {localizedBenefits.map(({ icon: Icon, id, title, description }) => (
              <article className="benefit" key={id}>
                <span className="benefit-icon" aria-hidden>
                  <Icon size={18} />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </section>
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
