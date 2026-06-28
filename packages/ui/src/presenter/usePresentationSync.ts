import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LoadedDeck, Manifest } from '@slidestage/core/deck/types';
import { pickTransport, type SyncTransport } from './transport';
import {
  parseForwardedInputEvent,
  parseSlideRuntimeState,
  type ForwardedInputEvent,
  type SlideRuntimeState,
} from './slideRuntime';
import type { Point, PresenterState, Stroke, Tool } from './types';

export type { ForwardedInputEvent, SlideRuntimeState } from './slideRuntime';

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
  /**
   * In-slide step/animation state reported by the active slide's runtime
   * agent. Lets the audience iframe be driven to the same fragment/step
   * the presenter is on. Optional + nullable so snapshots from older
   * presenters (or slides without a step model) round-trip cleanly.
   */
  runtime?: SlideRuntimeState | null;
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
}

export type AudienceMessage =
  | { type: 'hello'; role: AudienceRole }
  | { type: 'goodbye'; role: AudienceRole }
  | { type: 'request-snapshot' }
  | { type: 'snapshot'; snapshot: AudienceSnapshot }
  | { type: 'presentation'; presentation: AudiencePresentationState }
  // Transient best-effort (A+) interaction forwarded presenter → audience
  // for slides that have no step model. Not part of the retained snapshot
  // — replaying a stale click on reconnect would be wrong.
  | { type: 'input-event'; event: ForwardedInputEvent };

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

const AUDIENCE_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'mouse',
  'laser',
  'pen',
  'highlighter',
  'eraser',
  'spotlight',
  'blackout',
  'whiteout',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is Point {
  return isPlainObject(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isAudiencePresentationState(value: unknown): value is AudiencePresentationState {
  if (!isPlainObject(value)) return false;
  if (typeof value.currentIndex !== 'number' || !Number.isFinite(value.currentIndex)) return false;
  if (typeof value.tool !== 'string' || !AUDIENCE_TOOLS.has(value.tool as Tool)) return false;
  if (typeof value.spotlightRadius !== 'number' || !Number.isFinite(value.spotlightRadius)) {
    return false;
  }
  if (!isPlainObject(value.strokesByIdx)) return false;
  const pointer = value.pointer;
  if (pointer !== null) {
    if (!isPlainObject(pointer)) return false;
    if (pointer.tool !== 'laser' && pointer.tool !== 'spotlight') return false;
    if (!isPoint(pointer.point)) return false;
  }
  // `runtime` is optional + nullable; when present it must be a valid
  // SlideRuntimeState so a forged payload can't drive the iframe agent.
  if (value.runtime !== undefined && value.runtime !== null) {
    if (parseSlideRuntimeState(value.runtime) === null) return false;
  }
  return true;
}

function isSerializedAudienceDeck(value: unknown): value is SerializedAudienceDeck {
  if (!isPlainObject(value)) return false;
  if (typeof value.fingerprint !== 'string') return false;
  if (!Array.isArray(value.slideUrls)) return false;
  if (!Array.isArray(value.slideHtml)) return false;
  if (!Array.isArray(value.thumbnailUrls)) return false;
  const manifest = value.manifest;
  if (!isPlainObject(manifest)) return false;
  if (!isPlainObject(manifest.dimensions)) return false;
  if (
    typeof manifest.dimensions.width !== 'number' ||
    typeof manifest.dimensions.height !== 'number'
  ) {
    return false;
  }
  if (!Array.isArray(manifest.slides)) return false;
  return true;
}

/**
 * Validate an inbound sync-channel payload before any consumer acts on it.
 *
 * The presentation sync channel (BroadcastChannel / Tauri event) is
 * same-origin and unauthenticated: any script that can post to it could
 * forge messages (DSS-CAND-012). The privilege-bearing field is already
 * gone — the audience derives its iframe sandbox locally from its own
 * trust store rather than trusting the presenter — but we still reject
 * structurally invalid messages here so a forged or corrupt payload can't
 * crash the audience renderer or inject nonsense presentation state.
 */
export function parseAudienceMessage(data: unknown): AudienceMessage | null {
  if (!isPlainObject(data)) return null;
  switch (data.type) {
    case 'hello':
    case 'goodbye':
      return data.role === 'presenter' || data.role === 'audience'
        ? ({ type: data.type, role: data.role } as AudienceMessage)
        : null;
    case 'request-snapshot':
      return { type: 'request-snapshot' };
    case 'presentation':
      return isAudiencePresentationState(data.presentation)
        ? { type: 'presentation', presentation: data.presentation }
        : null;
    case 'input-event': {
      const event = parseForwardedInputEvent(data.event);
      return event ? { type: 'input-event', event } : null;
    }
    case 'snapshot': {
      const snapshot = data.snapshot;
      if (!isPlainObject(snapshot)) return null;
      if (!isSerializedAudienceDeck(snapshot.deck)) return null;
      if (!isAudiencePresentationState(snapshot.presentation)) return null;
      return {
        type: 'snapshot',
        snapshot: { deck: snapshot.deck, presentation: snapshot.presentation },
      };
    }
    default:
      return null;
  }
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
      // Reject forged / malformed payloads before any consumer reacts.
      const message = parseAudienceMessage(data as unknown);
      if (!message) return;
      handlerRef.current?.(message);
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
