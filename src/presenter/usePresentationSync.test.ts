import { describe, expect, it, vi } from 'vitest';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import {
  DEFAULT_AUDIENCE_CHANNEL,
  deserializeAudienceDeck,
  makeAudiencePresentation,
  parseAudienceMessage,
  presentationChannelName,
  serializeAudienceDeck,
  type AudienceSnapshot,
} from '@slidestage/ui/presenter/usePresentationSync';
import type { PresenterState, Stroke } from '@slidestage/ui/presenter/types';

function makePresenterState(overrides: Partial<PresenterState> = {}): PresenterState {
  return {
    tool: 'mouse',
    penColor: '#FF3B30',
    strokesByIdx: {},
    spotlightRadius: 180,
    ...overrides,
  };
}

function makeDeck(overrides: Partial<LoadedDeck> = {}): LoadedDeck {
  const revoke = vi.fn();
  return {
    fileName: 'fixture.stage',
    fingerprint: 'fingerprint-xyz',
    deckId: 'fingerprintxyz12',
    manifest: {
      schema: 'slidestage@1.0',
      id: 'fixture-deck',
      version: '1.0.0',
      title: 'Fixture',
      subtitle: null,
      author: 'Test',
      description: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      architecture: 'multi-file',
      dimensions: { width: 1920, height: 1080 },
      totalSlides: 1,
      slides: [
        {
          id: 'cover',
          index: 1,
          label: 'Cover',
          file: 'slides/01.html',
          thumbnail: null,
          notes: null,
        },
      ],
    },
    slideUrls: ['blob:fake'],
    slideHtml: ['<!doctype html><html><body>fake</body></html>'],
    thumbnailUrls: [null],
    prefersSrcdoc: false,
    inlinedHtmlAvailable: true,
    totalAssetBytes: 0,
    revoke,
    ...overrides,
  };
}

describe('presentationChannelName', () => {
  it('falls back to the shared channel when no fingerprint is supplied', () => {
    expect(presentationChannelName()).toBe(DEFAULT_AUDIENCE_CHANNEL);
    expect(presentationChannelName(null)).toBe(DEFAULT_AUDIENCE_CHANNEL);
    expect(presentationChannelName('')).toBe(DEFAULT_AUDIENCE_CHANNEL);
  });

  it('namespaces the channel per deck fingerprint to avoid cross-talk', () => {
    expect(presentationChannelName('abc')).toBe(`${DEFAULT_AUDIENCE_CHANNEL}::abc`);
    expect(presentationChannelName('def')).not.toEqual(presentationChannelName('abc'));
  });
});

describe('makeAudiencePresentation', () => {
  it('copies presenter state into a transport-friendly shape', () => {
    const strokes: Record<number, Stroke[]> = {
      0: [{ tool: 'pen', color: '#fff', width: 8, points: [{ x: 1, y: 2 }] }],
    };
    const presentation = makeAudiencePresentation(
      0,
      makePresenterState({ tool: 'pen', strokesByIdx: strokes, spotlightRadius: 220 }),
      null,
    );
    expect(presentation).toEqual({
      currentIndex: 0,
      tool: 'pen',
      strokesByIdx: strokes,
      spotlightRadius: 220,
      pointer: null,
    });
  });

  it('preserves the pointer payload for laser / spotlight mirroring', () => {
    const presentation = makeAudiencePresentation(2, makePresenterState({ tool: 'laser' }), {
      tool: 'laser',
      point: { x: 100, y: 200 },
    });
    expect(presentation.currentIndex).toBe(2);
    expect(presentation.pointer).toEqual({ tool: 'laser', point: { x: 100, y: 200 } });
  });
});

describe('serializeAudienceDeck / deserializeAudienceDeck', () => {
  it('strips runtime-only fields like revoke before crossing windows', () => {
    const deck = makeDeck();
    const serialized = serializeAudienceDeck(deck);
    expect(serialized).not.toHaveProperty('revoke');
    expect(serialized.fingerprint).toBe('fingerprint-xyz');
    expect(serialized.slideUrls).toEqual(['blob:fake']);
  });

  it('restores a LoadedDeck-shaped object with a noop revoke', () => {
    const deck = makeDeck();
    const snapshot: AudienceSnapshot = {
      deck: serializeAudienceDeck(deck),
      presentation: makeAudiencePresentation(0, makePresenterState(), null),
    };
    const restored = deserializeAudienceDeck(snapshot);
    expect(restored.fileName).toBe(deck.fileName);
    expect(restored.manifest).toBe(deck.manifest);
    // Both oversized-deck guardrails must survive the round trip so
    // the audience window can mirror the presenter's src-vs-srcdoc
    // decision instead of redoing the math from the trust store.
    expect(restored.inlinedHtmlAvailable).toBe(deck.inlinedHtmlAvailable);
    expect(restored.totalAssetBytes).toBe(deck.totalAssetBytes);
    expect(typeof restored.revoke).toBe('function');
    expect(() => restored.revoke()).not.toThrow();
  });

  it('no longer carries a sandbox token (DSS-CAND-012)', () => {
    // The audience derives its iframe sandbox locally from the trust
    // store; the snapshot envelope must not ship a forge-able token.
    const deck = makeDeck();
    const snapshot: AudienceSnapshot = {
      deck: serializeAudienceDeck(deck),
      presentation: makeAudiencePresentation(0, makePresenterState(), null),
    };
    expect(snapshot).not.toHaveProperty('iframeSandbox');
  });
});

describe('parseAudienceMessage (DSS-CAND-012 schema validation)', () => {
  it('accepts well-formed control messages', () => {
    expect(parseAudienceMessage({ type: 'hello', role: 'presenter' })).toEqual({
      type: 'hello',
      role: 'presenter',
    });
    expect(parseAudienceMessage({ type: 'goodbye', role: 'audience' })).toEqual({
      type: 'goodbye',
      role: 'audience',
    });
    expect(parseAudienceMessage({ type: 'request-snapshot' })).toEqual({
      type: 'request-snapshot',
    });
  });

  it('accepts a valid presentation message and rejects malformed ones', () => {
    const presentation = makeAudiencePresentation(1, makePresenterState({ tool: 'pen' }), null);
    expect(parseAudienceMessage({ type: 'presentation', presentation })).toEqual({
      type: 'presentation',
      presentation,
    });
    expect(
      parseAudienceMessage({ type: 'presentation', presentation: { currentIndex: 'x' } }),
    ).toBeNull();
    expect(
      parseAudienceMessage({
        type: 'presentation',
        presentation: { ...presentation, tool: 'rootkit' },
      }),
    ).toBeNull();
  });

  it('accepts a valid snapshot and strips unknown fields', () => {
    const deck = makeDeck();
    const presentation = makeAudiencePresentation(0, makePresenterState(), null);
    const parsed = parseAudienceMessage({
      type: 'snapshot',
      snapshot: {
        deck: serializeAudienceDeck(deck),
        presentation,
        // A forged sandbox token must be dropped, not surfaced.
        iframeSandbox: 'allow-scripts allow-same-origin allow-top-navigation',
      },
    });
    expect(parsed?.type).toBe('snapshot');
    expect(parsed && 'snapshot' in parsed ? parsed.snapshot : null).not.toHaveProperty(
      'iframeSandbox',
    );
  });

  it('rejects snapshots with a malformed deck or presentation', () => {
    const deck = makeDeck();
    expect(
      parseAudienceMessage({
        type: 'snapshot',
        snapshot: { deck: { fingerprint: 'x' }, presentation: {} },
      }),
    ).toBeNull();
    expect(
      parseAudienceMessage({
        type: 'snapshot',
        snapshot: { deck: serializeAudienceDeck(deck), presentation: { tool: 'mouse' } },
      }),
    ).toBeNull();
  });

  it('rejects non-objects, unknown types, and bad roles', () => {
    expect(parseAudienceMessage(null)).toBeNull();
    expect(parseAudienceMessage('snapshot')).toBeNull();
    expect(parseAudienceMessage({ type: 'rm-rf' })).toBeNull();
    expect(parseAudienceMessage({ type: 'hello', role: 'attacker' })).toBeNull();
  });
});

describe('parseAudienceMessage — in-slide runtime sync', () => {
  const runtime = {
    driver: 'reveal' as const,
    index: 1,
    count: 3,
    canPrev: true,
    canNext: true,
    data: { h: 1 },
  };

  it('round-trips a presentation carrying valid runtime state', () => {
    const presentation = {
      ...makeAudiencePresentation(1, makePresenterState(), null),
      runtime,
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).toEqual({
      type: 'presentation',
      presentation,
    });
  });

  it('accepts a presentation with null runtime (slide has no step model)', () => {
    const presentation = {
      ...makeAudiencePresentation(0, makePresenterState(), null),
      runtime: null,
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).not.toBeNull();
  });

  it('rejects a presentation whose runtime is forged / malformed', () => {
    const presentation = {
      ...makeAudiencePresentation(0, makePresenterState(), null),
      runtime: { driver: 'reveal', index: 'NaN' },
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).toBeNull();
  });

  it('parses an input-event message and re-validates the event', () => {
    expect(
      parseAudienceMessage({ type: 'input-event', event: { kind: 'click', x: 5, y: 6 } }),
    ).toEqual({ type: 'input-event', event: { kind: 'click', x: 5, y: 6 } });
    expect(
      parseAudienceMessage({ type: 'input-event', event: { kind: 'nope' } }),
    ).toBeNull();
    expect(parseAudienceMessage({ type: 'input-event' })).toBeNull();
  });
});

describe('parseAudienceMessage — text selection mirroring', () => {
  it('round-trips a presentation carrying valid selection rects', () => {
    const presentation = {
      ...makeAudiencePresentation(1, makePresenterState(), null),
      selection: [
        { x: 10, y: 20, w: 120, h: 32 },
        { x: 10, y: 52, w: 80, h: 32 },
      ],
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).toEqual({
      type: 'presentation',
      presentation,
    });
  });

  it('accepts a presentation with null selection (nothing highlighted)', () => {
    const presentation = {
      ...makeAudiencePresentation(0, makePresenterState(), null),
      selection: null,
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).not.toBeNull();
  });

  it('rejects a presentation whose selection rects are forged / malformed', () => {
    const presentation = {
      ...makeAudiencePresentation(0, makePresenterState(), null),
      selection: [{ x: 1, y: 2, w: -3, h: 'x' }],
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).toBeNull();
  });

  it('rejects a presentation whose selection is not an array', () => {
    const presentation = {
      ...makeAudiencePresentation(0, makePresenterState(), null),
      selection: { x: 1, y: 2, w: 3, h: 4 },
    };
    expect(parseAudienceMessage({ type: 'presentation', presentation })).toBeNull();
  });
});
