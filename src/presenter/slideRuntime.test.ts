import { describe, expect, it } from 'vitest';
import {
  MAX_SELECTION_RECTS,
  STAGE_AGENT_SOURCE,
  parseAgentMessage,
  parseForwardedInputEvent,
  parseSelectionRects,
  parseSlideEdit,
  parseSlideRuntimeState,
  type SlideRuntimeState,
} from '@slidestage/ui/presenter/slideRuntime';
import { MAX_SLIDE_PATCH_TEXT_LENGTH } from '@slidestage/core/deck/slidePatches';

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

describe('parseSelectionRects', () => {
  it('accepts a well-formed rect list', () => {
    expect(
      parseSelectionRects([
        { x: 1, y: 2, w: 3, h: 4 },
        { x: 10, y: 20, w: 30, h: 40 },
      ]),
    ).toEqual([
      { x: 1, y: 2, w: 3, h: 4 },
      { x: 10, y: 20, w: 30, h: 40 },
    ]);
  });

  it('treats an empty array as a valid "clear" payload', () => {
    expect(parseSelectionRects([])).toEqual([]);
  });

  it('drops malformed entries instead of failing the whole list', () => {
    expect(
      parseSelectionRects([
        { x: 1, y: 2, w: 3, h: 4 },
        { x: 'a', y: 2, w: 3, h: 4 },
        { x: 1, y: 2, w: -3, h: 4 },
        { x: 1, y: 2, w: 3, h: Number.NaN },
        null,
        { x: 5, y: 6, w: 7, h: 8 },
      ]),
    ).toEqual([
      { x: 1, y: 2, w: 3, h: 4 },
      { x: 5, y: 6, w: 7, h: 8 },
    ]);
  });

  it('caps the number of rects to bound the payload', () => {
    const many = Array.from({ length: MAX_SELECTION_RECTS + 25 }, () => ({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    }));
    expect(parseSelectionRects(many)).toHaveLength(MAX_SELECTION_RECTS);
  });

  it('rejects non-array payloads', () => {
    expect(parseSelectionRects(null)).toBeNull();
    expect(parseSelectionRects({ x: 1 })).toBeNull();
    expect(parseSelectionRects('rects')).toBeNull();
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

  it('parses a selection message and sanitizes the rects', () => {
    expect(
      parseAgentMessage({
        source: STAGE_AGENT_SOURCE,
        type: 'selection',
        rects: [{ x: 1, y: 2, w: 3, h: 4 }],
      }),
    ).toEqual({ type: 'selection', rects: [{ x: 1, y: 2, w: 3, h: 4 }] });
    // An empty list is a valid "clear" message.
    expect(
      parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'selection', rects: [] }),
    ).toEqual({ type: 'selection', rects: [] });
    // A non-array rects payload is rejected.
    expect(
      parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'selection', rects: 'nope' }),
    ).toBeNull();
  });

  it('parses an edit message and re-validates the payload', () => {
    const edit = {
      selector: 'body>main:nth-of-type(1)>h1:nth-of-type(1)',
      before: 'Old',
      after: 'New',
    };
    expect(
      parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'edit', edit }),
    ).toEqual({ type: 'edit', edit });
    expect(
      parseAgentMessage({
        source: STAGE_AGENT_SOURCE,
        type: 'edit',
        edit: { ...edit, selector: 'h1[onclick]' },
      }),
    ).toBeNull();
  });

  it('rejects unknown message types', () => {
    expect(parseAgentMessage({ source: STAGE_AGENT_SOURCE, type: 'step' })).toBeNull();
  });
});

describe('parseSlideEdit', () => {
  const valid = {
    selector: 'body>main:nth-of-type(1)>div:nth-of-type(2)>p:nth-of-type(3)',
    before: 'Original',
    after: 'Edited',
  };

  it('accepts the structural selector grammar the agent generates', () => {
    expect(parseSlideEdit(valid)).toEqual(valid);
    expect(
      parseSlideEdit({ ...valid, selector: 'body>custom-tag:nth-of-type(4)' }),
    ).not.toBeNull();
  });

  it('rejects selectors outside the structural grammar', () => {
    for (const selector of [
      '',
      'body >h1:nth-of-type(1)',
      'body>h1',
      'body>h1:nth-child(2)',
      'html>body>h1:nth-of-type(1)',
      'body>h1:nth-of-type(1)>*',
      'body>script:nth-of-type(1);alert(1)',
    ]) {
      expect(parseSlideEdit({ ...valid, selector }), selector).toBeNull();
    }
  });

  it('rejects non-string fields', () => {
    expect(parseSlideEdit(null)).toBeNull();
    expect(parseSlideEdit({ ...valid, before: 7 })).toBeNull();
    expect(parseSlideEdit({ ...valid, after: null })).toBeNull();
  });

  it('rejects no-op edits (before === after)', () => {
    expect(parseSlideEdit({ ...valid, after: valid.before })).toBeNull();
  });

  it('bounds text length', () => {
    expect(
      parseSlideEdit({ ...valid, after: 'x'.repeat(MAX_SLIDE_PATCH_TEXT_LENGTH + 1) }),
    ).toBeNull();
    expect(
      parseSlideEdit({ ...valid, after: 'x'.repeat(MAX_SLIDE_PATCH_TEXT_LENGTH) }),
    ).not.toBeNull();
  });

  it('passes through a valid textNode run index', () => {
    expect(parseSlideEdit({ ...valid, textNode: 0 })).toEqual({ ...valid, textNode: 0 });
    expect(parseSlideEdit({ ...valid, textNode: 9999 })).not.toBeNull();
    // Absent textNode stays absent — a whole-leaf edit must not grow one.
    expect(parseSlideEdit(valid)).not.toHaveProperty('textNode');
  });

  it('rejects malformed textNode indices', () => {
    expect(parseSlideEdit({ ...valid, textNode: -1 })).toBeNull();
    expect(parseSlideEdit({ ...valid, textNode: 0.5 })).toBeNull();
    expect(parseSlideEdit({ ...valid, textNode: 10000 })).toBeNull();
    expect(parseSlideEdit({ ...valid, textNode: '1' })).toBeNull();
    expect(parseSlideEdit({ ...valid, textNode: Number.NaN })).toBeNull();
  });

  it('rejects run edits that would empty the text node', () => {
    expect(parseSlideEdit({ ...valid, after: '', textNode: 0 })).toBeNull();
    // Emptying a whole leaf element stays allowed.
    expect(parseSlideEdit({ ...valid, after: '' })).not.toBeNull();
  });
});
