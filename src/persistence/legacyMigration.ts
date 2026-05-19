/**
 * One-shot brand-rename data migration.
 *
 * SlideStageLite (formerly SlidesDeckLite) renamed every `localStorage` key
 * from the legacy `hcslides-lite:*` namespace to `slidestage-lite:*`. To
 * keep existing users' trust grants, speaker notes, annotations, presenter
 * panel sizes, etc. alive across the upgrade, we run this migration once
 * at App bootstrap:
 *
 *   1. Walk every key in `window.localStorage`.
 *   2. For each key that starts with `hcslides-lite:`, copy its value into
 *      the equivalent `slidestage-lite:` key — unless that target already
 *      exists (newer runs are always preferred over stale legacy values).
 *   3. Delete the legacy key.
 *   4. Mark the migration as run via `slidestage-lite:migrations:legacy`
 *      so subsequent loads short-circuit.
 *
 * Failures are swallowed: localStorage may be unavailable (server-side
 * render, private mode quota, sandboxed iframe). Worst case, the user
 * re-grants trust and re-edits notes — exactly what would happen if we
 * had no migration at all.
 */
const LEGACY_PREFIX = 'hcslides-lite:';
const NEW_PREFIX = 'slidestage-lite:';
const MIGRATION_FLAG_KEY = 'slidestage-lite:migrations:legacy';

export interface LegacyMigrationStats {
  migrated: number;
  skipped: number;
  cleared: number;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Run the legacy `hcslides-lite:*` → `slidestage-lite:*` migration if it
 * has not already executed. Idempotent: safe to call on every App mount.
 */
export function runLegacyMigration(): LegacyMigrationStats {
  const stats: LegacyMigrationStats = { migrated: 0, skipped: 0, cleared: 0 };
  const storage = safeLocalStorage();
  if (!storage) return stats;

  try {
    if (storage.getItem(MIGRATION_FLAG_KEY) === '1') {
      return stats;
    }
  } catch {
    return stats;
  }

  const legacyKeys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith(LEGACY_PREFIX)) {
        legacyKeys.push(key);
      }
    }
  } catch {
    return stats;
  }

  for (const legacyKey of legacyKeys) {
    const newKey = `${NEW_PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`;
    let value: string | null = null;
    try {
      value = storage.getItem(legacyKey);
    } catch {
      // Best-effort: skip unreadable entries and remove them anyway.
      try {
        storage.removeItem(legacyKey);
        stats.cleared += 1;
      } catch {
        // ignore
      }
      continue;
    }

    let existing: string | null = null;
    try {
      existing = storage.getItem(newKey);
    } catch {
      existing = null;
    }

    if (existing === null && value !== null) {
      try {
        storage.setItem(newKey, value);
        stats.migrated += 1;
      } catch {
        // Quota or disabled storage: leave the legacy key in place so a
        // future run can retry.
        stats.skipped += 1;
        continue;
      }
    } else {
      stats.skipped += 1;
    }

    try {
      storage.removeItem(legacyKey);
      stats.cleared += 1;
    } catch {
      // ignore — next run will see it again, which is fine because we
      // never overwrite an existing new-prefix value.
    }
  }

  try {
    storage.setItem(MIGRATION_FLAG_KEY, '1');
  } catch {
    // If we can't persist the flag, the migration will simply re-run on
    // the next mount and remain idempotent.
  }

  return stats;
}

/** Internal helpers exposed for unit tests. */
export const __test = {
  LEGACY_PREFIX,
  NEW_PREFIX,
  MIGRATION_FLAG_KEY,
};
