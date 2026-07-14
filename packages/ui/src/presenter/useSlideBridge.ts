import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  parseAgentMessage,
  STAGE_HOST_SOURCE,
  type ForwardedInputEvent,
  type SelectionRect,
  type SlideEdit,
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
   * the LoadedDeck object identity, so the bridge re-attaches when a deck
   * first mounts, is swapped, or is silently reloaded (same fingerprint,
   * fresh iframes) without the slide index changing.
   */
  reacquireKey?: unknown;
  enabled?: boolean;
  /** Presenter only: forward click/scroll for slides without a step model. */
  forwardEvents?: boolean;
  /**
   * Presenter only: turn the in-slide text edit mode on/off. Sent with
   * `init` (so freshly navigated slides inherit the mode) and pushed as
   * an `edit-mode` command when it changes on an attached slide.
   */
  editMode?: boolean;
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
  /** Presenter only: called when the slide agent commits a text edit. */
  onEdit?: (edit: SlideEdit) => void;
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
    editMode = false,
    onRuntimeReport,
    onInputEvent,
    onSelection,
    onEdit,
    targetRuntime = null,
  } = opts;

  const activeWinRef = useRef<Window | null>(null);
  const roleRef = useRef(role);
  roleRef.current = role;
  const forwardRef = useRef(forwardEvents);
  forwardRef.current = forwardEvents;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const onRuntimeReportRef = useRef(onRuntimeReport);
  onRuntimeReportRef.current = onRuntimeReport;
  const onInputEventRef = useRef(onInputEvent);
  onInputEventRef.current = onInputEvent;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const targetRuntimeRef = useRef<SlideRuntimeState | null>(targetRuntime);
  targetRuntimeRef.current = targetRuntime;

  const sendInit = useCallback((win: Window) => {
    try {
      win.postMessage(
        {
          source: STAGE_HOST_SOURCE,
          type: 'init',
          role: roleRef.current,
          forwardEvents: forwardRef.current,
          editMode: editModeRef.current,
        },
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
      } else if (msg.type === 'edit') {
        onEditRef.current?.(msg.edit);
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

  // Presenter: mirror edit-mode changes onto the attached slide. Fresh
  // slides get the flag via `init`; this covers toggles that happen while
  // a slide is already attached.
  useEffect(() => {
    if (!enabled || role !== 'presenter') return;
    const win = activeWinRef.current;
    if (!win) return;
    try {
      win.postMessage({ source: STAGE_HOST_SOURCE, type: 'edit-mode', enabled: editMode }, '*');
    } catch {
      // ignore
    }
  }, [enabled, role, editMode]);

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
