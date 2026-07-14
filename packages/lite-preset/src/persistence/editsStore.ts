// Local persistence for in-place slide text edits.
//
// Keyed by the deck's content fingerprint (sha256 of the zip bytes) like
// every other per-deck store. Edits never mutate the `.stage` file, so
// the fingerprint — and with it trust grants, annotations, and notes —
// stays stable while edits exist.
//
// Budget: localStorage is shared with annotations/notes and browsers cap
// it around 5-10 MiB per origin, so this store enforces a per-deck cap of
// {@link MAX_EDITS_PER_DECK} patches / {@link MAX_EDITS_BYTES} serialized
// bytes. When the budget is hit, `saveDeckEdits` reports failure and the
// UI shows a "storage full" warning instead of silently dropping data.

import {
  isValidSlideTextPatch,
  type SlideTextPatch,
} from '@slidestage/core/deck/slidePatches';

const keyPrefix = 'slidestage-lite:edits:';

/** Sparse map of slide index → patches (one per edited element). */
export type StoredDeckEdits = Record<number, SlideTextPatch[]>;

/** Hard cap on stored patches per deck. */
export const MAX_EDITS_PER_DECK = 500;

/** Hard cap on the serialized JSON size per deck (1 MiB). */
export const MAX_EDITS_BYTES = 1024 * 1024;

function storageKey(fingerprint: string): string {
  return `${keyPrefix}${fingerprint}`;
}

export function loadDeckEdits(fingerprint: string): StoredDeckEdits {
  if (typeof window === 'undefined') return {};
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(fingerprint));
  } catch {
    return {};
  }
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: StoredDeckEdits = {};
    for (const [key, value] of Object.entries(parsed)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0) continue;
      if (!Array.isArray(value)) continue;
      const patches = value.filter(isValidSlideTextPatch);
      if (patches.length > 0) out[idx] = patches;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Persist the edit map. Returns `false` when the payload exceeds the
 * per-deck byte budget or localStorage rejected the write (quota /
 * disabled storage) — callers surface that as a "no longer saving"
 * warning. An empty map removes the key entirely.
 */
export function saveDeckEdits(fingerprint: string, edits: StoredDeckEdits): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (countDeckEdits(edits) === 0) {
      window.localStorage.removeItem(storageKey(fingerprint));
      return true;
    }
    const json = JSON.stringify(edits);
    if (json.length > MAX_EDITS_BYTES) return false;
    window.localStorage.setItem(storageKey(fingerprint), json);
    return true;
  } catch {
    return false;
  }
}

export function clearDeckEdits(fingerprint: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(fingerprint));
  } catch {
    // ignore
  }
}

export function countDeckEdits(edits: StoredDeckEdits): number {
  let total = 0;
  for (const patches of Object.values(edits)) {
    total += patches.length;
  }
  return total;
}

export interface UpsertDeckEditResult {
  edits: StoredDeckEdits;
  /** `'cap'` when the per-deck patch count budget rejected a new entry. */
  rejected: 'cap' | null;
}

/**
 * Merge one committed edit into the map. Same-target edits chain: the
 * stored patch keeps the ORIGINAL `before` text (what the static HTML
 * contains) and only its `after` advances, so re-applying at load time
 * still matches the anchor. Editing an element back to its original text
 * removes the patch entirely. A "target" is the selector plus, for
 * text-run edits inside mixed-content elements, the run's `textNode`
 * index — two runs of the same element must never chain onto each other.
 */
export function upsertDeckEdit(
  edits: StoredDeckEdits,
  slideIndex: number,
  patch: SlideTextPatch,
): UpsertDeckEditResult {
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || !isValidSlideTextPatch(patch)) {
    return { edits, rejected: null };
  }

  const slidePatches = [...(edits[slideIndex] ?? [])];
  const existingIndex = slidePatches.findIndex(
    (p) => p.selector === patch.selector && p.textNode === patch.textNode,
  );

  if (existingIndex >= 0) {
    const original = slidePatches[existingIndex].before;
    if (patch.after === original) {
      slidePatches.splice(existingIndex, 1);
    } else {
      slidePatches[existingIndex] = {
        selector: patch.selector,
        before: original,
        after: patch.after,
        ...(patch.textNode !== undefined ? { textNode: patch.textNode } : {}),
      };
    }
  } else {
    if (patch.before === patch.after) {
      return { edits, rejected: null };
    }
    if (countDeckEdits(edits) >= MAX_EDITS_PER_DECK) {
      return { edits, rejected: 'cap' };
    }
    slidePatches.push({ ...patch });
  }

  const next: StoredDeckEdits = { ...edits };
  if (slidePatches.length === 0) {
    delete next[slideIndex];
  } else {
    next[slideIndex] = slidePatches;
  }
  return { edits: next, rejected: null };
}
