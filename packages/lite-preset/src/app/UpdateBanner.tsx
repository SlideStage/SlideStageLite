/**
 * Sticky landing-page banner that drives the native Tauri auto-updater.
 *
 * UX contract:
 *   - Quiet:    shows nothing until the first successful manifest probe.
 *   - One-click: clicking "Install" downloads, signature-verifies, and
 *                relaunches without leaving the app.
 *   - Progress: an inline progress bar replaces the CTA while the
 *                download is running; the dismiss button is hidden so
 *                the user can't strand a half-installed update.
 *   - Errors:    show a sticky-but-dismissible error variant; the user
 *                can dismiss and try again on the next launch.
 *   - Dismiss:   per-version, persisted to localStorage so we never
 *                re-prompt for a release the user already declined.
 *   - Tauri-only: web builds never mount the banner — the bundle that
 *                serves them is whatever the CDN cached last, so the
 *                concept of "a newer release" doesn't apply.
 *
 * The actual updater call and signature verification live in
 * `desktop/updateCheck.ts`. The component here owns presentation,
 * progress state, and dismiss UX.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { isTauri } from '../desktop/env';
import {
  checkForUpdate,
  dismissUpdate,
  installUpdate,
  type InstallProgress,
  type PendingUpdate,
} from '../desktop/updateCheck';

type BannerPhase =
  /** A newer release is available; user has not interacted yet. */
  | { kind: 'available' }
  /** Download started; we may not yet know the total size. */
  | { kind: 'downloading'; bytesDownloaded: number; totalBytes: number | null }
  /** Download done; install pass running; relaunch imminent. */
  | { kind: 'installing' }
  /**
   * Install finished but relaunch hasn't picked up yet. Mostly cosmetic
   * because on macOS we get a few hundred ms between "installed" and
   * the new binary taking over.
   */
  | { kind: 'restarting' }
  /** Something went wrong; banner shows a retryable error state. */
  | { kind: 'error'; message: string };

/**
 * Probe the updater plugin once per app mount. Skips entirely outside
 * Tauri so the web bundle does not perform a startup network request
 * the user did not opt into.
 */
function useReleaseProbe(): {
  release: PendingUpdate | null;
  setRelease: (next: PendingUpdate | null) => void;
} {
  const [release, setRelease] = useState<PendingUpdate | null>(null);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const next = await checkForUpdate();
        if (!cancelled && next) setRelease(next);
      } catch (err) {
        // checkForUpdate already swallows network errors and returns
        // null. A throw here is unexpected — surface it to dev tools
        // but don't break the SPA.
        // eslint-disable-next-line no-console
        console.warn('update probe threw unexpectedly', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { release, setRelease };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function progressPercent(
  bytesDownloaded: number,
  totalBytes: number | null,
): number | null {
  if (!totalBytes || totalBytes <= 0) return null;
  const pct = Math.round((bytesDownloaded / totalBytes) * 100);
  return Math.max(0, Math.min(100, pct));
}

export function UpdateBanner() {
  const { tFormat, t } = useI18n();
  const { release, setRelease } = useReleaseProbe();
  const [phase, setPhase] = useState<BannerPhase>({ kind: 'available' });

  const handleInstall = useCallback(async () => {
    setPhase({ kind: 'downloading', bytesDownloaded: 0, totalBytes: null });
    try {
      await installUpdate((event: InstallProgress) => {
        switch (event.phase) {
          case 'started':
            setPhase({
              kind: 'downloading',
              bytesDownloaded: 0,
              totalBytes: event.totalBytes,
            });
            break;
          case 'progress':
            setPhase({
              kind: 'downloading',
              bytesDownloaded: event.bytesDownloaded,
              totalBytes: event.totalBytes,
            });
            break;
          case 'finished':
            setPhase({ kind: 'installing' });
            break;
          case 'installed':
            // Relaunch is fired immediately after this event in
            // installUpdate — keep the banner in a "Restarting…" state
            // for the brief gap before the new process replaces us.
            setPhase({ kind: 'restarting' });
            break;
          default:
            break;
        }
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('auto-updater failed', err);
      const message =
        err instanceof Error && err.message ? err.message : String(err);
      setPhase({ kind: 'error', message });
    }
  }, []);

  const handleDismiss = useCallback(() => {
    if (release) dismissUpdate(release.version);
    setRelease(null);
  }, [release, setRelease]);

  const handleRetry = useCallback(() => {
    setPhase({ kind: 'available' });
  }, []);

  if (!release) return null;

  // Phase 1 — available
  if (phase.kind === 'available') {
    return (
      <aside
        className="update-banner"
        role="status"
        aria-live="polite"
        data-testid="update-banner"
        data-phase="available"
      >
        <span className="update-banner-icon" aria-hidden>
          <Download size={16} />
        </span>
        <span
          className="update-banner-text"
          data-testid="update-banner-text"
        >
          {tFormat('update.body', { version: release.version })}
        </span>
        <button
          type="button"
          className="update-banner-cta"
          onClick={handleInstall}
          data-testid="update-banner-cta"
        >
          {t('update.cta.install')}
        </button>
        <button
          type="button"
          className="update-banner-dismiss"
          onClick={handleDismiss}
          aria-label={t('update.dismiss')}
          data-testid="update-banner-dismiss"
        >
          <X size={14} strokeWidth={2.2} aria-hidden />
        </button>
      </aside>
    );
  }

  // Phase 2 — downloading
  if (phase.kind === 'downloading') {
    const pct = progressPercent(phase.bytesDownloaded, phase.totalBytes);
    const detail =
      phase.totalBytes !== null
        ? tFormat('update.progress.detail', {
            downloaded: formatBytes(phase.bytesDownloaded),
            total: formatBytes(phase.totalBytes),
          })
        : tFormat('update.progress.detailUnknown', {
            downloaded: formatBytes(phase.bytesDownloaded),
          });
    return (
      <aside
        className="update-banner"
        role="status"
        aria-live="polite"
        data-testid="update-banner"
        data-phase="downloading"
      >
        <span className="update-banner-icon" aria-hidden>
          <Download size={16} />
        </span>
        <span
          className="update-banner-text"
          data-testid="update-banner-text"
        >
          {tFormat('update.progress.body', { version: release.version })}
        </span>
        <div
          className="update-banner-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          data-testid="update-banner-progress"
        >
          <div
            className="update-banner-progress-bar"
            style={{ width: pct !== null ? `${pct}%` : '100%' }}
            data-indeterminate={pct === null ? 'true' : undefined}
          />
        </div>
        <span
          className="update-banner-progress-detail"
          data-testid="update-banner-progress-detail"
        >
          {detail}
        </span>
      </aside>
    );
  }

  // Phase 3 — installing (download finished, install running)
  if (phase.kind === 'installing') {
    return (
      <aside
        className="update-banner"
        role="status"
        aria-live="polite"
        data-testid="update-banner"
        data-phase="installing"
      >
        <span className="update-banner-icon update-banner-icon-spin" aria-hidden>
          <RefreshCw size={16} />
        </span>
        <span
          className="update-banner-text"
          data-testid="update-banner-text"
        >
          {t('update.installing')}
        </span>
      </aside>
    );
  }

  // Phase 4 — restarting (install done, relaunch pending)
  if (phase.kind === 'restarting') {
    return (
      <aside
        className="update-banner"
        role="status"
        aria-live="polite"
        data-testid="update-banner"
        data-phase="restarting"
      >
        <span className="update-banner-icon" aria-hidden>
          <CheckCircle2 size={16} />
        </span>
        <span
          className="update-banner-text"
          data-testid="update-banner-text"
        >
          {t('update.restarting')}
        </span>
      </aside>
    );
  }

  // Phase 5 — error
  return (
    <aside
      className="update-banner update-banner-error"
      role="alert"
      aria-live="assertive"
      data-testid="update-banner"
      data-phase="error"
    >
      <span className="update-banner-icon" aria-hidden>
        <Download size={16} />
      </span>
      <span
        className="update-banner-text"
        data-testid="update-banner-text"
      >
        {tFormat('update.error', { message: phase.message })}
      </span>
      <button
        type="button"
        className="update-banner-cta"
        onClick={handleRetry}
        data-testid="update-banner-retry"
      >
        {t('update.cta.retry')}
      </button>
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={handleDismiss}
        aria-label={t('update.dismiss')}
        data-testid="update-banner-dismiss"
      >
        <X size={14} strokeWidth={2.2} aria-hidden />
      </button>
    </aside>
  );
}
