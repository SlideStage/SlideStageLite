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
  | 'fileName'
  | 'fingerprint'
  | 'deckId'
  | 'manifest'
  | 'slideUrls'
  | 'slideHtml'
  | 'thumbnailUrls'
  | 'prefersSrcdoc'
  // Required so the audience window can apply the same srcdoc-vs-src
  // decision as the presenter. Without `inlinedHtmlAvailable` the
  // audience falls back to `undefined` (falsy) which forces `src` even
  // for small decks that *should* render via srcdoc — and the audience
  // iframe sandbox lacks `allow-same-origin` for untrusted decks, so
  // the SW never intercepts and the slide ends up 404'd.
  | 'inlinedHtmlAvailable'
  | 'totalAssetBytes'
>;

export interface AudienceSnapshot {
  deck: SerializedAudienceDeck;
  presentation: AudiencePresentationState;
  /**
   * Sandbox token string the presenter is using for its own iframe.
   * The audience MUST mirror this — otherwise auto-elevated decks
   * (where the App layer silently granted `same-origin-storage` to
   * dodge the OOM path) end up with an opaque-origin audience iframe
   * that the Service Worker can't intercept, yielding an empty
   * window. Optional only so older clients that didn't ship this
   * field still produce a parseable snapshot.
   */
  iframeSandbox?: string;
}

export type AudienceMessage =
  | { type: 'hello'; role: AudienceRole }
  | { type: 'goodbye'; role: AudienceRole }
  | { type: 'request-snapshot' }
  | { type: 'snapshot'; snapshot: AudienceSnapshot }
  | { type: 'presentation'; presentation: AudiencePresentationState };

export const DEFAULT_AUDIENCE_CHANNEL = 'slidestage-lite-audience';

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
    deckId: deck.deckId,
    manifest: deck.manifest,
    // We ship both flavors so the audience renderer can match the
    // presenter's choice:
    //   - `slideUrls` are same-origin virtual URLs when a Service
    //     Worker hosts the deck (both presenter and audience tabs
    //     share the same SW under the same origin, so the URLs Just
    //     Work in the audience window too).
    //   - `slideHtml` carries the self-contained data-URL flavor used
    //     when `prefersSrcdoc` is true (Tauri WKWebView and
    //     service-worker-unavailable Web hosts).
    slideUrls: deck.slideUrls,
    slideHtml: deck.slideHtml,
    thumbnailUrls: deck.thumbnailUrls,
    prefersSrcdoc: deck.prefersSrcdoc,
    // Must travel with the snapshot so the audience window picks the
    // same src-vs-srcdoc strategy as the presenter. See type above.
    inlinedHtmlAvailable: deck.inlinedHtmlAvailable,
    totalAssetBytes: deck.totalAssetBytes,
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
