import type { AudienceMessage } from '../usePresentationSync';

/**
 * A transport carries `AudienceMessage`s between the presenter window
 * and any audience windows opened for the same deck.
 *
 * We use this abstraction so the presenter sync logic does not have to
 * know whether it's running in:
 *   - a browser tab (Web build)        -> BroadcastChannel
 *   - a Tauri WebView (Desktop build)  -> Tauri Event API
 *   - jsdom under vitest               -> in-memory test double
 */
export interface SyncTransport {
  /** Publish a message to every subscriber on this channel (incl. self in BC; excluding in events). */
  postMessage(msg: AudienceMessage): void;
  /** Subscribe; returns an unsubscribe fn. Safe to call multiple times. */
  subscribe(handler: (msg: AudienceMessage) => void): () => void;
  /** Tear down the underlying resource. */
  close(): void;
}

export interface TransportFactory {
  /** Cheap check we can call at module init time. */
  isAvailable(): boolean;
  /** Create a transport bound to a logical channel name. */
  create(channelName: string): SyncTransport;
}
