import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  parseAgentMessage,
  STAGE_HOST_SOURCE,
  type ForwardedInputEvent,
  type SelectionRect,
  type SlideRuntimeState,
} from './slideRuntime';

export type SlideBridgeRole = 'presenter' | 'audience';

export interface UseSlideBridgeOptions {
  role: SlideBridgeRole;
  /**
   * Container that holds the active slide iframe (the iframe carries
   * `data-active="true"`). The hook re-acquires the active iframe's
   * window whenever {@link currentIndex} changes.
   */
  hostRef: RefObject<HTMLElement | null>;
  /** Active slide index; changing it re-acquires the iframe window. */
  currentIndex: number;
  /**
   * Extra key that also forces re-acquisition of the iframe window — e.g.
   * the deck fingerprint, so the bridge re-attaches when a deck first
   * mounts or is swapped without the slide index changing.
   */
  reacquireKey?: string | number | null;
  enabled?: boolean;
  /** Presenter only: forward click/scroll for slides without a step model. */
  forwardEvents?: boolean;
  /** Presenter only: called when the slide agent reports new step state. */
  onRuntimeReport?: (runtime: SlideRuntimeState) => void;
  /** Presenter only: called when the slide agent forwards an interaction. */
  onInputEvent?: (event: ForwardedInputEvent) => void;
  /**
   * Presenter only: called when the slide agent reports the current text
   * selection (rects in deck logical px). An empty array means the
   * selection was cleared.
   */
  onSelection?: (rects: SelectionRect[]) => void;
  /** Audience only: the step state to drive the iframe to. */
  targetRuntime?: SlideRuntimeState | null;
}

export interface SlideBridgeApi {
  /** Presenter: ask the active slide to advance / retreat one step. */
  sendStep: (action: 'next' | 'prev') => void;
  /** Audience: replay a forwarded interaction in the active slide. */
  replayInputEvent: (event: ForwardedInputEvent) => void;
}

/**
 * Host-side half of the in-iframe runtime bridge. Talks to the agent
 * injected into each slide (`@slidestage/core/deck/runtimeAgent`) over
 * postMessage. Works under an `allow-scripts`-only sandbox; never relies
 * on same-origin DOM access to the slide.
 *
 * - Acquires the active iframe's `contentWindow` on mount and on slide
 *   change (with a short retry while the frame attaches).
 * - Validates every inbound message and only accepts the active iframe as
 *   the sender (mirrors the thumbnail-capture hardening pattern).
 * - Presenter: surfaces step reports + forwarded interactions; can drive
 *   steps. Audience: pushes the target step state and replays input.
 */
export function useSlideBridge(opts: UseSlideBridgeOptions): SlideBridgeApi {
  const {
    role,
    hostRef,
    currentIndex,
    reacquireKey = null,
    enabled = true,
    forwardEvents = false,
    onRuntimeReport,
    onInputEvent,
    onSelection,
    targetRuntime = null,
  } = opts;

  const activeWinRef = useRef<Window | null>(null);
  const roleRef = useRef(role);
  roleRef.current = role;
  const forwardRef = useRef(forwardEvents);
  forwardRef.current = forwardEvents;
  const onRuntimeReportRef = useRef(onRuntimeReport);
  onRuntimeReportRef.current = onRuntimeReport;
  const onInputEventRef = useRef(onInputEvent);
  onInputEventRef.current = onInputEvent;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const targetRuntimeRef = useRef<SlideRuntimeState | null>(targetRuntime);
  targetRuntimeRef.current = targetRuntime;

  const sendInit = useCallback((win: Window) => {
    try {
      win.postMessage(
        { source: STAGE_HOST_SOURCE, type: 'init', role: roleRef.current, forwardEvents: forwardRef.current },
        '*',
      );
    } catch {
      // Window may be navigating / closed.
    }
    if (roleRef.current === 'audience' && targetRuntimeRef.current) {
      try {
        win.postMessage(
          { source: STAGE_HOST_SOURCE, type: 'goto', runtime: targetRuntimeRef.current },
          '*',
        );
      } catch {
        // ignore
      }
    }
  }, []);

  // Inbound: only accept messages from the active iframe window.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const handler = (event: MessageEvent): void => {
      const win = activeWinRef.current;
      if (!win || event.source !== win) return;
      const msg = parseAgentMessage(event.data);
      if (!msg) return;
      if (msg.type === 'ready') {
        sendInit(win);
        return;
      }
      if (roleRef.current !== 'presenter') return;
      if (msg.type === 'runtime') {
        onRuntimeReportRef.current?.(msg.runtime);
      } else if (msg.type === 'input') {
        onInputEventRef.current?.(msg.event);
      } else if (msg.type === 'selection') {
        onSelectionRef.current?.(msg.rects);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [enabled, sendInit]);

  // Acquire the active iframe window on slide change. The frame may not
  // be attached synchronously, so retry briefly. We also proactively
  // send `init` to cover already-loaded iframes whose agent posted
  // `ready` before we started listening.
  useEffect(() => {
    if (!enabled) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let tries = 0;
    const acquire = (): void => {
      if (cancelled) return;
      const iframe = host.querySelector(
        'iframe[data-active="true"]',
      ) as HTMLIFrameElement | null;
      const win = iframe?.contentWindow ?? null;
      if (win) {
        activeWinRef.current = win;
        sendInit(win);
        return;
      }
      if (tries < 20) {
        tries += 1;
        window.setTimeout(acquire, 50);
      }
    };
    acquire();
    return () => {
      cancelled = true;
    };
  }, [enabled, currentIndex, reacquireKey, hostRef, sendInit]);

  // Audience: push the target step whenever it changes (covers in-slide
  // step changes that do not change the slide index).
  useEffect(() => {
    if (!enabled || role !== 'audience') return;
    const win = activeWinRef.current;
    if (!win || !targetRuntime) return;
    try {
      win.postMessage({ source: STAGE_HOST_SOURCE, type: 'goto', runtime: targetRuntime }, '*');
    } catch {
      // ignore
    }
  }, [enabled, role, targetRuntime, currentIndex]);

  const sendStep = useCallback((action: 'next' | 'prev') => {
    const win = activeWinRef.current;
    if (!win) return;
    try {
      win.postMessage({ source: STAGE_HOST_SOURCE, type: 'step', action }, '*');
    } catch {
      // ignore
    }
  }, []);

  const replayInputEvent = useCallback((event: ForwardedInputEvent) => {
    const win = activeWinRef.current;
    if (!win) return;
    try {
      win.postMessage({ source: STAGE_HOST_SOURCE, type: 'replay', event }, '*');
    } catch {
      // ignore
    }
  }, []);

  return useMemo(() => ({ sendStep, replayInputEvent }), [sendStep, replayInputEvent]);
}
