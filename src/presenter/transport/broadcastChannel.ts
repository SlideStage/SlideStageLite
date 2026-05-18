import type { AudienceMessage } from '../usePresentationSync';
import type { SyncTransport, TransportFactory } from './types';

/**
 * Web-build transport: routes messages between same-origin browsing
 * contexts via the BroadcastChannel API. This is the original codepath
 * preserved verbatim from the pre-desktop Lite.
 */
export const broadcastChannelFactory: TransportFactory = {
  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined';
  },
  create(channelName: string): SyncTransport {
    const channel = new BroadcastChannel(channelName);
    let closed = false;

    return {
      postMessage(msg: AudienceMessage): void {
        if (closed) return;
        try {
          channel.postMessage(msg);
        } catch {
          // Closed channels throw — swallow so callers never crash on unload.
        }
      },
      subscribe(handler): () => void {
        const listener = (event: MessageEvent<AudienceMessage>): void => {
          const data = event.data;
          if (!data || typeof data !== 'object' || !('type' in data)) return;
          handler(data);
        };
        channel.addEventListener('message', listener);
        return () => channel.removeEventListener('message', listener);
      },
      close(): void {
        if (closed) return;
        closed = true;
        try {
          channel.close();
        } catch {
          // Already closed by browser unload.
        }
      },
    };
  },
};
