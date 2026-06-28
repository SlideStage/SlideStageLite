// Host side of the in-iframe runtime bridge.
//
// The injected agent (`@slidestage/core/deck/runtimeAgent`) speaks the
// message protocol defined here. This module owns:
//   - the wire types for in-slide step state and forwarded interactions,
//   - schema validators for everything that crosses an untrusted boundary
//     (both the same-origin sync channel between presenter/audience AND
//     the postMessage channel with the sandboxed slide iframe).
//
// Security: the slide iframe is untrusted active HTML and the sync
// channel is same-origin + unauthenticated (DSS-CAND-012). Never act on a
// raw payload — validate it here first. The validators are deliberately
// strict and bounded.

/** Source tags so each side ignores its own / unrelated postMessages. */
export const STAGE_HOST_SOURCE = 'slidestage-host';
export const STAGE_AGENT_SOURCE = 'slidestage-agent';

/** Which in-slide stepping model the agent locked onto. */
export type SlideRuntimeDriver = 'reveal' | 'impress' | 'generic' | 'custom';

/**
 * A snapshot of the active slide's internal step/animation state, as
 * reported by the agent. Mirrored presenter → audience so the audience
 * iframe can be driven to the same point. `data` carries an opaque
 * framework state object (reveal `getState()`, impress step index) used
 * for exact restoration; `index`/`count`/`canPrev`/`canNext` drive the
 * host's step-vs-slide navigation decision.
 */
export interface SlideRuntimeState {
  driver: SlideRuntimeDriver;
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
  data?: Record<string, number | boolean | string | null> | null;
}

/**
 * A best-effort (Strategy A+) interaction forwarded from the presenter
 * iframe and replayed in the audience iframe when the slide has no step
 * model. Intentionally tiny — coordinates locate the target via
 * `elementFromPoint`; scroll mirrors the document scroll position.
 */
export type ForwardedInputEvent =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'scroll'; sx: number; sy: number };

/**
 * One bounding rectangle (deck logical px) of the presenter's current
 * text selection, forwarded so the audience window can paint an identical
 * highlight. Coordinates come from `Range.getClientRects()` inside the
 * slide iframe, whose viewport equals the deck's logical dimensions, so
 * they map 1:1 onto the audience `.logical-stage` overlay. Unlike a DOM
 * range, rects are immune to cross-iframe DOM drift.
 */
export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Defensive upper bound on forwarded selection rects per message. */
export const MAX_SELECTION_RECTS = 200;

/** host → agent */
export type HostToAgentMessage =
  | { source: typeof STAGE_HOST_SOURCE; type: 'init'; role: 'presenter' | 'audience'; forwardEvents: boolean }
  | { source: typeof STAGE_HOST_SOURCE; type: 'step'; action: 'next' | 'prev' }
  | { source: typeof STAGE_HOST_SOURCE; type: 'goto'; runtime: SlideRuntimeState }
  | { source: typeof STAGE_HOST_SOURCE; type: 'replay'; event: ForwardedInputEvent }
  | { source: typeof STAGE_HOST_SOURCE; type: 'ping' };

/** agent → host */
export type AgentToHostMessage =
  | { type: 'ready' }
  | { type: 'runtime'; runtime: SlideRuntimeState }
  | { type: 'input'; event: ForwardedInputEvent }
  // Presenter → host: rects of the current text selection (or [] to clear).
  | { type: 'selection'; rects: SelectionRect[] };

const RUNTIME_DRIVERS: ReadonlySet<string> = new Set<string>([
  'reveal',
  'impress',
  'generic',
  'custom',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseRuntimeData(
  value: unknown,
): Record<string, number | boolean | string | null> | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const out: Record<string, number | boolean | string | null> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (count >= 32) break;
    if (raw === null || isFiniteNumber(raw) || typeof raw === 'boolean' || typeof raw === 'string') {
      out[key] = raw as number | boolean | string | null;
      count += 1;
    }
  }
  return out;
}

/** Validate + normalize a {@link SlideRuntimeState}; returns null if invalid. */
export function parseSlideRuntimeState(value: unknown): SlideRuntimeState | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.driver !== 'string' || !RUNTIME_DRIVERS.has(value.driver)) return null;
  if (!isFiniteNumber(value.index) || !isFiniteNumber(value.count)) return null;
  if (typeof value.canPrev !== 'boolean' || typeof value.canNext !== 'boolean') return null;
  return {
    driver: value.driver as SlideRuntimeDriver,
    index: value.index,
    count: value.count,
    canPrev: value.canPrev,
    canNext: value.canNext,
    data: parseRuntimeData(value.data),
  };
}

/** Validate a {@link ForwardedInputEvent}; returns null if invalid. */
export function parseForwardedInputEvent(value: unknown): ForwardedInputEvent | null {
  if (!isPlainObject(value)) return null;
  if (value.kind === 'click') {
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
    return { kind: 'click', x: value.x, y: value.y };
  }
  if (value.kind === 'scroll') {
    if (!isFiniteNumber(value.sx) || !isFiniteNumber(value.sy)) return null;
    return { kind: 'scroll', sx: value.sx, sy: value.sy };
  }
  return null;
}

/**
 * Validate + sanitize a forwarded selection-rect list from the (untrusted)
 * slide iframe. Drops malformed entries and caps the count. Returns `null`
 * only when the payload is not an array; an empty array is valid and tells
 * the audience to clear its highlight.
 */
export function parseSelectionRects(value: unknown): SelectionRect[] | null {
  if (!Array.isArray(value)) return null;
  const out: SelectionRect[] = [];
  for (const raw of value) {
    if (out.length >= MAX_SELECTION_RECTS) break;
    if (!isPlainObject(raw)) continue;
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) continue;
    if (!isFiniteNumber(raw.w) || !isFiniteNumber(raw.h)) continue;
    if (raw.w < 0 || raw.h < 0) continue;
    out.push({ x: raw.x, y: raw.y, w: raw.w, h: raw.h });
  }
  return out;
}

/** Validate an inbound agent → host message; returns null if invalid. */
export function parseAgentMessage(value: unknown): AgentToHostMessage | null {
  if (!isPlainObject(value)) return null;
  if (value.source !== STAGE_AGENT_SOURCE) return null;
  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'runtime': {
      const runtime = parseSlideRuntimeState(value.runtime);
      return runtime ? { type: 'runtime', runtime } : null;
    }
    case 'input': {
      const event = parseForwardedInputEvent(value.event);
      return event ? { type: 'input', event } : null;
    }
    case 'selection': {
      const rects = parseSelectionRects(value.rects);
      return rects ? { type: 'selection', rects } : null;
    }
    default:
      return null;
  }
}
