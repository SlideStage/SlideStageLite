import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitorInfo } from './monitors';

/**
 * `audienceWindow` is mostly an orchestration layer over the Tauri
 * WebviewWindow API. We mock the api surface and assert the right
 * lifecycle calls happen in the right order.
 */

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

type Listener = (event: { event: string }) => void | Promise<void>;

class FakeWebviewWindow {
  static instances: FakeWebviewWindow[] = [];
  static createdListeners: Set<Listener> = new Set();

  public setPosition = vi.fn(async () => {});
  public setSize = vi.fn(async () => {});
  public setFullscreen = vi.fn(async () => {});
  public setFocus = vi.fn(async () => {});
  public close = vi.fn(async () => {});

  constructor(public label: string, public options: Record<string, unknown>) {
    FakeWebviewWindow.instances.push(this);
    // Fire `tauri://created` asynchronously to mimic the real lifecycle.
    setTimeout(() => {
      for (const cb of this.createdListeners) {
        try {
          void cb({ event: 'tauri://created' });
        } catch {
          // ignore
        }
      }
    }, 0);
  }

  createdListeners: Set<Listener> = new Set();

  once(eventName: string, cb: Listener): Promise<() => void> {
    if (eventName === 'tauri://created') {
      this.createdListeners.add(cb);
    }
    return Promise.resolve(() => {});
  }
}

const FAKE_WINDOWS: FakeWebviewWindow[] = [];

vi.mock('@tauri-apps/api/webviewWindow', () => {
  return {
    WebviewWindow: FakeWebviewWindow,
    getAllWebviewWindows: async () => FAKE_WINDOWS,
  };
});

const SECONDARY: MonitorInfo = {
  id: 1,
  name: 'External 4K',
  width: 3840,
  height: 2160,
  x: 2880,
  y: 0,
  scaleFactor: 2,
  isPrimary: false,
};

describe('openAudienceWindow', () => {
  beforeEach(() => {
    vi.resetModules();
    FAKE_WINDOWS.length = 0;
    FakeWebviewWindow.instances.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a windowed audience for the picked monitor in fullscreen', async () => {
    const { openAudienceWindow } = await import('./audienceWindow');
    const fingerprint = 'abc123def';
    await openAudienceWindow(fingerprint, { monitor: SECONDARY, fullscreen: true });

    const created = FakeWebviewWindow.instances[0];
    expect(created.label).toBe(`audience-${fingerprint}`);
    expect(created.options.url).toBe(`/?audience=1&deck=${encodeURIComponent(fingerprint)}`);
    expect(created.setPosition).toHaveBeenCalledTimes(1);
    expect(created.setSize).toHaveBeenCalledTimes(1);
    expect(created.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('opens windowed (no fullscreen call) when fullscreen=false', async () => {
    const { openAudienceWindow } = await import('./audienceWindow');
    await openAudienceWindow('abc', { monitor: SECONDARY, fullscreen: false });
    const created = FakeWebviewWindow.instances[0];
    expect(created.setFullscreen).not.toHaveBeenCalled();
    expect(created.options.decorations).toBe(true);
  });

  it('focuses an existing audience window instead of creating a duplicate', async () => {
    const existing = new FakeWebviewWindow('audience-abc', {});
    FAKE_WINDOWS.push(existing);
    const before = FakeWebviewWindow.instances.length;

    const { openAudienceWindow } = await import('./audienceWindow');
    await openAudienceWindow('abc', { monitor: SECONDARY, fullscreen: true });

    expect(FakeWebviewWindow.instances.length).toBe(before);
    expect(existing.setFocus).toHaveBeenCalled();
    expect(existing.setFullscreen).toHaveBeenCalledWith(true);
  });
});

describe('setAudienceFullscreen / closeAudienceWindow', () => {
  beforeEach(() => {
    vi.resetModules();
    FAKE_WINDOWS.length = 0;
    FakeWebviewWindow.instances.length = 0;
  });

  it('toggles fullscreen on the matching window', async () => {
    const win = new FakeWebviewWindow('audience-xyz', {});
    FAKE_WINDOWS.push(win);
    const { setAudienceFullscreen } = await import('./audienceWindow');
    await setAudienceFullscreen('xyz', false);
    expect(win.setFullscreen).toHaveBeenCalledWith(false);
  });

  it('is a no-op when no audience window exists', async () => {
    const { setAudienceFullscreen, closeAudienceWindow } = await import('./audienceWindow');
    await expect(setAudienceFullscreen('missing', true)).resolves.toBeUndefined();
    await expect(closeAudienceWindow('missing')).resolves.toBeUndefined();
  });

  it('closes the matching window', async () => {
    const win = new FakeWebviewWindow('audience-xyz', {});
    FAKE_WINDOWS.push(win);
    const { closeAudienceWindow } = await import('./audienceWindow');
    await closeAudienceWindow('xyz');
    expect(win.close).toHaveBeenCalled();
  });
});
