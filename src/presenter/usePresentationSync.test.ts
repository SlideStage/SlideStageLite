import { describe, expect, it, vi } from 'vitest';
import type { LoadedDeck } from '@slidestage/core/deck/types';
import {
  DEFAULT_AUDIENCE_CHANNEL,
  deserializeAudienceDeck,
  makeAudiencePresentation,
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

  it('accepts an iframeSandbox field on the snapshot envelope', () => {
    // The presenter ships its resolved sandbox token string so the
    // audience window doesn't have to re-derive it from
    // `compat.requires`. Otherwise auto-elevated decks (where the
    // App layer silently granted `same-origin-storage` to avoid
    // OOM-via-base64-srcdoc) end up with an opaque-origin audience
    // iframe that the SW can't intercept, leaving the popup blank.
    const deck = makeDeck();
    const snapshot: AudienceSnapshot = {
      deck: serializeAudienceDeck(deck),
      presentation: makeAudiencePresentation(0, makePresenterState(), null),
      iframeSandbox: 'allow-scripts allow-same-origin',
    };
    expect(snapshot.iframeSandbox).toBe('allow-scripts allow-same-origin');
  });
});
