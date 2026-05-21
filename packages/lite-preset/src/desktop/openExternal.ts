/**
 * Open an external `https?://` URL using the host system's default
 * browser.
 *
 * Why this exists:
 *   In a regular browser tab a plain `<a href="…" target="_blank">` is
 *   all you need. Inside the Tauri 2 macOS WebView, however, neither
 *   `window.open()` nor a `target="_blank"` click bubbles out to the
 *   host: the WKWebView intercepts the navigation and the link silently
 *   does nothing. That manifests as "the slidestage.dev link in the
 *   footer doesn't work".
 *
 *   We route external link clicks through `@tauri-apps/plugin-opener`
 *   when we detect we're inside Tauri, and fall back to the native
 *   `window.open()` behavior on the web. The plugin's
 *   `opener:allow-default-urls` permission whitelists `https://`,
 *   `http://`, `mailto:` and `tel:` automatically — exactly the set our
 *   footer / future about / help links need.
 *
 * Usage:
 *
 *   ```tsx
 *   <a
 *     href="https://slidestage.dev/"
 *     target="_blank"
 *     rel="noopener noreferrer"
 *     onClick={withDesktopOpener('https://slidestage.dev/')}
 *   >…</a>
 *   ```
 *
 * On the web `withDesktopOpener` returns `undefined` so React drops the
 * handler entirely and the bundle stays free of any Tauri imports.
 */
import type { MouseEvent } from 'react';
import { isTauri } from './env';

/**
 * Lower-level helper: open `url` via the OS browser when we're inside
 * Tauri, otherwise fall back to `window.open(..., '_blank')`. Returns a
 * promise so callers can `await` if they need to know it completed.
 *
 * Errors from the Tauri plugin are swallowed and logged to console:
 * a failed open should never propagate to a "presentation crashes when
 * the user clicks a footer link" UX.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('openExternal failed', err);
  }
}

/**
 * React handler factory. Returns `undefined` on the web so the anchor
 * keeps its native behavior (and React doesn't attach an empty listener
 * just to call `event.preventDefault()` for no reason). Inside Tauri it
 * returns an onClick that suppresses the default in-WebView navigation
 * and routes the URL through `openExternal()` instead.
 *
 * The handler also short-circuits on modifier-key clicks (cmd/ctrl/shift
 * /alt) so power-users can still middle/cmd-click — though inside Tauri
 * those would not actually open in a new browser tab, so we route them
 * the same way for consistency.
 */
export function withDesktopOpener(
  url: string,
):
  | ((event: MouseEvent<HTMLAnchorElement>) => void)
  | undefined {
  if (!isTauri()) return undefined;
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternal(url);
  };
}
