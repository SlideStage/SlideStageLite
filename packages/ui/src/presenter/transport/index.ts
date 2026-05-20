import { broadcastChannelFactory } from './broadcastChannel';
import { tauriEventFactory } from './tauriEvent';
import type { SyncTransport, TransportFactory } from './types';

export type { SyncTransport, TransportFactory };

/**
 * Pick the best available transport for the current runtime.
 *
 * Preference order:
 *   1. Tauri events (desktop): more reliable across native windows
 *      than BroadcastChannel which is "best effort" in WKWebView.
 *   2. BroadcastChannel (browser): the pre-desktop Lite codepath.
 *   3. `null` — caller should treat the channel as unavailable
 *      (e.g. jsdom test that doesn't poly-fill BroadcastChannel and
 *      isn't running under Tauri).
 */
export function pickTransport(): TransportFactory | null {
  if (tauriEventFactory.isAvailable()) return tauriEventFactory;
  if (broadcastChannelFactory.isAvailable()) return broadcastChannelFactory;
  return null;
}

export { broadcastChannelFactory, tauriEventFactory };
