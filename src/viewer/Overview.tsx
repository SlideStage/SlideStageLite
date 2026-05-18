import type { LoadedDeck } from '../deck/types';
import { useI18n } from '../i18n/I18nProvider';

interface OverviewProps {
  deck: LoadedDeck;
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function Overview({ deck, currentIndex, onSelect, onClose }: OverviewProps) {
  const { t } = useI18n();
  return (
    <section className="overview-panel" aria-label={t('overview.aria')}>
      <div className="panel-heading">
        <h3>{t('overview.title')}</h3>
        <button type="button" className="btn ghost small" onClick={onClose}>
          {t('overview.close')}
        </button>
      </div>
      <div className="overview-grid">
        {deck.manifest.slides.map((slide, index) => (
          <button
            type="button"
            className={index === currentIndex ? 'overview-card active' : 'overview-card'}
            key={slide.id}
            onClick={() => onSelect(index)}
          >
            {deck.thumbnailUrls[index] ? (
              <img src={deck.thumbnailUrls[index] ?? undefined} alt="" />
            ) : (
              <span className="thumbnail-fallback">{slide.index}</span>
            )}
            <strong>{slide.label}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
