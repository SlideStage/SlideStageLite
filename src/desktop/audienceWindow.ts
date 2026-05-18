/**
 * Tauri-only helpers for managing the audience webview window.
 *
 * IMPORTANT: This module imports `@tauri-apps/api/webviewWindow` at the
 * top level. It must therefore only be imported from a *dynamic* import
 * inside an `if (isTauri())` branch, so the Web bundle never pulls the
 * Tauri client in.
 */
import { WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';

const LABEL_PREFIX = 'audience-';

function labelFor(fingerprint: string): string {
  // Tauri window labels must be ASCII; fingerprints are hex so this is
  // already safe. We truncate so the label stays under the platform's
  // window-label length cap.
  return `${LABEL_PREFIX}${fingerprint.slice(0, 32)}`;
}

/**
 * Open (or focus, if already open) the audience webview window for a
 * given deck fingerprint. The window loads the same SPA, gated by the
 * `?audience=1` query param.
 */
export async function openAudienceWindow(fingerprint: string): Promise<void> {
  const label = labelFor(fingerprint);

  const existing = (await getAllWebviewWindows()).find((w) => w.label === label);
  if (existing) {
    try {
      await existing.setFocus();
    } catch {
      // Ignore focus failures (window may be on another desktop).
    }
    return;
  }

  const url = `/?audience=1&deck=${encodeURIComponent(fingerprint)}`;
  // eslint-disable-next-line no-new
  new WebviewWindow(label, {
    url,
    title: 'SlidesDeckLite — Audience',
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 400,
    resizable: true,
    decorations: true,
  });
}

/**
 * Best-effort close of the audience window for a given deck.
 * Safe to call even if no audience window is currently open.
 */
export async function closeAudienceWindow(fingerprint: string): Promise<void> {
  const label = labelFor(fingerprint);
  const existing = (await getAllWebviewWindows()).find((w) => w.label === label);
  if (existing) {
    try {
      await existing.close();
    } catch {
      // Already closing.
    }
  }
}
