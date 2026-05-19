/**
 * Modal that lets the presenter pick which display the audience window
 * should fullscreen onto. Single-monitor systems skip this dialog
 * entirely (see `DeckViewer.openAudienceWindow` for the bypass).
 */
import { useEffect, useMemo, useState } from 'react';
import { Monitor, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { defaultAudienceMonitor, type MonitorInfo } from './monitors';

export interface MonitorPickerProps {
  monitors: MonitorInfo[];
  onPick: (monitor: MonitorInfo, fullscreen: boolean) => void;
  onCancel: () => void;
}

export function MonitorPicker({ monitors, onPick, onCancel }: MonitorPickerProps) {
  const { t, tFormat } = useI18n();
  const recommended = useMemo(() => defaultAudienceMonitor(monitors), [monitors]);
  const [selectedId, setSelectedId] = useState<number>(recommended?.id ?? monitors[0]?.id ?? 0);
  const selected = monitors.find((m) => m.id === selectedId) ?? monitors[0];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'Enter' && selected) {
        event.preventDefault();
        onPick(selected, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onPick, selected]);

  return (
    <div
      className="monitor-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="monitor-picker-title"
      data-testid="monitor-picker"
    >
      <div className="monitor-picker">
        <header className="monitor-picker-head">
          <h2 id="monitor-picker-title">{t('viewer.monitorPicker.title')}</h2>
          <button
            type="button"
            className="btn ghost icon-only"
            onClick={onCancel}
            aria-label={t('viewer.monitorPicker.cancel')}
            data-testid="monitor-picker-close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        <p className="monitor-picker-desc muted small">{t('viewer.monitorPicker.desc')}</p>

        <div className="monitor-picker-grid" role="radiogroup" aria-labelledby="monitor-picker-title">
          {monitors.map((m) => {
            const isSelected = m.id === selectedId;
            const isRecommended = recommended?.id === m.id;
            return (
              <button
                type="button"
                key={m.id}
                role="radio"
                aria-checked={isSelected}
                className={`monitor-card${isSelected ? ' selected' : ''}`}
                onClick={() => setSelectedId(m.id)}
                onDoubleClick={() => onPick(m, true)}
                data-testid={`monitor-option-${m.id}`}
              >
                <span className="monitor-card-icon" aria-hidden>
                  <Monitor size={28} />
                </span>
                <span className="monitor-card-name">{m.name}</span>
                <span className="monitor-card-kind muted small">
                  {m.isPrimary
                    ? t('viewer.monitorPicker.primary')
                    : t('viewer.monitorPicker.secondary')}
                  {isRecommended ? ` · ${t('viewer.monitorPicker.recommended')}` : ''}
                </span>
                <span className="monitor-card-size muted small">
                  {tFormat('viewer.monitorPicker.size', {
                    w: m.width,
                    h: m.height,
                    scale: Number.isFinite(m.scaleFactor) ? m.scaleFactor.toFixed(1) : '1.0',
                  })}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="monitor-picker-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onCancel}
            data-testid="monitor-picker-cancel"
          >
            {t('viewer.monitorPicker.cancel')}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => selected && onPick(selected, false)}
            disabled={!selected}
            data-testid="monitor-picker-windowed"
          >
            {t('viewer.monitorPicker.windowed')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => selected && onPick(selected, true)}
            disabled={!selected}
            data-testid="monitor-picker-fullscreen"
          >
            {t('viewer.monitorPicker.fullscreen')}
          </button>
        </footer>
      </div>
    </div>
  );
}
