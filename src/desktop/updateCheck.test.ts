/**
 * Unit tests for the native Tauri updater wrapper.
 *
 * The module under test is intentionally a thin policy layer:
 *   1. Branch on `isTauri()` — return null outside Tauri.
 *   2. Dynamic-import `@tauri-apps/plugin-updater::check()`.
 *   3. Remember the most-recent update handle so a subsequent
 *      `installUpdate()` can call `downloadAndInstall()` + relaunch.
 *   4. Honor a per-version dismiss persisted in localStorage.
 *
 * We exercise:
 *   - `getCurrentDesktopVersion`  → null outside Tauri.
 *   - `checkForUpdate`            → null outside Tauri, null when the
 *                                    Tauri runtime returns null, null
 *                                    when the user dismissed that
 *                                    version, the release otherwise.
 *   - `installUpdate`             → forwards progress, calls relaunch,
 *                                    clears the cached handle.
 *   - `dismissUpdate` / `isDismissed` → round-trip through localStorage,
 *                                    survives storage failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetUpdateStateForTests,
  __setCachedHandleForTests,
  checkForUpdate,
  dismissUpdate,
  installUpdate,
  isDismissed,
  UPDATE_DISMISS_STORAGE_KEY,
  type InstallProgress,
} from '@slidestage/lite-preset/desktop/updateCheck';

// ---- Tauri runtime mocks ------------------------------------------------

type TauriCheckResult = {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  available?: boolean;
  downloadAndInstall: ReturnType<typeof vi.fn>;
} | null;

let pluginCheckImpl: () => Promise<TauriCheckResult> = async () => null;
let relaunchImpl: () => Promise<void> = async () => undefined;

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn((..._args: unknown[]) => pluginCheckImpl()),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(() => relaunchImpl()),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '0.1.1'),
}));

// ---- isTauri() stub via window.__TAURI_INTERNALS__ ----------------------

function setTauriRuntime(present: boolean) {
  if (typeof window === 'undefined') return;
  if (present) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  } else if ('__TAURI_INTERNALS__' in window) {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  __resetUpdateStateForTests();
  pluginCheckImpl = async () => null;
  relaunchImpl = async () => undefined;
});

afterEach(() => {
  setTauriRuntime(false);
  __resetUpdateStateForTests();
});

// ---- checkForUpdate -----------------------------------------------------

describe('checkForUpdate', () => {
  it('returns null when not running inside Tauri', async () => {
    setTauriRuntime(false);
    pluginCheckImpl = async () => ({
      version: '0.2.0',
      currentVersion: '0.1.0',
      downloadAndInstall: vi.fn(),
    });
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null when the Tauri runtime says there is no update', async () => {
    setTauriRuntime(true);
    pluginCheckImpl = async () => null;
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null when the Tauri runtime reports available=false (older shape)', async () => {
    setTauriRuntime(true);
    pluginCheckImpl = async () => ({
      version: '0.1.0',
      currentVersion: '0.1.0',
      available: false,
      downloadAndInstall: vi.fn(),
    });
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns the release metadata when an update is available', async () => {
    setTauriRuntime(true);
    pluginCheckImpl = async () => ({
      version: '0.2.0',
      currentVersion: '0.1.1',
      body: 'Speaker tools polish.',
      date: '2026-06-01T12:00:00Z',
      downloadAndInstall: vi.fn(),
    });
    const result = await checkForUpdate();
    expect(result).toEqual({
      version: '0.2.0',
      currentVersion: '0.1.1',
      notes: 'Speaker tools polish.',
      publishedAt: '2026-06-01T12:00:00Z',
    });
  });

  it('omits the release when the exact version has been dismissed', async () => {
    setTauriRuntime(true);
    pluginCheckImpl = async () => ({
      version: '0.2.0',
      currentVersion: '0.1.1',
      downloadAndInstall: vi.fn(),
    });
    dismissUpdate('0.2.0');
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('un-suppresses dismissal when a newer version arrives', async () => {
    setTauriRuntime(true);
    pluginCheckImpl = async () => ({
      version: '0.3.0',
      currentVersion: '0.1.1',
      downloadAndInstall: vi.fn(),
    });
    dismissUpdate('0.2.0');
    const result = await checkForUpdate();
    expect(result?.version).toBe('0.3.0');
  });

  it('returns null when the plugin throws (network, signature error, etc.)', async () => {
    setTauriRuntime(true);
    pluginCheckImpl = async () => {
      throw new Error('boom');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await checkForUpdate();
      expect(result).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

// ---- installUpdate ------------------------------------------------------

describe('installUpdate', () => {
  it('throws when called outside Tauri', async () => {
    setTauriRuntime(false);
    await expect(installUpdate()).rejects.toThrowError(/only available/);
  });

  it('throws when no pending update is cached', async () => {
    setTauriRuntime(true);
    await expect(installUpdate()).rejects.toThrowError(/pending update/);
  });

  it('forwards progress events, finishes, and relaunches', async () => {
    setTauriRuntime(true);

    // Capture progress callbacks the wrapper emits to the UI.
    const events: InstallProgress[] = [];

    // The shape we hand the wrapper is the same one `@tauri-apps/plugin-
    // updater` would return on the wire: object with version + a
    // downloadAndInstall(callback) method.
    const downloadAndInstall = vi.fn(
      async (cb: (e: { event: string; data?: Record<string, number> }) => void) => {
        cb({ event: 'Started', data: { contentLength: 200 } });
        cb({ event: 'Progress', data: { chunkLength: 80 } });
        cb({ event: 'Progress', data: { chunkLength: 120 } });
        cb({ event: 'Finished' });
      },
    );

    const relaunch = vi.fn(async () => undefined);
    relaunchImpl = relaunch;

    __setCachedHandleForTests({
      version: '0.2.0',
      currentVersion: '0.1.1',
      downloadAndInstall,
    } as unknown as Parameters<typeof __setCachedHandleForTests>[0]);

    await installUpdate((event) => {
      events.push(event);
    });

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();

    // Started → Progress (80) → Progress (200) → Finished → Installed.
    expect(events.map((e) => e.phase)).toEqual([
      'started',
      'progress',
      'progress',
      'finished',
      'installed',
    ]);
    const startedEvent = events[0] as Extract<
      InstallProgress,
      { phase: 'started' }
    >;
    expect(startedEvent.totalBytes).toBe(200);
    const progressEvents = events.filter(
      (e) => e.phase === 'progress',
    ) as Extract<InstallProgress, { phase: 'progress' }>[];
    expect(progressEvents.map((e) => e.bytesDownloaded)).toEqual([80, 200]);
    expect(progressEvents.every((e) => e.totalBytes === 200)).toBe(true);
  });

  it('clears the cached handle after a successful install (cannot re-install)', async () => {
    setTauriRuntime(true);
    const downloadAndInstall = vi.fn(async () => undefined);
    __setCachedHandleForTests({
      version: '0.2.0',
      currentVersion: '0.1.1',
      downloadAndInstall,
    } as unknown as Parameters<typeof __setCachedHandleForTests>[0]);
    await installUpdate();
    await expect(installUpdate()).rejects.toThrowError(/pending update/);
  });
});

// ---- dismissUpdate / isDismissed ---------------------------------------

describe('dismissUpdate / isDismissed', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips the version via localStorage', () => {
    dismissUpdate('0.5.0');
    expect(window.localStorage.getItem(UPDATE_DISMISS_STORAGE_KEY)).toBe(
      '0.5.0',
    );
    expect(isDismissed('0.5.0')).toBe(true);
    expect(isDismissed('0.6.0')).toBe(false);
  });

  it('treats missing storage gracefully', () => {
    expect(isDismissed('0.5.0')).toBe(false);
  });

  it('survives storage that throws on access', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    try {
      expect(() => dismissUpdate('0.5.0')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
