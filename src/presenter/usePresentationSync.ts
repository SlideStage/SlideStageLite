import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LoadedDeck, Manifest } from '../deck/types';
import { pickTransport, type SyncTransport } from './transport';
import type { Point, PresenterState, Stroke, Tool } from './types';

export type AudienceRole = 'presenter' | 'audience';

export interface AudiencePointer {
  tool: 'laser' | 'spotlight';
  point: Point;
}

export interface AudiencePresentationState {
  currentIndex: number;
  tool: Tool;
  strokesByIdx: Record<number, Stroke[]>;
  spotlightRadius: number;
  pointer: AudiencePointer | null;
}

export type SerializedAudienceDeck = Pick<
  LoadedDeck,
  'fileName' | 'fingerprint' | 'manifest' | 'slideUrls' | 'slideHtml' | 'thumbnailUrls'
>;

export interface AudienceSnapshot {
  deck: SerializedAudienceDeck;
  presentation: AudiencePresentationState;
}

export type AudienceMessage =
  | { type: 'hello'; role: AudienceRole }
  | { type: 'goodbye'; role: AudienceRole }
  | { type: 'request-snapshot' }
  | { type: 'snapshot'; snapshot: AudienceSnapshot }
  | { type: 'presentation'; presentation: AudiencePresentationState };

export const DEFAULT_AUDIENCE_CHANNEL = 'hcslides-lite-audience';

export function presentationChannelName(deckFingerprint?: string | null): string {
  if (!deckFingerprint) return DEFAULT_AUDIENCE_CHANNEL;
  return `${DEFAULT_AUDIENCE_CHANNEL}::${deckFingerprint}`;
}

export function makeAudiencePresentation(
  currentIndex: number,
  presenterState: PresenterState,
  pointer: AudiencePointer | null,
): AudiencePresentationState {
  return {
    currentIndex,
    tool: presenterState.tool,
    strokesByIdx: presenterState.strokesByIdx,
    spotlightRadius: presenterState.spotlightRadius,
    pointer,
  };
}

export function serializeAudienceDeck(deck: LoadedDeck): SerializedAudienceDeck {
  return {
    fileName: deck.fileName,
    fingerprint: deck.fingerprint,
    manifest: deck.manifest,
    // We must ship `slideHtml` alongside `slideUrls` because the desktop
    // audience window cannot navigate to a blob URL that was minted in
    // the presenter window's origin context — it has to render the
    // slide via srcdoc instead.
    slideUrls: deck.slideUrls,
    slideHtml: deck.slideHtml,
    thumbnailUrls: deck.thumbnailUrls,
  };
}

export function deserializeAudienceDeck(snapshot: AudienceSnapshot): LoadedDeck {
  return {
    ...snapshot.deck,
    manifest: snapshot.deck.manifest as Manifest,
    revoke: () => {},
  };
}

export interface PresentationSyncApi {
  send: (msg: AudienceMessage) => void;
  available: boolean;
}

export interface UsePresentationSyncOptions {
  deckFingerprint?: string | null;
  role: AudienceRole;
  onMessage?: (msg: AudienceMessage) => void;
  enabled?: boolean;
}

export function usePresentationSync(opts: UsePresentationSyncOptions): PresentationSyncApi {
  const { deckFingerprint, role, onMessage, enabled = true } = opts;

  const handlerRef = useRef<typeof onMessage>(onMessage);
  handlerRef.current = onMessage;

  const transportRef = useRef<SyncTransport | null>(null);
  // We resolve the factory once per render and use *its* `isAvailable()`
  // result for the `available` flag, so a missing BroadcastChannel in
  // jsdom (or a non-Tauri WebView with no event API) degrades cleanly.
  const factory = useMemo(() => (enabled ? pickTransport() : null), [enabled]);
  const available = factory !== null;

  useEffect(() => {
    if (!factory) return;
    const transport = factory.create(presentationChannelName(deckFingerprint));
    transportRef.current = transport;

    const unsubscribe = transport.subscribe((data) => {
      handlerRef.current?.(data);
    });

    transport.postMessage({ type: 'hello', role });

    const sayGoodbye = (): void => {
      try {
        transport.postMessage({ type: 'goodbye', role });
      } catch {
        // Transport may already be tearing down during unload.
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', sayGoodbye);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', sayGoodbye);
      }
      sayGoodbye();
      unsubscribe();
      transport.close();
      transportRef.current = null;
    };
  }, [factory, deckFingerprint, role]);

  const send = useCallback((msg: AudienceMessage) => {
    transportRef.current?.postMessage(msg);
  }, []);

  return useMemo(() => ({ send, available }), [send, available]);
}
