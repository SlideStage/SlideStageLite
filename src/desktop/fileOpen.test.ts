import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * fileOpen is the front-end half of the .stage → File pipeline. The
 * Rust side surfaces three different "incoming file" channels (cold
 * argv, single-instance argv, macOS RunEvent::Opened) which we collapse
 * into two: an `opened` event with `string[]` payload and a back-compat
 * `deck:open` event with `string` payload.
 *
 * These tests pin down:
 *   1. cold-start drain via `opened_urls` + `pending_file`
 *   2. warm-path arrival via the `opened` and `deck:open` events
 *   3. macOS `file:///...` URLs get unwrapped before they hit
 *      `read_deck_bytes`, otherwise Rust complains the path doesn't
 *      exist.
 */

interface Internals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback?: (cb: (payload: unknown) => void) => number;
}

const FAKE_BYTES: number[] = [80, 75, 3, 4]; // valid zip header

interface FakeOptions {
  openedQueue?: string[];
  pendingQueue?: string[];
  onReadDeckBytes?: (path: string) => Promise<number[]>;
}

function installFakeInternals(opts: FakeOptions = {}): {
  emitOpened: (paths: string[]) => void;
  emitDeckOpen: (path: string) => void;
  invokeSpy: ReturnType<typeof vi.fn>;
} {
  const opened = [...(opts.openedQueue ?? [])];
  const pending = [...(opts.pendingQueue ?? [])];
  let nextCallbackId = 1;
  const callbacks = new Map<number, (payload: unknown) => void>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const invokeSpy = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'opened_urls') {
      const drained = [...opened];
      opened.length = 0;
      return drained;
    }
    if (cmd === 'pending_file') {
      return pending.length === 0 ? null : pending.shift() ?? null;
    }
    if (cmd === 'read_deck_bytes') {
      const path = (args as { path: string }).path;
      const fn = opts.onReadDeckBytes ?? (async () => FAKE_BYTES);
      return await fn(path);
    }
    if (cmd === 'plugin:event|listen') {
      const { event, handler } = args as unknown as {
        event: string;
        handler: number;
      };
      const cb = callbacks.get(handler);
      if (!cb) throw new Error(`unknown handler ${handler}`);
      const bucket = listeners.get(event) ?? new Set();
      const adapter = (payload: unknown): void => {
        cb({ payload, event, id: nextCallbackId++ });
      };
      bucket.add(adapter);
      listeners.set(event, bucket);
      return nextCallbackId++;
    }
    if (cmd === 'plugin:event|unlisten') return undefined;
    return undefined;
  });

  const internals: Internals = {
    invoke: invokeSpy as unknown as Internals['invoke'],
    transformCallback: (cb) => {
      const id = nextCallbackId++;
      callbacks.set(id, cb);
      return id;
    },
  };
  (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ = internals;
  // The event listen/unlisten path also touches a second global, whose
  // shape we widen to `unknown` because the real signature varies across
  // Tauri minor versions.
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (): void => {},
  };

  function emit(eventName: string, payload: unknown): void {
    for (const adapter of listeners.get(eventName) ?? new Set()) {
      adapter(payload);
    }
  }

  return {
    emitOpened: (paths) => emit('opened', paths),
    emitDeckOpen: (path) => emit('deck:open', path),
    invokeSpy,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('attachDesktopFileOpen', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    delete (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__;
    delete (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown })
      .__TAURI_EVENT_PLUGIN_INTERNALS__;
  });

  it('drains cold-start `opened_urls` queue on attach', async () => {
    installFakeInternals({ openedQueue: ['/tmp/cold.stage'] });
    const { attachDesktopFileOpen } = await import('@slidestage/lite-preset/desktop/fileOpen');
    const received: string[] = [];
    const handle = await attachDesktopFileOpen(async (file) => {
      received.push(file.name);
    });
    await flushMicrotasks();
    expect(received).toEqual(['cold.stage']);
    handle.unsubscribe();
  });

  it('drains legacy single-path `pending_file` for back-compat', async () => {
    installFakeInternals({ pendingQueue: ['/tmp/legacy.stage'] });
    const { attachDesktopFileOpen } = await import('@slidestage/lite-preset/desktop/fileOpen');
    const received: string[] = [];
    const handle = await attachDesktopFileOpen(async (file) => {
      received.push(file.name);
    });
    await flushMicrotasks();
    expect(received).toEqual(['legacy.stage']);
    handle.unsubscribe();
  });

  it('reacts to warm `opened` events that arrive after attach', async () => {
    const { emitOpened } = installFakeInternals();
    const { attachDesktopFileOpen } = await import('@slidestage/lite-preset/desktop/fileOpen');
    const received: string[] = [];
    const handle = await attachDesktopFileOpen(async (file) => {
      received.push(file.name);
    });
    await flushMicrotasks();
    emitOpened(['/tmp/warm.stage']);
    await flushMicrotasks();
    expect(received).toEqual(['warm.stage']);
    handle.unsubscribe();
  });

  it('still honours the legacy `deck:open` event name', async () => {
    const { emitDeckOpen } = installFakeInternals();
    const { attachDesktopFileOpen } = await import('@slidestage/lite-preset/desktop/fileOpen');
    const received: string[] = [];
    const handle = await attachDesktopFileOpen(async (file) => {
      received.push(file.name);
    });
    await flushMicrotasks();
    emitDeckOpen('/tmp/legacy-warm.stage');
    await flushMicrotasks();
    expect(received).toEqual(['legacy-warm.stage']);
    handle.unsubscribe();
  });

  it('strips file:// scheme so Rust gets a plain path', async () => {
    const seenPaths: string[] = [];
    const { emitOpened } = installFakeInternals({
      onReadDeckBytes: async (path) => {
        seenPaths.push(path);
        return FAKE_BYTES;
      },
    });
    const { attachDesktopFileOpen } = await import('@slidestage/lite-preset/desktop/fileOpen');
    const handle = await attachDesktopFileOpen(async () => {});
    await flushMicrotasks();
    emitOpened(['file:///Users/me/Decks/with%20space.stage']);
    await flushMicrotasks();
    expect(seenPaths).toEqual(['/Users/me/Decks/with space.stage']);
    handle.unsubscribe();
  });

  it('unsubscribe is idempotent and silent when called twice', async () => {
    installFakeInternals();
    const { attachDesktopFileOpen } = await import('@slidestage/lite-preset/desktop/fileOpen');
    const handle = await attachDesktopFileOpen(async () => {});
    expect(() => {
      handle.unsubscribe();
      handle.unsubscribe();
    }).not.toThrow();
  });
});
