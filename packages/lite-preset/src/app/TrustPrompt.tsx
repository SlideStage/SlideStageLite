import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import type { Manifest, TrustCapability } from '@slidestage/core/deck/types';

interface TrustPromptProps {
  manifest: Manifest;
  capabilities: TrustCapability[];
  onGrant: () => void;
  onCancel: () => void;
}

export function TrustPrompt({ manifest, capabilities, onGrant, onCancel }: TrustPromptProps) {
  const grantBtnRef = useRef<HTMLButtonElement | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    grantBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="trust-prompt-backdrop"
      role="presentation"
      data-testid="trust-prompt-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="trust-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-prompt-title"
        aria-describedby="trust-prompt-desc"
        data-testid="trust-prompt"
      >
        <header className="trust-prompt-head">
          <span className="trust-prompt-eyebrow">
            <ShieldCheck size={12} aria-hidden />
            {t('trust.eyebrow')}
          </span>
          <h2 id="trust-prompt-title">{manifest.title}</h2>
          <p id="trust-prompt-desc" className="trust-prompt-lead">
            {t('trust.lead.before')}{' '}
            <strong>{t('trust.lead.emphasis')}</strong>
            {t('trust.lead.after')}
          </p>
        </header>

        <ul className="trust-prompt-list" data-testid="trust-prompt-caps">
          {capabilities.map((cap) => (
            <li key={cap} data-cap={cap}>
              <strong>{t(`trust.cap.${cap}.title`)}</strong>
              <p>{t(`trust.cap.${cap}.desc`)}</p>
            </li>
          ))}
        </ul>

        {manifest.compat?.notes ? (
          <p className="trust-prompt-notes">
            <strong>{t('trust.producerNote')}</strong> {manifest.compat.notes}
          </p>
        ) : null}

        <p className="trust-prompt-warning">{t('trust.warning')}</p>

        <div className="trust-prompt-actions">
          <button
            type="button"
            className="btn ghost"
            data-testid="trust-prompt-cancel"
            onClick={onCancel}
          >
            {t('trust.cancel')}
          </button>
          <button
            ref={grantBtnRef}
            type="button"
            className="btn primary"
            data-testid="trust-prompt-grant"
            onClick={onGrant}
          >
            <ShieldCheck className="btn-icon" size={14} aria-hidden />
            {t('trust.grant')}
          </button>
        </div>
      </div>
    </div>
  );
}
