import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudienceMessage } from '../usePresentationSync';

/**
 * Strategy: instead of mocking `@tauri-apps/api/event` itself (the real
 * implementation calls into `core.invoke` which we cannot easily
 * stand in for), we install a fake `__TAURI_INTERNALS__.invoke` that
 * implements just enough of the `plugin:event|emit` and
 * `plugin:event|listen` protocol to make event round-trips observable.
 *
 * This is closer to integration-level testing of the transport while
 * staying inside jsdom + vitest.
 */

interface ListenArgs {
  event: string;
  target: { kind: string; label?: string };
  handler: number; // channel id -> our fake just calls listenersById[id]
}

interface EventCallbackPayload {
  payload: AudienceMessage;
  event: string;
  id: number;
}

type Internals = {
  invoke: (
    cmd: string,
    args: Record<string, unknown>,
    options?: unknown,
  ) => Promise<unknown>;
  transformCallback?: (cb: (payload: EventCallbackPayload) => void) => number;
  callbacks?: Map<number, (payload: EventCallbackPayload) => void>;
};

function installFakeInternals(): {
  internals: Internals;
  listeners: Map<string, Set<(msg: AudienceMessage) => void>>;
  invokeSpy: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Set<(msg: AudienceMessage) => void>>();
  const callbacks = new Map<number, (payload: EventCallbackPayload) => void>();
  let nextCallbackId = 1;

  const invokeSpy = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'plugin:event|listen') {
      const { event, handler } = args as unknown as ListenArgs;
      const cb = callbacks.get(handler);
      if (!cb) throw new Error(`listen called with unknown handler id ${handler}`);

      const bucket = listeners.get(event) ?? new Set();
      const adapter = (msg: AudienceMessage): void => {
        cb({ payload: msg, event, id: nextCallbackId++ });
      };
      bucket.add(adapter);
      listeners.set(event, bucket);
      // Tauri returns the listen id, used to call `plugin:event|unlisten`.
      return nextCallbackId++;
    }
    if (cmd === 'plugin:event|emit') {
      const { event, payload } = args as { event: string; payload: AudienceMessage };
      for (const adapter of listeners.get(event) ?? new Set()) adapter(payload);
      return undefined;
    }
    if (cmd === 'plugin:event|emit_to') {
      const { event, payload } = args as { event: string; payload: AudienceMessage };
      for (const adapter of listeners.get(event) ?? new Set()) adapter(payload);
      return undefined;
    }
    if (cmd === 'plugin:event|unlisten') {
      return undefined;
    }
    throw new Error(`unhandled command in fake: ${cmd}`);
  });

  const internals: Internals = {
    invoke: invokeSpy as unknown as Internals['invoke'],
    transformCallback: (cb) => {
      const id = nextCallbackId++;
      callbacks.set(id, cb);
      return id;
    },
    callbacks,
  };

  (window as Window & { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ = internals;
  return { internals, listeners, invokeSpy };
}

async function flushMicrotasks(): Promise<void> {
  // Tauri's emit/listen are dynamic-imported, then call `core.invoke`,
  // which itself awaits multiple ticks for the channel handshake. Plain
  // Promise.resolve flushes are not enough; we yield to the macrotask
  // queue to give the whole import + invoke chain time to settle.
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('tauriEventFactory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    // Drain any pending fire-and-forget emits before pulling
    // __TAURI_INTERNALS__ out from under them — otherwise the leftover
    // invoke() calls turn into noisy unhandled rejections that fail the
    // suite even when each assertion passed.
    await new Promise((r) => setTimeout(r, 0));
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('reports unavailable until the Tauri internals global is present', async () => {
    const { tauriEventFactory } = await import('./tauriEvent');
    expect(tauriEventFactory.isAvailable()).toBe(false);

    installFakeInternals();
    expect(tauriEventFactory.isAvailable()).toBe(true);
  });

  it('namespaces the event channel under hcslides: and round-trips messages', async () => {
    const { invokeSpy } = installFakeInternals();
    const { tauriEventFactory } = await import('./tauriEvent');

    const a = tauriEventFactory.create('alpha');
    const b = tauriEventFactory.create('alpha');
    const received: AudienceMessage[] = [];
    b.subscribe((msg) => received.push(msg));

    await flushMicrotasks();
    a.postMessage({ type: 'hello', role: 'presenter' });
    await flushMicrotasks();

    const emitCalls = invokeSpy.mock.calls.filter((c) =>
      String(c[0]).endsWith('|emit') || String(c[0]).endsWith('|emit_to'),
    );
    expect(emitCalls.some((c) => (c[1] as { event: string }).event === 'hcslides:alpha')).toBe(true);

    expect(received).toEqual([{ type: 'hello', role: 'presenter' }]);

    a.close();
    b.close();
  });

  it('skips emit after close so unmount during a flush is safe', async () => {
    const { invokeSpy } = installFakeInternals();
    const { tauriEventFactory } = await import('./tauriEvent');

    const t = tauriEventFactory.create('beta');
    t.close();
    t.postMessage({ type: 'goodbye', role: 'audience' });
    await flushMicrotasks();

    const emitCalls = invokeSpy.mock.calls.filter((c) =>
      String(c[0]).endsWith('|emit') || String(c[0]).endsWith('|emit_to'),
    );
    expect(emitCalls).toHaveLength(0);
  });
});
