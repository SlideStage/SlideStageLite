import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Internals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback?: (cb: (payload: unknown) => void) => number;
}

/**
 * The global-shortcut plugin serialises its handler as a `Channel`
 * instance. We faithfully implement just enough of the Tauri 2 Channel
 * protocol to surface a way to drive the registered shortcut handlers
 * from these tests:
 *
 *   1. `transformCallback(cb)` returns a numeric channel id and stores
 *      the callback locally.
 *   2. A Channel `h` registered against `id` will surface messages as
 *      `cb({ message, index })`. Calling the message-pump function we
 *      hand back to the test pretends a real key was pressed.
 *
 * The plugin's `register` command receives an object `{ shortcuts,
 * handler }` where `handler` is the Channel instance (object with `id`
 * + `onmessage` getters). Real Tauri detects the Channel and forwards
 * the id over IPC; here we just read `handler.id` directly.
 */
interface ShortcutEvent {
  state: 'Pressed' | 'Released';
  shortcut: string;
}

interface RegisteredHandler {
  shortcuts: string[];
  pump: (event: ShortcutEvent) => void;
}

function installFakeInternals(out: {
  registered: RegisteredHandler[];
  unregisteredAll: number;
}): void {
  let nextId = 1;
  const callbacks = new Map<number, (payload: unknown) => void>();

  const invokeSpy = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'plugin:global-shortcut|register') {
      const { shortcuts, handler } = args as unknown as {
        shortcuts: string[];
        handler: { id: number };
      };
      const cb = callbacks.get(handler.id);
      if (!cb) throw new Error(`unknown channel id ${handler.id}`);
      let nextIndex = 0;
      out.registered.push({
        shortcuts,
        pump: (event) => {
          cb({ message: event, index: nextIndex });
          nextIndex += 1;
        },
      });
      return undefined;
    }
    if (cmd === 'plugin:global-shortcut|unregister_all') {
      out.unregisteredAll += 1;
      return undefined;
    }
    return undefined;
  });

  const internals: Internals = {
    invoke: invokeSpy as unknown as Internals['invoke'],
    transformCallback: (cb) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
  };
  (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ = internals;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('registerPresentationShortcuts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__;
  });

  it('registers the canonical presentation key set', async () => {
    const out = { registered: [] as RegisteredHandler[], unregisteredAll: 0 };
    installFakeInternals(out);
    const { registerPresentationShortcuts } = await import(
      '@slidestage/lite-preset/desktop/globalShortcuts'
    );

    const handle = await registerPresentationShortcuts(() => {});
    await flushMicrotasks();

    const flat = out.registered.flatMap((r) => r.shortcuts);
    expect(flat).toEqual(
      expect.arrayContaining(['Right', 'Left', 'PageDown', 'PageUp', 'Space', 'B', 'Escape']),
    );

    await handle.unregister();
    expect(out.unregisteredAll).toBeGreaterThanOrEqual(1);
  });

  it('only fires the action callback on Pressed events', async () => {
    const out = { registered: [] as RegisteredHandler[], unregisteredAll: 0 };
    installFakeInternals(out);
    const { registerPresentationShortcuts } = await import(
      '@slidestage/lite-preset/desktop/globalShortcuts'
    );

    const seen: string[] = [];
    const handle = await registerPresentationShortcuts((action) => seen.push(action));
    await flushMicrotasks();

    const rightArrow = out.registered.find((r) => r.shortcuts.includes('Right'));
    expect(rightArrow).toBeTruthy();
    rightArrow!.pump({ state: 'Released', shortcut: 'Right' });
    rightArrow!.pump({ state: 'Pressed', shortcut: 'Right' });

    expect(seen).toEqual(['next-slide']);
    await handle.unregister();
  });
});
