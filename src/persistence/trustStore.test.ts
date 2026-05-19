import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearTrustGrant,
  loadTrustGrant,
  saveTrustGrant,
} from './trustStore';

const FP = 'sha256-deadbeef';
const OTHER_FP = 'sha256-cafef00d';

describe('trustStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns null when no grant has been written', () => {
    expect(loadTrustGrant(FP, ['same-origin-storage'])).toBeNull();
  });

  it('round-trips a grant for the same fingerprint + capability set', () => {
    saveTrustGrant(FP, ['same-origin-storage', 'broadcast-channel']);
    const grant = loadTrustGrant(FP, ['broadcast-channel', 'same-origin-storage']);
    expect(grant).not.toBeNull();
    expect(grant?.fingerprint).toBe(FP);
    expect(grant?.capabilities).toEqual(['broadcast-channel', 'same-origin-storage']);
    expect(grant?.grantedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('refuses to reuse a grant when the deck now requires more capabilities', () => {
    saveTrustGrant(FP, ['same-origin-storage']);
    const grant = loadTrustGrant(FP, ['same-origin-storage', 'window-open']);
    expect(grant).toBeNull();
  });

  it('refuses to reuse a grant when the deck now requires fewer capabilities', () => {
    saveTrustGrant(FP, ['same-origin-storage', 'window-open']);
    const grant = loadTrustGrant(FP, ['same-origin-storage']);
    expect(grant).toBeNull();
  });

  it('does not leak grants across fingerprints', () => {
    saveTrustGrant(FP, ['same-origin-storage']);
    expect(loadTrustGrant(OTHER_FP, ['same-origin-storage'])).toBeNull();
  });

  it('clears a grant on demand', () => {
    saveTrustGrant(FP, ['same-origin-storage']);
    clearTrustGrant(FP);
    expect(loadTrustGrant(FP, ['same-origin-storage'])).toBeNull();
  });

  it('treats malformed JSON or missing fields as no grant', () => {
    window.localStorage.setItem('slidestage-lite:trust:' + FP, '{not json');
    expect(loadTrustGrant(FP, ['same-origin-storage'])).toBeNull();

    window.localStorage.setItem(
      'slidestage-lite:trust:' + FP,
      JSON.stringify({ status: 'pending', capabilities: ['same-origin-storage'] }),
    );
    expect(loadTrustGrant(FP, ['same-origin-storage'])).toBeNull();
  });
});
