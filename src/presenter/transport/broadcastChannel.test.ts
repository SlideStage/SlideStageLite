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
      // BroadcastChannel delivery is async; flush microtasks + a tick.
      await new Promise((r) => setTimeout(r, 0));

      expect(received).toHaveLength(1);
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
      await new Promise((r) => setTimeout(r, 0));

      expect(received).toEqual([{ type: 'goodbye', role: 'audience' }]);
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
