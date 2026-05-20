import { afterEach, describe, expect, it } from 'vitest';
import {
  pickTransport,
  broadcastChannelFactory,
  tauriEventFactory,
} from '@slidestage/ui/presenter/transport';

describe('pickTransport', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('prefers the Tauri event transport when the Tauri internals global is present', () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(pickTransport()).toBe(tauriEventFactory);
  });

  it('falls back to the BroadcastChannel transport in a plain browser', () => {
    expect(pickTransport()).toBe(broadcastChannelFactory);
  });
});
