/**
 * Landing-page footer.
 *
 * Renders the "本地运行 · 无服务端" status pill and (optionally) the China
 * mainland ICP / 公安备案 chips. Mirrors the layout cursor-loss uses on its
 * own landing page, but every visible chip is driven by `VITE_BEIAN_*`
 * environment variables so the same bundle can ship to deployments with
 * different filings — or none at all.
 *
 * Visibility rules:
 *   - The "local · no server" status is always rendered.
 *   - `VITE_BEIAN_ICP_TEXT` non-empty → ICP chip is rendered (link target
 *     defaults to https://beian.miit.gov.cn/ when no URL is provided).
 *   - `VITE_BEIAN_MPS_TEXT` non-empty → 公安备案 chip is rendered with the
 *     small 国徽 (`/mpslogo.png`). If MPS_TEXT is set but MPS_URL is empty
 *     the chip degrades to plain text instead of an unusable link.
 *
 * This component is only mounted on the landing surface (deck-closed shell)
 * — the deck-open viewer and the audience window stay pristine so neither
 * the presenter's stage nor the projected audience output gets occluded.
 */
import { useI18n } from '../i18n/I18nProvider';

const DEFAULT_ICP_URL = 'https://beian.miit.gov.cn/';

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function Footer() {
  const { t } = useI18n();

  const icpText = trimmed(import.meta.env.VITE_BEIAN_ICP_TEXT);
  const icpUrl = trimmed(import.meta.env.VITE_BEIAN_ICP_URL) || DEFAULT_ICP_URL;
  const mpsText = trimmed(import.meta.env.VITE_BEIAN_MPS_TEXT);
  const mpsUrl = trimmed(import.meta.env.VITE_BEIAN_MPS_URL);

  const showIcp = icpText.length > 0;
  const showMps = mpsText.length > 0;

  return (
    <footer
      className="app-footer"
      role="contentinfo"
      data-testid="app-footer"
    >
      <div className="app-footer-inner">
        <span className="app-footer-status" data-testid="app-footer-status">
          <span className="app-footer-dot" aria-hidden />
          {t('footer.local')}
        </span>

        {showIcp ? (
          <>
            <span className="app-footer-sep" aria-hidden>
              ·
            </span>
            <a
              className="app-footer-link"
              href={icpUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="app-footer-icp"
            >
              {icpText}
            </a>
          </>
        ) : null}

        {showMps ? (
          <>
            <span className="app-footer-sep" aria-hidden>
              ·
            </span>
            {mpsUrl.length > 0 ? (
              <a
                className="app-footer-link app-footer-mps"
                href={mpsUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="app-footer-mps"
              >
                <img
                  src="/mpslogo.png"
                  alt=""
                  aria-hidden
                  className="app-footer-mps-logo"
                  width={12}
                  height={13}
                />
                {mpsText}
              </a>
            ) : (
              <span
                className="app-footer-link app-footer-mps"
                data-testid="app-footer-mps"
              >
                <img
                  src="/mpslogo.png"
                  alt=""
                  aria-hidden
                  className="app-footer-mps-logo"
                  width={12}
                  height={13}
                />
                {mpsText}
              </span>
            )}
          </>
        ) : null}
      </div>
    </footer>
  );
}
