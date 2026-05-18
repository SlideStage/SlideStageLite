import type { AudienceMessage } from '../usePresentationSync';
import type { SyncTransport, TransportFactory } from './types';

/**
 * Desktop-build transport: routes messages between Tauri WebView
 * windows via the Tauri Event API.
 *
 * IMPORTANT: Tauri events do NOT echo back to the sender. The presenter
 * sync hook relies on that (it has its own `handlerRef` for local
 * state). BroadcastChannel has the same behavior for messages posted
 * *within* the same tab (different listener), so the abstraction is
 * already write-once-deliver-others.
 *
 * We keep `import('@tauri-apps/api/event')` *dynamic* inside `create()`
 * so the Web bundle never bundles the Tauri JS client.
 */
export const tauriEventFactory: TransportFactory = {
  isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown })
    );
  },
  create(channelName: string): SyncTransport {
    const eventName = `hcslides:${channelName}`;
    let unlistenP: Promise<() => void> | null = null;
    let closed = false;

    return {
      postMessage(msg: AudienceMessage): void {
        if (closed) return;
        void import('@tauri-apps/api/event').then(({ emit }) => {
          if (closed) return;
          return emit(eventName, msg);
        });
      },
      subscribe(handler): () => void {
        unlistenP = import('@tauri-apps/api/event').then(({ listen }) =>
          listen<AudienceMessage>(eventName, (event) => {
            const data = event.payload;
            if (!data || typeof data !== 'object' || !('type' in data)) return;
            handler(data);
          }),
        );
        return () => {
          unlistenP?.then((u) => u()).catch(() => {});
        };
      },
      close(): void {
        if (closed) return;
        closed = true;
        unlistenP?.then((u) => u()).catch(() => {});
      },
    };
  },
};
