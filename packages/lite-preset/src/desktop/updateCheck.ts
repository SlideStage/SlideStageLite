/**
 * Native Tauri auto-updater for the SlideStage Lite desktop app.
 *
 * Why this module exists:
 *   SlideStage Lite ships outside the Mac App Store as a notarized DMG
 *   on GitHub Releases. The runtime here uses Tauri 2's official
 *   `@tauri-apps/plugin-updater` to fetch a static `latest.json`
 *   manifest, verify the bundled `.app.tar.gz.sig` against the minisign
 *   public key baked into `tauri.conf.json`, download, install, and
 *   relaunch — all with a single trusted code path.
 *
 *   We previously implemented a "passive banner" that polled the GitHub
 *   Releases API and opened the release page in the browser. That
 *   surface is gone now: the user no longer has to download a DMG and
 *   drag it into Applications. They click "Install update" and the app
 *   takes care of the rest.
 *
 *   Web builds NEVER hit this code. Everything Tauri-flavoured is
 *   dynamic-imported so the Vite bundle stays clean of native chunks.
 *
 * Failure contract:
 *   - Outside Tauri  → `checkForUpdate` returns null (the React shell
 *                       short-circuits before mount).
 *   - Network down   → null + single console.warn; no error UI.
 *   - Endpoint 404   → null; both endpoints in tauri.conf.json are tried
 *                       in order by the Tauri runtime.
 *   - Bad signature  → `downloadAndInstall()` throws; the React shell
 *                       surfaces a sticky-but-dismissible error state.
 *   - User dismissed → suppressed for that exact version, then re-armed
 *                       as soon as a strictly-newer version ships.
 */
import { isTauri } from './env';

/** localStorage key — value is the most recently dismissed update version. */
export const UPDATE_DISMISS_STORAGE_KEY = 'slidestage-lite:update-dismiss';

/**
 * Minimal shape we expose to the UI. We deliberately do NOT export the
 * raw `Update` instance from `@tauri-apps/plugin-updater` because it
 * doesn't serialize cleanly across React renders and we'd rather force
 * UI code to go through `installUpdate()` below.
 */
export interface PendingUpdate {
  /** Semver string of the new release (e.g. `"0.2.0"`). */
  version: string;
  /** Semver of the currently-running app, useful for "from X to Y" copy. */
  currentVersion: string;
  /** Release notes from `latest.json`. Empty string when not provided. */
  notes: string;
  /** Publish date (RFC 3339) from `latest.json`. Empty when not provided. */
  publishedAt: string;
}

/**
 * Progress events forwarded to the React shell while
 * `downloadAndInstall()` runs. Mirrors the Tauri callback API but
 * already accumulates `bytesDownloaded` for us (the raw callback only
 * gives a per-chunk delta).
 */
export type InstallProgress =
  | { phase: 'started'; totalBytes: number | null }
  | { phase: 'progress'; bytesDownloaded: number; totalBytes: number | null }
  | { phase: 'finished' }
  | { phase: 'installed' };

interface TauriUpdaterModule {
  check: (opts?: { timeout?: number }) => Promise<TauriUpdate | null>;
}

interface TauriProcessModule {
  relaunch: () => Promise<void>;
}

interface TauriAppModule {
  getVersion: () => Promise<string>;
}

interface TauriDownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: { contentLength?: number; chunkLength?: number };
}

interface TauriUpdate {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  available?: boolean;
  downloadAndInstall: (
    onEvent?: (event: TauriDownloadEvent) => void,
  ) => Promise<void>;
}

/** Cached reference to the most recently-checked Tauri update handle. */
let cachedHandle: TauriUpdate | null = null;

/**
 * Pull the running app's version. Returns `null` outside Tauri (web
 * builds have no concept of a "release version" — the bundle is
 * whatever the CDN served last). The import is dynamic so the Tauri
 * runtime client never lands in the web chunk.
 */
export async function getCurrentDesktopVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const mod = (await import('@tauri-apps/api/app')) as TauriAppModule;
    return await mod.getVersion();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('getCurrentDesktopVersion failed', err);
    return null;
  }
}

/**
 * High-level: "is there a newer release we should offer to install?".
 * Returns `null` when there is no update, we can't tell, or the user
 * has dismissed this exact version.
 *
 * Side effect: caches the underlying Tauri `Update` handle on success
 * so a follow-up `installUpdate()` call doesn't have to re-fetch the
 * manifest (and re-verify the signature) just to start the download.
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!isTauri()) return null;
  let mod: TauriUpdaterModule;
  try {
    mod = (await import(
      '@tauri-apps/plugin-updater'
    )) as unknown as TauriUpdaterModule;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('failed to load @tauri-apps/plugin-updater', err);
    return null;
  }
  let update: TauriUpdate | null;
  try {
    // 30s timeout: GitHub Releases CDN is usually fast, but the second
    // endpoint (slidestage.dev) can take a beat to wake up.
    update = await mod.check({ timeout: 30_000 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Tauri updater check failed', err);
    cachedHandle = null;
    return null;
  }
  if (!update) {
    cachedHandle = null;
    return null;
  }
  // Tauri 2 has flirted with both shapes here — older versions returned
  // a plain object with an `available: boolean` field, newer ones
  // return `null` when there's nothing to install. We accept both so a
  // dependency bump doesn't silently mask updates.
  if (update.available === false) {
    cachedHandle = null;
    return null;
  }
  if (isDismissed(update.version)) {
    cachedHandle = null;
    return null;
  }
  cachedHandle = update;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? '',
    publishedAt: update.date ?? '',
  };
}

/**
 * Drive the auto-installer for the most recently-checked update.
 *
 * Returns nothing on success; the OS process will be replaced by the
 * relaunched binary after this function resolves (on macOS the call
 * here finishes BEFORE the app exits, but on Windows the installer
 * forcibly quits the running process).
 *
 * Throws on:
 *   - no pending update (caller didn't run `checkForUpdate` first)
 *   - signature mismatch
 *   - download error
 *   - relaunch error
 *
 * The caller is expected to wrap the call in a try/catch and surface
 * the error to the user.
 */
export async function installUpdate(
  onProgress?: (event: InstallProgress) => void,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('installUpdate is only available inside Tauri');
  }
  const handle = cachedHandle;
  if (!handle) {
    throw new Error(
      'installUpdate called without a pending update; run checkForUpdate() first.',
    );
  }
  let bytesDownloaded = 0;
  let totalBytes: number | null = null;
  await handle.downloadAndInstall((event: TauriDownloadEvent) => {
    switch (event.event) {
      case 'Started': {
        totalBytes =
          typeof event.data?.contentLength === 'number'
            ? event.data.contentLength
            : null;
        onProgress?.({ phase: 'started', totalBytes });
        break;
      }
      case 'Progress': {
        const chunk =
          typeof event.data?.chunkLength === 'number'
            ? event.data.chunkLength
            : 0;
        bytesDownloaded += chunk;
        onProgress?.({ phase: 'progress', bytesDownloaded, totalBytes });
        break;
      }
      case 'Finished': {
        onProgress?.({ phase: 'finished' });
        break;
      }
      default:
        break;
    }
  });
  // Install completed. Clear the cached handle so a second click on the
  // button doesn't accidentally re-install. Then relaunch.
  cachedHandle = null;
  onProgress?.({ phase: 'installed' });
  try {
    const proc = (await import(
      '@tauri-apps/plugin-process'
    )) as unknown as TauriProcessModule;
    await proc.relaunch();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('relaunch failed; user will need to restart manually', err);
    throw err;
  }
}

/**
 * Remember that the user dismissed a specific release so we don't keep
 * nagging on every cold start. Stored per-version so a future release
 * automatically un-suppresses the banner.
 */
export function dismissUpdate(version: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(UPDATE_DISMISS_STORAGE_KEY, version);
  } catch {
    // Storage may be disabled / quota-exceeded; degrade silently.
  }
}

export function isDismissed(version: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem(UPDATE_DISMISS_STORAGE_KEY);
    return stored === version;
  } catch {
    return false;
  }
}

/**
 * Test seam — clears the persisted dismiss so a fresh probe sees a
 * pristine state and resets the cached Tauri update handle.
 */
export function __resetUpdateStateForTests(): void {
  try {
    window.localStorage.removeItem(UPDATE_DISMISS_STORAGE_KEY);
  } catch {
    // ignore
  }
  cachedHandle = null;
}

/**
 * Test seam — injects a fake Tauri `Update` handle so the install path
 * can be exercised without a real Tauri runtime. The injected handle
 * stays in place for exactly one `installUpdate()` call.
 */
export function __setCachedHandleForTests(handle: TauriUpdate | null): void {
  cachedHandle = handle;
}
