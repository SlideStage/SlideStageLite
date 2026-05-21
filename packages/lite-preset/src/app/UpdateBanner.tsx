/**
 * Sticky landing-page banner that surfaces a newer GitHub Release when
 * one exists. Mounted only on the deck-closed shell (so a presenter
 * never sees it during a talk) and only inside Tauri (web builds
 * auto-update with every server deploy and have no concept of a
 * "downloadable version").
 *
 * UX contract:
 *   - Quiet: shows nothing until the first successful API probe.
 *   - Dismissable: per-tag, persisted to localStorage so we never re-
 *     prompt for a release the user already declined.
 *   - Non-blocking: clicking the link opens the release page in the
 *     OS browser via `openExternal()` — no auto-download, no auto-
 *     install. This keeps the Lite security posture honest: users
 *     verify the artifact themselves.
 *
 * The actual API call and version comparison live in
 * `desktop/updateCheck.ts`. The hook here is just the React shell.
 */
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { isTauri } from '../desktop/env';
import {
  checkForUpdate,
  dismissUpdate,
  type ReleaseInfo,
} from '../desktop/updateCheck';
import { openExternal } from '../desktop/openExternal';

/**
 * Probe GitHub Releases once per app mount. Skips entirely outside
 * Tauri so the web bundle does not perform a startup network request
 * the user did not opt into.
 */
function useReleaseProbe(): {
  release: ReleaseInfo | null;
  setRelease: (next: ReleaseInfo | null) => void;
} {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    if (!isTauri()) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const next = await checkForUpdate({ signal: controller.signal });
        if (!cancelled && next) setRelease(next);
      } catch (err) {
        // checkForUpdate already swallows network/parse errors and
        // returns null. A throw here would only happen for an abort,
        // which is the explicit cleanup path — log nothing.
        if (!controller.signal.aborted) {
          // eslint-disable-next-line no-console
          console.warn('update probe threw unexpectedly', err);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { release, setRelease };
}

export function UpdateBanner() {
  const { tFormat, t } = useI18n();
  const { release, setRelease } = useReleaseProbe();

  if (!release) return null;

  const handleDownload = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void openExternal(release.releaseUrl);
  };

  const handleDismiss = () => {
    dismissUpdate(release.tag);
    setRelease(null);
  };

  return (
    <aside
      className="update-banner"
      role="status"
      aria-live="polite"
      data-testid="update-banner"
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
        onClick={handleDownload}
        data-testid="update-banner-cta"
      >
        {t('update.cta')}
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
