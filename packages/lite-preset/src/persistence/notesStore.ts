const keyPrefix = 'slidestage-lite:notes:';

export type StoredNotes = Record<number, string>;

function storageKey(fingerprint: string): string {
  return `${keyPrefix}${fingerprint}`;
}

export function loadNotes(fingerprint: string): StoredNotes {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(storageKey(fingerprint));
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: StoredNotes = {};
    for (const [key, value] of Object.entries(parsed)) {
      const idx = Number(key);
      if (!Number.isInteger(idx)) continue;
      if (typeof value !== 'string') continue;
      out[idx] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveNotes(fingerprint: string, notes: StoredNotes): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(fingerprint), JSON.stringify(notes));
  } catch {
    // localStorage may be unavailable / over quota; intentionally silent.
  }
}

export function clearNotes(fingerprint: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(fingerprint));
}
