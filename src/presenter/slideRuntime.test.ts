import { describe, expect, it } from 'vitest';
import {
  STAGE_AGENT_SOURCE,
  parseAgentMessage,
  parseForwardedInputEvent,
  parseSlideRuntimeState,
  type SlideRuntimeState,
} from '@slidestage/ui/presenter/slideRuntime';

function validRuntime(overrides: Partial<SlideRuntimeState> = {}): SlideRuntimeState {
  return {
    driver: 'reveal',
    index: 2,
    count: 5,
    canPrev: true,
    canNext: true,
    data: { h: 2, v: 0, f: 1 },
    ...overrides,
  };
}

describe('parseSlideRuntimeState', () => {
  it('accepts a well-formed runtime state and normalizes data', () => {
    const out = parseSlideRuntimeState(validRuntime());
    expect(out).not.toBeNull();
    expect(out?.driver).toBe('reveal');
    expect(out?.index).toBe(2);
    expect(out?.count).toBe(5);
    expect(out?.data).toEqual({ h: 2, v: 0, f: 1 });
  });

  it('defaults missing data to null', () => {
    const out = parseSlideRuntimeState(validRuntime({ data: undefined }));
    expect(out?.data).toBeNull();
  });

  it('rejects unknown drivers', () => {
    expect(parseSlideRuntimeState(validRuntime({ driver: 'evil' as never }))).toBeNull();
  });

  it('rejects non-finite numeric fields', () => {
    expect(parseSlideRuntimeState(validRuntime({ index: Number.NaN }))).toBeNull();
    expect(parseSlideRuntimeState(validRuntime({ count: Infinity }))).toBeNull();
  });

  it('rejects non-boolean nav flags', () => {
    expect(parseSlideRuntimeState(validRuntime({ canNext: 'yes' as never }))).toBeNull();
  });

  it('drops non-primitive values from data and caps its size', () => {
    const data: Record<string, unknown> = { keep: 1, nested: { a: 1 }, fn: () => 1 };
    for (let i = 0; i < 50; i += 1) data[`k${i}`] = i;
    const out = parseSlideRuntimeState(validRuntime({ data: data as never }));
    expect(out).not.toBeNull();
    expect(out?.data?.nested).toBeUndefined();
    expect(out?.data?.fn).toBeUndefined();
    expect(Object.keys(out?.data ?? {}).length).toBeLessThanOrEqual(32);
  });

  it('rejects non-objects', () => {
    expect(parseSlideRuntimeState(null)).toBeNull();
    expect(parseSlideRuntimeState('reveal')).toBeNull();
    expect(parseSlideRuntimeState([])).toBeNull();
  });
});

describe('parseForwardedInputEvent', () => {
  it('accepts click events', () => {
    expect(parseForwardedInputEvent({ kind: 'click', x: 10, y: 20 })).toEqual({
      kind: 'click',
      x: 10,
      y: 20,
    });
  });

  it('accepts scroll events', () => {
    expect(parseForwardedInputEvent({ kind: 'scroll', sx: 0, sy: 100 })).toEqual({
      kind: 'scroll',
      sx: 0,
      sy: 100,
    });
  });

  it('rejects malformed / unknown kinds', () => {
    expect(parseForwardedInputEvent({ kind: 'click', x: 'a', y: 1 })).toBeNull();
    expect(parseForwardedInputEvent({ kind: 'scroll', sx: 1 })).toBeNull();
    expect(parseForwardedInputEvent({ kind: 'keydown' })).toBeNull();
    expect(parseForwardedInputEvent(null)).toBeNull();
  });
});

describe('parseAgentMessage', () => {
  it('requires the agent source tag', () => {
    expect(parseAgentMessage({ type: 'ready' })).toBeNull();
    expect(parseAgentMessage({ source: 'slidestage-host', type: 'ready' })).toBeNull();
  });

  it('parses a ready message', () => {
    expect(parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'ready' })).toEqual({
      type: 'ready',
    });
  });

  it('parses a runtime message and re-validates the payload', () => {
    const out = parseAgentMessage({
      source: STAGE_AGENT_SOURCE,
      type: 'runtime',
      runtime: validRuntime(),
    });
    expect(out?.type).toBe('runtime');
    expect(
      parseAgentMessage({
        source: STAGE_AGENT_SOURCE,
        type: 'runtime',
        runtime: { driver: 'nope' },
      }),
    ).toBeNull();
  });

  it('parses an input message and re-validates the event', () => {
    const out = parseAgentMessage({
      source: STAGE_AGENT_SOURCE,
      type: 'input',
      event: { kind: 'click', x: 1, y: 2 },
    });
    expect(out).toEqual({ type: 'input', event: { kind: 'click', x: 1, y: 2 } });
    expect(
      parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'input', event: { kind: 'x' } }),
    ).toBeNull();
  });

  it('rejects unknown message types', () => {
    expect(parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'step' })).toBeNull();
  });
});
