import { useUiTranslator } from '../i18n/translator';
import type { ManifestSlide } from '@slidestage/core/deck/types';
import { DeckStage } from './DeckStage';
import { formatElapsed } from './viewMath';

export interface PresenterSideRailProps {
  upNext: {
    slide: ManifestSlide | null;
    src: string | null;
    srcdoc?: string;
    iframeSandbox?: string;
    deckDimensions: { width: number; height: number };
  };
  timer: {
    elapsedMs: number;
    onReset: () => void;
  };
  audience: {
    connected: boolean;
  };
}

/**
 * Right-hand side rail used by the presenter layout: Up-next preview,
 * timer, and audience-window status card. All translation keys flow
 * through `useUiTranslator()`.
 */
export function PresenterSideRail({ upNext, timer, audience }: PresenterSideRailProps) {
  const { t, tFormat } = useUiTranslator();
  const nextSlide = upNext.slide;
  const hasNextSlide = Boolean(nextSlide && upNext.src);

  return (
    <aside
      className="presenter-side"
      aria-label={t('viewer.aria.presenterSide')}
      data-testid="presenter-side"
    >
      <section className="presenter-side-card">
        <h3>{t('viewer.side.upNext')}</h3>
        {hasNextSlide && nextSlide && upNext.src ? (
          <div className="presenter-next">
            <DeckStage
              src={upNext.src}
              srcdoc={upNext.srcdoc}
              title={tFormat('viewer.title.next.live', {
                n: nextSlide.index,
                label: nextSlide.label,
              })}
              width={upNext.deckDimensions.width}
              height={upNext.deckDimensions.height}
              testId="next-deck-stage"
              sandbox={upNext.iframeSandbox}
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
          {formatElapsed(timer.elapsedMs)}
        </div>
        <button type="button" className="btn ghost small" onClick={timer.onReset}>
          {t('viewer.side.timer.reset')}
        </button>
      </section>

      <section className="presenter-side-card">
        <h3>{t('viewer.side.audience')}</h3>
        <div className={`presenter-audience-status ${audience.connected ? 'live' : 'idle'}`}>
          <span className="status-dot" aria-hidden />
          {audience.connected
            ? t('viewer.audience.live')
            : t('viewer.audience.disconnected')}
        </div>
        <p className="muted small">
          {audience.connected
            ? t('viewer.audience.liveHelp')
            : t('viewer.audience.idleHelp')}
        </p>
      </section>
    </aside>
  );
}
