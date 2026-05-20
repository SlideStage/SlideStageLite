import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runLegacyMigration,
  __test,
} from '@slidestage/lite-preset/persistence/legacyMigration';

const { LEGACY_PREFIX, NEW_PREFIX, MIGRATION_FLAG_KEY } = __test;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('runLegacyMigration · hcslides-lite: → slidestage-lite: hard cut-over', () => {
  it('copies every legacy key under the new prefix and removes the source', () => {
    window.localStorage.setItem(`${LEGACY_PREFIX}trust:abc123`, JSON.stringify({ granted: true }));
    window.localStorage.setItem(`${LEGACY_PREFIX}notes:abc123:1`, 'cover notes');
    window.localStorage.setItem(`${LEGACY_PREFIX}annotations:abc123:1`, '[]');
    window.localStorage.setItem(`${LEGACY_PREFIX}spotlight-radius`, '120');
    window.localStorage.setItem(`${LEGACY_PREFIX}locale`, 'zh-CN');

    const stats = runLegacyMigration();

    expect(stats.migrated).toBe(5);
    expect(stats.skipped).toBe(0);
    expect(stats.cleared).toBe(5);

    for (const tail of ['trust:abc123', 'notes:abc123:1', 'annotations:abc123:1', 'spotlight-radius', 'locale']) {
      expect(window.localStorage.getItem(`${LEGACY_PREFIX}${tail}`)).toBeNull();
      expect(window.localStorage.getItem(`${NEW_PREFIX}${tail}`)).not.toBeNull();
    }

    expect(window.localStorage.getItem(`${NEW_PREFIX}trust:abc123`)).toBe(
      JSON.stringify({ granted: true }),
    );
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe('1');
  });

  it('prefers an existing new-prefix value and discards the legacy duplicate', () => {
    window.localStorage.setItem(`${LEGACY_PREFIX}notes:fp:2`, 'old notes');
    window.localStorage.setItem(`${NEW_PREFIX}notes:fp:2`, 'fresh notes');

    const stats = runLegacyMigration();

    expect(stats.migrated).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(stats.cleared).toBe(1);
    expect(window.localStorage.getItem(`${NEW_PREFIX}notes:fp:2`)).toBe('fresh notes');
    expect(window.localStorage.getItem(`${LEGACY_PREFIX}notes:fp:2`)).toBeNull();
  });

  it('does not touch unrelated keys', () => {
    window.localStorage.setItem('unrelated:key', 'noop');
    window.localStorage.setItem(`${LEGACY_PREFIX}notes:fp:1`, 'one');

    runLegacyMigration();

    expect(window.localStorage.getItem('unrelated:key')).toBe('noop');
    expect(window.localStorage.getItem(`${NEW_PREFIX}notes:fp:1`)).toBe('one');
  });

  it('is idempotent — repeat calls become no-ops via the flag', () => {
    window.localStorage.setItem(`${LEGACY_PREFIX}notes:fp:1`, 'one');

    const first = runLegacyMigration();
    expect(first.migrated).toBe(1);

    window.localStorage.setItem(`${LEGACY_PREFIX}notes:fp:9`, 'new-after-flag');
    const second = runLegacyMigration();
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(0);
    expect(second.cleared).toBe(0);
    expect(window.localStorage.getItem(`${LEGACY_PREFIX}notes:fp:9`)).toBe('new-after-flag');
  });

  it('returns a zeroed stats record when no legacy keys are present', () => {
    const stats = runLegacyMigration();
    expect(stats).toEqual({ migrated: 0, skipped: 0, cleared: 0 });
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe('1');
  });
});
