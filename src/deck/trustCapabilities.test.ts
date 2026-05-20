import { describe, expect, it } from 'vitest';
import {
  BASE_SANDBOX_TOKEN,
  capabilitiesEqual,
  normalizeCapabilities,
  sandboxTokensFor,
} from '@slidestage/core/deck/trustCapabilities';
import type { TrustCapability } from '@slidestage/core/deck/types';

describe('trustCapabilities · normalizeCapabilities', () => {
  it('drops unknown strings, dedupes, and sorts', () => {
    const got = normalizeCapabilities([
      'window-open',
      'same-origin-storage',
      'fly-to-moon',
      'same-origin-storage',
    ] as ReadonlyArray<string>);
    expect(got).toEqual<TrustCapability[]>(['same-origin-storage', 'window-open']);
  });

  it('keeps all three known capabilities together when present', () => {
    expect(
      normalizeCapabilities(['window-open', 'broadcast-channel', 'same-origin-storage']),
    ).toEqual<TrustCapability[]>([
      'broadcast-channel',
      'same-origin-storage',
      'window-open',
    ]);
  });

  it('returns an empty array for undefined / empty input', () => {
    expect(normalizeCapabilities(undefined)).toEqual([]);
    expect(normalizeCapabilities([])).toEqual([]);
  });
});

describe('trustCapabilities · sandboxTokensFor', () => {
  it('returns just the base token when nothing is granted', () => {
    expect(sandboxTokensFor(undefined)).toBe(BASE_SANDBOX_TOKEN);
    expect(sandboxTokensFor([])).toBe(BASE_SANDBOX_TOKEN);
  });

  it('adds allow-same-origin once for either same-origin-storage or broadcast-channel', () => {
    const storage = sandboxTokensFor(['same-origin-storage']);
    const broadcast = sandboxTokensFor(['broadcast-channel']);
    const both = sandboxTokensFor(['same-origin-storage', 'broadcast-channel']);

    for (const tokens of [storage, broadcast, both]) {
      expect(tokens.split(' ')).toContain(BASE_SANDBOX_TOKEN);
      expect(tokens.split(' ')).toContain('allow-same-origin');
    }

    expect(both.split(' ').filter((t) => t === 'allow-same-origin')).toHaveLength(1);
  });

  it('adds allow-popups + allow-popups-to-escape-sandbox for window-open', () => {
    const tokens = sandboxTokensFor(['window-open']).split(' ');
    expect(tokens).toContain('allow-popups');
    expect(tokens).toContain('allow-popups-to-escape-sandbox');
    expect(tokens).not.toContain('allow-same-origin');
  });

  it('combines all caps without duplicating tokens', () => {
    const tokens = sandboxTokensFor([
      'same-origin-storage',
      'broadcast-channel',
      'window-open',
    ]).split(' ');
    const unique = new Set(tokens);
    expect(unique.size).toBe(tokens.length);
    expect(unique).toEqual(
      new Set([
        BASE_SANDBOX_TOKEN,
        'allow-same-origin',
        'allow-popups',
        'allow-popups-to-escape-sandbox',
      ]),
    );
  });
});

describe('trustCapabilities · capabilitiesEqual', () => {
  it('treats order as irrelevant', () => {
    expect(
      capabilitiesEqual(
        ['same-origin-storage', 'window-open'],
        ['window-open', 'same-origin-storage'],
      ),
    ).toBe(true);
  });

  it('detects mismatched sets', () => {
    expect(
      capabilitiesEqual(['same-origin-storage'], ['same-origin-storage', 'window-open']),
    ).toBe(false);
    expect(capabilitiesEqual([], ['same-origin-storage'])).toBe(false);
  });

  it('two empty sets are equal', () => {
    expect(capabilitiesEqual([], [])).toBe(true);
  });
});
