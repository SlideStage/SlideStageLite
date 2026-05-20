import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Internals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

const PRIMARY = {
  id: 0,
  name: 'Built-in Retina Display',
  width: 2880,
  height: 1864,
  x: 0,
  y: 0,
  scale_factor: 2,
  is_primary: true,
} as const;

const EXTERNAL_LEFT = {
  id: 1,
  name: 'BenQ PD3220U',
  width: 3840,
  height: 2160,
  x: -3840,
  y: 0,
  scale_factor: 2,
  is_primary: false,
} as const;

const EXTERNAL_RIGHT = {
  id: 2,
  name: 'LG UltraFine',
  width: 3840,
  height: 2160,
  x: 2880,
  y: 0,
  scale_factor: 2,
  is_primary: false,
} as const;

function installFakeInternals(handler: (cmd: string) => unknown): void {
  (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ = {
    invoke: vi.fn(async (cmd: string) => handler(cmd)),
  };
}

describe('monitors.defaultAudienceMonitor', () => {
  it('returns null on an empty list', async () => {
    const { defaultAudienceMonitor } = await import('@slidestage/lite-preset/desktop/monitors');
    expect(defaultAudienceMonitor([])).toBe(null);
  });

  it('prefers the first non-primary monitor', async () => {
    const { defaultAudienceMonitor } = await import('@slidestage/lite-preset/desktop/monitors');
    const picked = defaultAudienceMonitor([
      { ...PRIMARY, scaleFactor: PRIMARY.scale_factor, isPrimary: true },
      { ...EXTERNAL_RIGHT, scaleFactor: EXTERNAL_RIGHT.scale_factor, isPrimary: false },
    ]);
    expect(picked?.name).toBe('LG UltraFine');
  });

  it('falls back to the primary when only one monitor is attached', async () => {
    const { defaultAudienceMonitor } = await import('@slidestage/lite-preset/desktop/monitors');
    const picked = defaultAudienceMonitor([
      { ...PRIMARY, scaleFactor: PRIMARY.scale_factor, isPrimary: true },
    ]);
    expect(picked?.isPrimary).toBe(true);
  });
});

describe('monitors.listMonitors', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__;
  });

  it('reads from the Rust list_monitors command and normalizes the shape', async () => {
    installFakeInternals((cmd) => {
      if (cmd === 'list_monitors') return [PRIMARY, EXTERNAL_RIGHT];
      throw new Error(`unexpected ${cmd}`);
    });
    const { listMonitors } = await import('@slidestage/lite-preset/desktop/monitors');
    const result = await listMonitors();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ isPrimary: true, scaleFactor: 2 });
    expect(result[1]).toMatchObject({ isPrimary: false, name: 'LG UltraFine' });
  });

  it('sorts the primary first, then by x ascending so the picker reads left-to-right', async () => {
    installFakeInternals((cmd) => {
      if (cmd === 'list_monitors') return [EXTERNAL_RIGHT, PRIMARY, EXTERNAL_LEFT];
      throw new Error(`unexpected ${cmd}`);
    });
    const { listMonitors } = await import('@slidestage/lite-preset/desktop/monitors');
    const result = await listMonitors();
    expect(result.map((m) => m.id)).toEqual([0, 1, 2]);
  });

  it('returns an empty list if both transports fail to give anything', async () => {
    installFakeInternals((cmd) => {
      if (cmd === 'list_monitors') return [];
      if (cmd === 'plugin:window|available_monitors') return [];
      if (cmd === 'plugin:window|primary_monitor') return null;
      if (cmd.startsWith('plugin:window|')) return null;
      throw new Error(`unexpected ${cmd}`);
    });
    const { listMonitors } = await import('@slidestage/lite-preset/desktop/monitors');
    const result = await listMonitors();
    expect(result).toEqual([]);
  });
});
