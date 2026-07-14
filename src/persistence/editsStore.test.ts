/**
 * Contract tests for the per-deck slide edits store.
 *
 * Pins the localStorage key shape, hydration validation (bad entries are
 * dropped, never crash), the per-deck budget (patch count + serialized
 * bytes), and the upsert chaining semantics: same-element edits keep the
 * ORIGINAL `before` anchor and editing back to the original text removes
 * the patch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_EDITS_BYTES,
  MAX_EDITS_PER_DECK,
  clearDeckEdits,
  countDeckEdits,
  loadDeckEdits,
  saveDeckEdits,
  upsertDeckEdit,
  type StoredDeckEdits,
} from '@slidestage/lite-preset/persistence/editsStore';

const FP = 'fp-test';
const KEY = `slidestage-lite:edits:${FP}`;

function patch(selector: string, before: string, after: string) {
  return { selector, before, after };
}

const h1 = 'body>main:nth-of-type(1)>h1:nth-of-type(1)';
const p1 = 'body>main:nth-of-type(1)>p:nth-of-type(1)';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('loadDeckEdits / saveDeckEdits', () => {
  it('round-trips a valid edit map under the fingerprint key', () => {
    const edits: StoredDeckEdits = {
      0: [patch(h1, 'Old', 'New')],
      2: [patch(p1, 'Body', 'Edited body')],
    };
    expect(saveDeckEdits(FP, edits)).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
    expect(loadDeckEdits(FP)).toEqual(edits);
  });

  it('drops malformed entries on hydrate instead of crashing', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        0: [patch(h1, 'Old', 'New'), { selector: 'h1[onclick]', before: 'x', after: 'y' }],
        '-1': [patch(p1, 'a', 'b')],
        abc: [patch(p1, 'a', 'b')],
        1: 'not-an-array',
      }),
    );
    expect(loadDeckEdits(FP)).toEqual({ 0: [patch(h1, 'Old', 'New')] });
  });

  it('returns {} for corrupt JSON', () => {
    window.localStorage.setItem(KEY, '{nope');
    expect(loadDeckEdits(FP)).toEqual({});
  });

  it('removes the key when saving an empty map', () => {
    saveDeckEdits(FP, { 0: [patch(h1, 'a', 'b')] });
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
    expect(saveDeckEdits(FP, {})).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('refuses to persist a payload above the byte budget', () => {
    const big = 'x'.repeat(MAX_EDITS_BYTES);
    expect(saveDeckEdits(FP, { 0: [patch(h1, 'a', big)] })).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('clearDeckEdits removes the key', () => {
    saveDeckEdits(FP, { 0: [patch(h1, 'a', 'b')] });
    clearDeckEdits(FP);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('upsertDeckEdit', () => {
  it('adds a new patch for an unseen element', () => {
    const { edits, rejected } = upsertDeckEdit({}, 0, patch(h1, 'Old', 'New'));
    expect(rejected).toBeNull();
    expect(edits).toEqual({ 0: [patch(h1, 'Old', 'New')] });
  });

  it('chains same-element edits, keeping the original before anchor', () => {
    const first = upsertDeckEdit({}, 0, patch(h1, 'Original', 'A')).edits;
    // Live DOM now shows "A"; a follow-up edit reports before="A".
    const second = upsertDeckEdit(first, 0, patch(h1, 'A', 'B')).edits;
    expect(second).toEqual({ 0: [patch(h1, 'Original', 'B')] });
  });

  it('removes the patch when the element is edited back to its original text', () => {
    const first = upsertDeckEdit({}, 0, patch(h1, 'Original', 'A')).edits;
    const second = upsertDeckEdit(first, 0, patch(h1, 'A', 'Original')).edits;
    expect(second).toEqual({});
  });

  it('ignores no-op edits for unseen elements', () => {
    const { edits } = upsertDeckEdit({}, 0, patch(h1, 'Same', 'Same'));
    expect(edits).toEqual({});
  });

  it('rejects new patches once the per-deck cap is reached', () => {
    const full: StoredDeckEdits = { 0: [] };
    for (let i = 0; i < MAX_EDITS_PER_DECK; i += 1) {
      full[0].push(patch(`body>p:nth-of-type(${i + 1})`, `o${i}`, `n${i}`));
    }
    const { edits, rejected } = upsertDeckEdit(full, 1, patch(h1, 'Old', 'New'));
    expect(rejected).toBe('cap');
    expect(edits).toBe(full);

    // Updating an EXISTING element is still allowed at the cap.
    const update = upsertDeckEdit(full, 0, patch('body>p:nth-of-type(1)', 'n0', 'n0-v2'));
    expect(update.rejected).toBeNull();
    expect(update.edits[0][0]).toEqual(patch('body>p:nth-of-type(1)', 'o0', 'n0-v2'));
  });

  it('keeps patches for other slides untouched', () => {
    const base = upsertDeckEdit({}, 3, patch(p1, 'x', 'y')).edits;
    const next = upsertDeckEdit(base, 0, patch(h1, 'Old', 'New')).edits;
    expect(next[3]).toEqual([patch(p1, 'x', 'y')]);
    expect(countDeckEdits(next)).toBe(2);
  });
});
