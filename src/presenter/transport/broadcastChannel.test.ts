import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudienceMessage } from '@slidestage/ui/presenter/usePresentationSync';
import { broadcastChannelFactory } from '@slidestage/ui/presenter/transport/broadcastChannel';

describe('broadcastChannelFactory', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports availability based on the global BroadcastChannel constructor', () => {
    expect(broadcastChannelFactory.isAvailable()).toBe(true);
  });

  it('round-trips a message between two transports on the same channel', async () => {
    const channelName = `unit-${Math.random().toString(36).slice(2)}`;
    const a = broadcastChannelFactory.create(channelName);
    const b = broadcastChannelFactory.create(channelName);
    try {
      const received: AudienceMessage[] = [];
      const unsubscribe = b.subscribe((msg) => received.push(msg));

      a.postMessage({ type: 'hello', role: 'presenter' });
      // BroadcastChannel delivery is asynchronous; jsdom's implementation
      // routes the postMessage through a microtask + setTimeout pump, so a
      // single `await setTimeout(0)` is enough on most runs but flakes
      // when the worker thread is under load. Poll up to a few hundred
      // milliseconds — the message either arrives within one or two
      // event-loop turns or it never will.
      await vi.waitFor(() => expect(received).toHaveLength(1), {
        timeout: 500,
        interval: 5,
      });
      expect(received[0]).toEqual({ type: 'hello', role: 'presenter' });

      unsubscribe();
    } finally {
      a.close();
      b.close();
    }
  });

  it('ignores malformed payloads instead of crashing the subscriber', async () => {
    const channelName = `bad-${Math.random().toString(36).slice(2)}`;
    const a = broadcastChannelFactory.create(channelName);
    const b = broadcastChannelFactory.create(channelName);
    try {
      const received: AudienceMessage[] = [];
      b.subscribe((msg) => received.push(msg));

      // Bypass our typed wrapper to simulate a stray non-protocol message.
      const raw = (b as unknown as { postMessage: (m: unknown) => void });
      raw.postMessage('not-an-object');
      raw.postMessage({ noType: true });
      a.postMessage({ type: 'goodbye', role: 'audience' });
      await vi.waitFor(
        () =>
          expect(received).toEqual([{ type: 'goodbye', role: 'audience' }]),
        { timeout: 500, interval: 5 },
      );
    } finally {
      a.close();
      b.close();
    }
  });

  it('swallows postMessage after close instead of throwing', () => {
    const transport = broadcastChannelFactory.create('after-close');
    transport.close();
    expect(() => transport.postMessage({ type: 'hello', role: 'presenter' })).not.toThrow();
  });
});
