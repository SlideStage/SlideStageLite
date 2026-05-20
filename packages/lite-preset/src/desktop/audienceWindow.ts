/**
 * Tauri-only helpers for managing the audience webview window.
 *
 * Defaults to native fullscreen on the picked monitor (creates a new
 * macOS Space, matches Keynote / PowerPoint behavior). The presenter
 * can downgrade to a normal window after opening via
 * `setAudienceFullscreen`.
 *
 * IMPORTANT: imports `@tauri-apps/api/webviewWindow` at the top level.
 * Only import this module from a *dynamic* `await import(...)` inside an
 * `if (isTauri())` branch so the Web bundle never pulls Tauri in.
 */
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import {
  WebviewWindow,
  getAllWebviewWindows,
} from '@tauri-apps/api/webviewWindow';
import type { MonitorInfo } from './monitors';

const LABEL_PREFIX = 'audience-';

export interface OpenAudienceOptions {
  /** Monitor to fullscreen onto. When null, opens on whatever screen the OS picks. */
  monitor: MonitorInfo | null;
  /** Default true. Pass false to open a movable framed window instead. */
  fullscreen?: boolean;
}

function labelFor(fingerprint: string): string {
  // Tauri window labels must be ASCII; fingerprints are hex so this is
  // safe. Truncate to keep us comfortably under the platform's label cap.
  return `${LABEL_PREFIX}${fingerprint.slice(0, 32)}`;
}

async function findAudienceWindow(fingerprint: string): Promise<WebviewWindow | null> {
  const label = labelFor(fingerprint);
  const windows = await getAllWebviewWindows();
  return windows.find((w) => w.label === label) ?? null;
}

/**
 * Open (or focus, if already open) the audience webview window for a
 * given deck fingerprint. The window loads the same SPA, gated by the
 * `?audience=1` query param.
 */
export async function openAudienceWindow(
  fingerprint: string,
  options: OpenAudienceOptions = { monitor: null },
): Promise<void> {
  const fullscreen = options.fullscreen ?? true;
  const monitor = options.monitor;
  const label = labelFor(fingerprint);

  const existing = await findAudienceWindow(fingerprint);
  if (existing) {
    if (monitor) {
      try {
        await existing.setPosition(new PhysicalPosition(monitor.x, monitor.y));
      } catch {
        // best effort
      }
    }
    try {
      await existing.setFullscreen(fullscreen);
    } catch {
      // ignore — older webkit may refuse mid-flight
    }
    try {
      await existing.setFocus();
    } catch {
      // Window may live on another Space; focus failure is non-fatal.
    }
    return;
  }

  const url = `/?audience=1&deck=${encodeURIComponent(fingerprint)}`;
  // We open at the monitor's natural origin so the OS doesn't briefly
  // flash the new window on the primary display before we move it.
  const initialX = monitor?.x ?? 0;
  const initialY = monitor?.y ?? 0;
  const initialWidth = monitor?.width ?? 1280;
  const initialHeight = monitor?.height ?? 720;

  const win = new WebviewWindow(label, {
    url,
    title: 'SlideStageLite — Audience',
    width: Math.min(1280, Math.floor(initialWidth / (monitor?.scaleFactor ?? 1))),
    height: Math.min(720, Math.floor(initialHeight / (monitor?.scaleFactor ?? 1))),
    x: initialX,
    y: initialY,
    minWidth: 640,
    minHeight: 400,
    resizable: true,
    decorations: !fullscreen,
    visible: true,
    focus: true,
  });

  // Tauri 2 + macOS: `set_outer_position` after create is the only
  // reliable way to place a window on a non-primary display. We do that
  // (and the fullscreen toggle) once the window has actually been
  // created, otherwise the setters are no-ops.
  await new Promise<void>((resolve) => {
    let resolved = false;
    win
      .once('tauri://created', async () => {
        if (resolved) return;
        resolved = true;
        try {
          if (monitor) {
            await win.setPosition(new PhysicalPosition(monitor.x, monitor.y));
            await win.setSize(new PhysicalSize(monitor.width, monitor.height));
          }
          if (fullscreen) {
            await win.setFullscreen(true);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('audience window placement failed', err);
        }
        resolve();
      })
      .catch(() => resolve());
    // Failsafe: if `tauri://created` never fires for some reason (rare)
    // we still resolve so the caller can move on.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 1500);
  });
}

/**
 * Toggle the audience window between native fullscreen and a regular
 * framed window. Called from the audience window's "exit fullscreen"
 * button.
 */
export async function setAudienceFullscreen(
  fingerprint: string,
  fullscreen: boolean,
): Promise<void> {
  const win = await findAudienceWindow(fingerprint);
  if (!win) return;
  try {
    await win.setFullscreen(fullscreen);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('audience setFullscreen failed', err);
  }
}

/**
 * Best-effort close of the audience window for a given deck.
 * Safe to call even if no audience window is currently open.
 */
export async function closeAudienceWindow(fingerprint: string): Promise<void> {
  const win = await findAudienceWindow(fingerprint);
  if (!win) return;
  try {
    await win.close();
  } catch {
    // Already closing.
  }
}
