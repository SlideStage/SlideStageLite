import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearNotes, loadNotes, saveNotes } from './notesStore';

const FINGERPRINT = 'fingerprint-test';

describe('notesStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty object when nothing is stored', () => {
    expect(loadNotes(FINGERPRINT)).toEqual({});
  });

  it('persists and re-hydrates per-slide overrides', () => {
    saveNotes(FINGERPRINT, { 0: 'cover note', 2: 'closing note' });
    expect(loadNotes(FINGERPRINT)).toEqual({ 0: 'cover note', 2: 'closing note' });
  });

  it('ignores entries with non-integer keys or non-string values', () => {
    window.localStorage.setItem(
      'hcslides-lite:notes:' + FINGERPRINT,
      JSON.stringify({ '0': 'ok', foo: 'bad', '1': 123, '2': null, '3': 'good' }),
    );
    expect(loadNotes(FINGERPRINT)).toEqual({ 0: 'ok', 3: 'good' });
  });

  it('returns an empty object when the stored payload is corrupt', () => {
    window.localStorage.setItem('hcslides-lite:notes:' + FINGERPRINT, '{not json');
    expect(loadNotes(FINGERPRINT)).toEqual({});
  });

  it('clearNotes removes the stored payload', () => {
    saveNotes(FINGERPRINT, { 1: 'note' });
    clearNotes(FINGERPRINT);
    expect(loadNotes(FINGERPRINT)).toEqual({});
  });
});
